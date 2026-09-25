# A second, single-purpose CI database identity (keyless per ADR-0021), narrower than
# storytree-ci-presence ON PURPOSE. infra/ci-presence.md draws the line explicitly:
# "Widening CI to write the corpus would be a new decision, not a wider grant." This file
# IS that new decision, for one narrow reason: proving website-experience's cross-repo UAT
# legs (the storytree-web acceptance walks) needs a verdict to land in Postgres, and
# storytree-ci-presence is deliberately read-only over the corpus.
#
# ONE INTENDED CONSUMER, NOT YET WIRED (this identity is minted first; the ci.yml job that
# drives storytree-web and signs the verdict is a separate, follow-up change — see
# stories/website-experience/story.md leg 1 and its siblings, and the "open modeling call 6 —
# cross-repo provability firewall" note in the same file). It needs to WRITE exactly two
# tables — events.verdict (the signed proof) and events.uat_drive (the drive record) — and
# READ nothing: criterion/revision ids are resolved from the checked-out story files, not
# from Postgres, so this identity carries no corpus SELECT at all.
#
# Reuses the EXISTING github-actions Workload Identity Pool + OIDC provider declared in
# ci-presence.tf (one pool for the whole repo) rather than standing up a second one.
#
# ── OWNER-RUN STEPS ─────────────────────────────────────────────────────────────────────────
# Same two-step shape as storytree-ci-presence (infra/ci-presence.md), and for the same reason:
# creating the identity needs Owner-level ADC an agent session lacks, and the DB grants are a
# separate owner-run step against the schema owner.
#
#   cd infra && terraform init && terraform apply
#   # then, FROM THE REPO ROOT (the path is repo-root-relative):
#   STORYTREE_DB_USER=hua.mick@gmail.com npx tsx infra/apply-ci-website-verdict-grants.ts
#
# Until both are done, no ci.yml job can use this identity — there is nothing to degrade to,
# since (unlike ci-presence) no job depends on it yet.

resource "google_service_account" "ci_website_verdict" {
  account_id   = "storytree-ci-webverdict"
  display_name = "CI database identity — website-experience verdict signing, keyless WIF"
}

# Same two roles as storytree-ci-presence, for the same reason: open the Cloud SQL
# connection (cloudsql.client) and log in as an IAM database user (cloudsql.instanceUser).
# No broader project role, and deliberately NO wake role — waking stays bound to the studio
# runtime SA alone (infra/studio-db-wake.tf). What this identity may actually touch in the
# database is capped by the SQL grants (ci-website-verdict-grants.sql), not by these roles.
resource "google_project_iam_member" "ci_website_verdict_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.ci_website_verdict.email}"
}

resource "google_project_iam_member" "ci_website_verdict_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.ci_website_verdict.email}"
}

# Let ONLY this repo's workflows (repo id, not name — ADR-0622) impersonate this SA — the same keyless bridge,
# the same repository-scoped (not ref-scoped) principalSet as ci-presence's binding, and for
# the same accepted reason (infra/ci-presence-grants.sql): a verify-shaped job runs on PR
# branches by definition, the repo is private, and a fork PR gets no token at all. Reuses the
# EXISTING pool resource declared in ci-presence.tf rather than declaring a second pool.
resource "google_service_account_iam_member" "ci_website_verdict_wif_user" {
  service_account_id = google_service_account.ci_website_verdict.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

# The Cloud SQL IAM user for the SA. Name is the SA email WITHOUT `.gserviceaccount.com`
# (Cloud SQL truncates it) → `storytree-ci-webverdict@storytree-498613.iam`. Bare role until
# the SQL grants run.
resource "google_sql_user" "ci_website_verdict" {
  name     = trimsuffix(google_service_account.ci_website_verdict.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.storytree.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

# ── Outputs (paste-checks for the future ci.yml job) ─────────────────────────────────────────

output "ci_website_verdict_provider_name" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Same WIF provider ci-presence uses — must equal `workload_identity_provider` in the future ci.yml job's GCP auth step."
}

output "ci_website_verdict_service_account" {
  value       = google_service_account.ci_website_verdict.email
  description = "The new CI service account — must equal `service_account` in the future ci.yml job's GCP auth step."
}

output "ci_website_verdict_db_user" {
  value       = google_sql_user.ci_website_verdict.name
  description = "The Cloud SQL IAM username — must equal STORYTREE_DB_USER in the future ci.yml job's writer step."
}
