# The CI database identity (keyless per ADR-0021). Named for session presence, which no longer
# exists — see infra/ci-presence.md for why the rename is a deliberate non-goal.
#
# TWO CONSUMERS in .github/workflows/ci.yml, and they want opposite privileges:
#   • `automerge` WRITES claim state — packages/notice-board/src/store/ingest-merge.ts releases the
#     merged branch's `events.node_claim` rows and appends their `events.claim_event` history
#     (ADR-0138 §4 / ADR-0200; a branch dies on merge, ADR-0142). This replaced the original
#     presence-retire job when ADR-0200 D7 dropped the `events.session` tables.
#   • `verify` READS the corpus — `check:guidance` and `check:agents` compare the live-canonical
#     Library with committed harness projections. The retired drain ceilings no longer run in CI.
#
# Both talk to Cloud SQL over IAM (no password). For CI to authenticate WITHOUT a long-lived JSON key
# (ADR-0021 forbids a key in a GH secret), this wires GitHub Actions OIDC → Workload Identity
# Federation → a dedicated, least-privilege CI service account that is a Cloud SQL IAM user. GitHub
# mints a short-lived OIDC token; GCP's STS exchanges it for an impersonated-SA access token; the
# connector mints the IAM DB token.
#
# THIS IDENTITY CANNOT WAKE THE DATABASE, and that is load-bearing rather than an oversight. It holds
# cloudsql.client + cloudsql.instanceUser only; the wake permission is bound to the STUDIO runtime SA
# alone (infra/studio-db-wake.tf). That is precisely why ADR-0302 D2 (the instance runs 24/7) had to
# land before D3 (this credential gates anything): with a nightly sleep window in place, every
# overnight PR would red on an instance CI has no way to start.
#
# ── OWNER-RUN STEPS ─────────────────────────────────────────────────────────────────────────
# The resources here need Owner-level ADC that an agent session lacks, so `terraform apply` is
# owner-run. The DB GRANTS are a separate owner run, and must be RE-RUN whenever
# ci-presence-grants.sql changes — most recently for ADR-0302 D3's corpus SELECT:
#   cd infra && terraform init && terraform apply
#   # then, FROM THE REPO ROOT (the path is repo-root-relative):
#   STORYTREE_DB_USER=hua.mick@gmail.com npx tsx infra/apply-ci-presence-grants.ts
# Until each is done, merge-time claim release degrades but the live guidance checks fail closed.
# Full runbook: infra/ci-presence.md.

# CI's Google sign-in is keyed on the repo's PERMANENT numeric id, never its name (ADR-0622).
# A name binding breaks on a rename, and worse, it would hand this repo's database access to any
# NEW repo that later takes the old name — which is exactly what happens when 0.2 is renamed
# `storytree02` and a fresh `storytree-ai/storytree` is created for 0.3. GitHub's OIDC token carries
# `repository_id`, which never changes and is never reused. This is 0.2's repo (formerly
# `storytree-ai/Storytree`, renamed `storytree-ai/storytree02`); read it back with
# `gh api repos/storytree-ai/storytree02 --jq .id`.
variable "github_repository_id" {
  type        = string
  default     = "1260888565"
  description = "Numeric GitHub repository id allowed to impersonate the CI service accounts via WIF (OIDC attribute.repository_id)."
}

# STS token exchange + SA impersonation for the OIDC→ADC flow. (iam.googleapis.com backs the
# Workload Identity Pool itself.) disable_on_destroy=false: never yank a shared API on teardown.
resource "google_project_service" "iamcredentials" {
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iam" {
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

# ── Workload Identity Federation: trust GitHub Actions OIDC ───────────────────────────────────

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "OIDC federation for storytree 0.2 CI (repo id 1260888565)"
  depends_on                = [google_project_service.iam]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions OIDC"

  # Map the GitHub OIDC claims we key authorization on. `attribute.repository_id` powers the
  # principalSet binding below so ONLY this repo's workflows can impersonate the SA; it is the
  # immutable id, so a rename neither breaks it nor transfers it (see the variable above).
  # `attribute.repository` stays mapped for readable audit logs only — nothing binds on it.
  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository"    = "assertion.repository"
    "attribute.repository_id" = "assertion.repository_id"
    "attribute.ref"           = "assertion.ref"
  }

  # Google requires an attribute_condition on new providers — scope token acceptance to this
  # repo (defence in depth alongside the principalSet binding). Keyed on the id, never the name.
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ── The dedicated, least-privilege CI service account ────────────────────────────────────────

resource "google_service_account" "ci_presence" {
  account_id   = "storytree-ci-presence"
  display_name = "CI database identity — claim release + live guidance checks, keyless WIF"
}

# Connect to + log in as an IAM user on the Cloud SQL instance. Mirrors the studio host SA
# (infra/studio-cloud.md §1): cloudsql.client (open the connection) + cloudsql.instanceUser
# (IAM DB login). No broader role — and NO wake role, deliberately (see the header). What this
# identity may actually touch is capped by the SQL grants (apply-ci-presence-grants): WRITE on the
# two claim tables, SELECT on the two library tables, nothing else in the schema.
resource "google_project_iam_member" "ci_presence_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.ci_presence.email}"
}

resource "google_project_iam_member" "ci_presence_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.ci_presence.email}"
}

# Let ONLY this repo's workflows impersonate the SA (the keyless bridge). The principalSet is
# scoped by attribute.repository_id, so a fork / another repo — including a new repo that later
# takes this one's old name — cannot assume it.
#
# SCOPED BY REPOSITORY, NOT BY REF — so ANY branch's workflow in this repo can impersonate it, and
# since ADR-0302 D3 widened the grants that buys corpus READS rather than only claim-row deletes.
# The owner considered this on 2026-08-04 and ACCEPTED it: ref-scoping cannot work here because
# `verify` runs on PR branches by definition, the repo is private so only someone who can already
# push could reach it, and a fork PR gets no token at all. Recorded in ADR-0302's corrected cost
# note. Do NOT narrow this to a ref condition without re-deciding that.
#
# If a ref restriction is ever wanted, it belongs in the PROVIDER's attribute_condition above, not
# only here — see infra/web-editor-cd.tf for why: a principalSet keyed on attribute.ref matches that
# ref in ANY repo sharing the pool.
resource "google_service_account_iam_member" "ci_presence_wif_user" {
  service_account_id = google_service_account.ci_presence.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

# The Cloud SQL IAM user for the SA. Name is the SA email WITHOUT `.gserviceaccount.com`
# (Cloud SQL truncates it) → `storytree-ci-presence@storytree-498613.iam`, which is what
# STORYTREE_DB_USER is set to in ci.yml. Bare role until the SQL grants run.
resource "google_sql_user" "ci_presence" {
  name     = trimsuffix(google_service_account.ci_presence.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.storytree.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

# ── Outputs (paste-checks for ci.yml) ────────────────────────────────────────────────────────

output "ci_presence_provider_name" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "The full WIF provider resource name — must equal `workload_identity_provider` in ci.yml's GCP auth step."
}

output "ci_presence_service_account" {
  value       = google_service_account.ci_presence.email
  description = "The CI service account — must equal `service_account` in ci.yml's GCP auth step."
}

output "ci_presence_db_user" {
  value       = google_sql_user.ci_presence.name
  description = "The Cloud SQL IAM username — must equal STORYTREE_DB_USER in ci.yml's writer step."
}
