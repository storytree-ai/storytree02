# Continuous deployment for the hosted studio (ADR-0046) — keyless, WIF (ADR-0021).
#
# Closes the merge->deploy gap ADR-0042 left open: a studio-affecting merge to `main`
# triggers .github/workflows/deploy-studio.yml, which authenticates to GCP with NO JSON
# key (GitHub Actions OIDC -> Workload Identity Federation -> this deploy service account),
# builds the image via Cloud Build (reusing infra/studio-cloudbuild.yaml unchanged), and
# `gcloud run deploy`s it with the full ADR-0042 flag set (--iap, runtime SA, env vars).
#
# ── REUSES the WIF pool from infra/ci-presence.tf (PR #95) ──────────────────────────────────
# The `github-actions` Workload Identity Pool + its `github` provider are a PROJECT SINGLETON
# created by ci-presence.tf. This file does NOT recreate them — it references the pool by its
# literal resource path (project NUMBER 635716509357, the same string ci.yml hardcodes) so the
# two units stay decoupled: studio-cd.tf validates and applies whether or not ci-presence.tf is
# present in the module. SEQUENCING: ci-presence.tf's pool must EXIST before a deploy can auth
# (land + `terraform apply` PR #95 first, or apply both together). Until then the deploy job's
# auth step fails loudly and the studio simply isn't auto-deployed — nothing else breaks.
#
# ── ONE-TIME OWNER STEP (BLOCKING until done) ───────────────────────────────────────────────
# Creating a service account + project IAM bindings needs Owner-level ADC the agent session
# lacks, so this is owner-run, once (see infra/studio-cd.md):
#   cd infra && terraform init && terraform apply
# Then UNDRAFT the deploy PR (it is held draft precisely so this apply happens deliberately and
# the IAM surface is reviewed first). The deploy-studio.yml constants were authored to match the
# outputs at the bottom of this file — verify with `terraform output` before undrafting.

locals {
  # The repo whose Actions OIDC may impersonate the deploy SA is the one ci-presence.tf's provider
  # accepts (var.github_repository_id — keyed on the immutable repo id, ADR-0622). The binding below
  # is pool-level on attribute.ref, and only that provider maps attribute.ref, so no second repo
  # constant belongs here.

  # The github-actions WIF pool's literal resource path (owned by ci-presence.tf). The project
  # NUMBER (not id) is what the pool name embeds; it matches ci.yml's hardcoded provider string.
  studio_cd_wif_pool = "projects/635716509357/locations/global/workloadIdentityPools/github-actions"

  # The hosted-studio runtime SA (created imperatively, studio-cloud.md §1 — NOT a TF resource).
  # The deployed revision keeps running AS this SA (keyless Cloud SQL, ADR-0042), so the deploy
  # SA must be allowed to actAs it.
  studio_runtime_sa = "storytree-studio-host@${var.project_id}.iam.gserviceaccount.com"

  # Cloud Build's EXECUTION SA = the project's DEFAULT COMPUTE SA (project NUMBER-based — the same
  # 635716509357 the WIF pool path embeds). `gcloud builds submit` runs the build AS this SA, so the
  # SUBMITTER (the deploy SA) must be allowed to actAs it. (Google's current default for new builds;
  # NOT the legacy <num>@cloudbuild SA the comment below once assumed.)
  studio_build_sa = "635716509357-compute@developer.gserviceaccount.com"
}

# ── The dedicated, least-privilege deploy service account ────────────────────────────────────

resource "google_service_account" "studio_deployer" {
  account_id   = "storytree-studio-deployer"
  display_name = "Hosted studio CD — deploy on merge (ADR-0046), keyless WIF"
}

# Only this repo's workflows running ON `main` may impersonate the deploy SA. This is
# TIGHTER than ci-presence's repo-wide binding (attribute.ref/refs/heads/main, not
# attribute.repository) because the deploy SA is more privileged — it can ship a Cloud Run
# revision. deploy-studio.yml triggers on push:main, so its OIDC token carries this exact ref.
resource "google_service_account_iam_member" "studio_deployer_wif_user" {
  service_account_id = google_service_account.studio_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.studio_cd_wif_pool}/attribute.ref/refs/heads/main"
}

# actAs the runtime SA at deploy time, so the new revision runs as storytree-studio-host (the
# keyless Cloud SQL principal — ADR-0042). Scoped to that one SA, nothing else.
resource "google_service_account_iam_member" "studio_deployer_actas_runtime" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.studio_runtime_sa}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# Deploy Cloud Run revisions of the storytree-studio service + re-assert its IAP posture. This is
# `roles/run.admin`, not the narrower `roles/run.developer`, ON PURPOSE: the deploy passes `--iap`
# every time so the IAP wall can never silently drift off, and `--iap` performs a setIamPolicy (binds
# the IAP service agent as the sole invoker) which run.developer cannot do.
#
# SCOPED TO THE ONE storytree-studio SERVICE, not the whole project (ADR-0046 tightening, studio-cd.md
# option 1). Project-wide run.admin would let this CD SA modify/replace ANY Cloud Run service in the
# project and run setIamPolicy on them — e.g. add an `allUsers` invoker to make an unrelated service
# public / bypass IAP — so a CD compromise (only reachable via a poisoned main-branch deploy) could
# reconfigure or expose the whole project's Run surface. Resource scope contains the blast radius to
# redeploying THIS one service. The deploy (`gcloud run deploy storytree-studio …`) and the smoke
# `gcloud run services describe storytree-studio` both target only this service, so resource-scoped
# run.admin covers them; project `roles/run.viewer` below (read-only) covers any operation-polling /
# describe that resolves at project scope. The service is created imperatively (studio-cloud.md §1 —
# not a TF resource), so this binding references it by location + name rather than a resource address.
resource "google_cloud_run_v2_service_iam_member" "studio_deployer_run_admin" {
  project  = var.project_id
  location = var.region
  name     = "storytree-studio"
  role     = "roles/run.admin"
  member   = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# Read-only, project-wide Cloud Run visibility for `gcloud run deploy`'s operation polling and the
# smoke step's describe (studio-cd.md option 1). `roles/run.viewer` grants NO write — no
# services.update, no setIamPolicy — so it does NOT reintroduce the cross-service blast radius the
# service-scoped run.admin above removes; it only lets the SA read Run state.
resource "google_project_iam_member" "studio_deployer_run_viewer" {
  project = var.project_id
  role    = "roles/run.viewer"
  member  = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# Submit + watch Cloud Build builds (the image build is delegated to Cloud Build, reusing
# infra/studio-cloudbuild.yaml). The build EXECUTION SA (the default compute SA, see studio_build_sa)
# already has artifactregistry.writer — the owner's manual `gcloud builds submit` pushes today — so
# nothing new is granted to it; the SUBMITTER (this SA) gets builds.editor here AND actAs on the
# build SA just below.
resource "google_project_iam_member" "studio_deployer_cloudbuild" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# actAs the Cloud Build EXECUTION SA. `gcloud builds submit` runs the build AS Cloud Build's
# execution SA (the default compute SA, studio_build_sa), so the submitter needs serviceAccountUser
# on it. Without this the submit fails "caller does not have permission to act as service account
# …-compute@…" (observed on the 2026-06-13 deploy run, AFTER the staging upload succeeds). Scoped to
# that one build SA, nothing else. (Applied imperatively to unblock CD; codified here so it isn't
# drift — `terraform apply` is a no-op against the existing binding.)
resource "google_service_account_iam_member" "studio_deployer_actas_build" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.studio_build_sa}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# Stream build logs. studio-cloudbuild.yaml sets `logging: CLOUD_LOGGING_ONLY`, so
# `gcloud builds submit` needs log read to stream + report a clean success/failure (otherwise it
# cannot tail and the step's signal is muddied). Read-only.
resource "google_project_iam_member" "studio_deployer_logging_viewer" {
  project = var.project_id
  role    = "roles/logging.viewer"
  member  = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# "Use" the project's services / consume its quota. REQUIRED for a service account to run
# `gcloud builds submit`: without `serviceusage.services.use` the staging-bucket access is rejected
# with "The user is forbidden from accessing the bucket … if the user has the
# serviceusage.services.use permission" (observed on the first live deploy run, 2026-06-13). This is
# the documented prerequisite for SA-driven Cloud Build submits.
resource "google_project_iam_member" "studio_deployer_serviceusage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# Reference the built image at deploy time. `gcloud run deploy --image <AR ref>` validates the
# image exists; the deploy principal needs read on the storytree AR repo (created imperatively,
# studio-cloud.md §1 — referenced here by location + name, not managed).
resource "google_artifact_registry_repository_iam_member" "studio_deployer_ar_reader" {
  project    = var.project_id
  location   = var.region
  repository = "storytree"
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# ── A dedicated source-staging bucket for `gcloud builds submit` ──────────────────────────────
# Avoids depending on / over-granting the default `<project>_cloudbuild` bucket: the deploy SA
# gets full control of THIS bucket only, and the workflow passes --gcs-source-staging-dir to it.
# Short TTL so source tarballs don't accumulate (the build only needs the latest upload).
resource "google_storage_bucket" "studio_cd_build_staging" {
  name                        = "${var.project_id}-studio-cd-build"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  lifecycle_rule {
    condition {
      age = 7 # days — staged source is ephemeral; the image is the durable artifact
    }
    action {
      type = "Delete"
    }
  }
}

# storage.admin (not just objectAdmin) on this bucket ONLY: `gcloud builds submit` also does a
# `storage.buckets.get` existence check, which objectAdmin lacks. Bucket-scoped, so the blast radius
# is just this throwaway staging bucket.
resource "google_storage_bucket_iam_member" "studio_deployer_staging_admin" {
  bucket = google_storage_bucket.studio_cd_build_staging.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.studio_deployer.email}"
}

# ── Outputs (paste-checks for deploy-studio.yml) ─────────────────────────────────────────────

output "studio_cd_workload_identity_provider" {
  value       = "${local.studio_cd_wif_pool}/providers/github"
  description = "Must equal `workload_identity_provider` in deploy-studio.yml's GCP auth step."
}

output "studio_cd_service_account" {
  value       = google_service_account.studio_deployer.email
  description = "Must equal `service_account` in deploy-studio.yml's GCP auth step."
}

output "studio_cd_build_staging_dir" {
  value       = "gs://${google_storage_bucket.studio_cd_build_staging.name}/source"
  description = "Must equal `--gcs-source-staging-dir` in deploy-studio.yml's build step."
}
