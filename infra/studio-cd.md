# Hosted studio CD — keyless deploy-on-merge (ADR-0046)

Closes the merge→deploy gap ADR-0042
left open: merging a studio-affecting change to `main` now redeploys the Cloud Run studio
automatically, instead of waiting for someone to re-run the manual runbook (`studio-cloud.md`
§3–§4). The "Circle"→"Members" rename (PR #102) shipping to `main` but the live site serving the
old bundle is the bug this fixes.

Wired in three pieces:

- **`.github/workflows/deploy-studio.yml`** — on `push: main` (with a studio-affecting `paths:`
  filter), authenticates to GCP **keyless via WIF** (ADR-0021), builds the image with Cloud Build
  (reusing `infra/studio-cloudbuild.yaml` unchanged), then `gcloud run deploy`s with the **full
  ADR-0042 flag set** (`--iap`, runtime SA, env vars) so the security posture never drifts.
- **`infra/studio-cd.tf`** — the dedicated `storytree-studio-deployer` SA, its least-privilege IAM,
  a source-staging bucket, and the WIF binding. **Reuses** the `github-actions` WIF pool from
  `ci-presence.tf` (a project singleton — not recreated here).
- **This runbook.**

## STATUS (2026-06-14): LIVE — IAM applied, one fix added

The deploy SA, its WIF binding, and the rest of the IAM below were applied; `deploy-studio.yml` is
merged and on `main`. One binding was **missing** and broke the first real run: the deploy SA could
not `actAs` the Cloud Build **execution** SA (the default compute SA), so `gcloud builds submit`
failed `PERMISSION_DENIED: caller does not have permission to act as service account …-compute@`.
That grant has been applied (and codified in `studio-cd.tf` as `studio_deployer_actas_build`); a
fresh `terraform apply` is a no-op against it.

### Triggering a deploy

- **Auto-merged studio PRs (ADR-0061): dispatched, no PAT.** ci.yml's `automerge` job, after it
  merges, runs `gh workflow run deploy-studio.yml --ref main` whenever the merged PR touched the
  studio-affecting path set. `workflow_dispatch` is the documented anti-recursion exception (it fires
  even from `GITHUB_TOKEN`, given `actions: write` on the job), and a dispatch on `--ref main`
  authenticates with the **same `main`-scoped deploy-SA WIF binding** below — so this closes the
  auto-merge gap with **no new secret and no new IAM**. A deploy **PAT is deliberately NOT used**.
- **Auto on `push: main` covers *owner manual* merges.** A user-token merge cascades the
  `push: main` trigger directly (anti-recursion only blocks `GITHUB_TOKEN` pushes), so manual merges
  deploy via that path; the dispatch above does not run for them.
- **On demand / break-glass:** `gh workflow run deploy-studio.yml --ref main` (any time, e.g. to
  redeploy a specific state or verify). This is the same call the `automerge` job now makes.

## (historical) ONE-TIME OWNER STEP — the IAM apply (now done)

Creating a service account + project IAM bindings needs Owner-level ADC an agent session lacks, so
this is owner-run, once. Run as the owner (`gcloud auth login`, `gcloud auth application-default
login`, project `storytree-498613`). **Run from a checkout that has BOTH `infra/ci-presence.tf` and
`infra/studio-cd.tf`** so one apply creates the WIF pool (PR #95) and the CD resources together.

PowerShell (Windows — note `;`, NOT `&&`, separates statements in PowerShell 5.1; `terraform` is the
command, there is no `terraform` folder to `cd` into):

```powershell
Set-Location C:\path\to\checkout\infra
terraform init     # downloads providers + wires the GCS backend
terraform apply    # creates the deploy SA, its IAM, the staging bucket, the WIF binding (+ the PR #95 pool if not yet applied)
```

bash:

```bash
cd infra && terraform init && terraform apply
```

**Dependency — the WIF pool must exist.** `studio-cd.tf` references the `github-actions` WIF pool
defined by `ci-presence.tf` (PR #95, merged to `main`). Applying from a checkout that has both `.tf`
files creates the pool and this unit's bindings in one run. (The binding references the pool by
literal *path*, so `terraform validate`/`plan` for `studio-cd.tf` does not require `ci-presence.tf`
to be present — but a real deploy cannot authenticate until the pool exists in GCP.)

### Verify the apply matches the workflow

The three constants hardcoded in `deploy-studio.yml` MUST equal the Terraform outputs (authored to
match — this is the paste-check):

```bash
terraform output studio_cd_workload_identity_provider  # == workload_identity_provider in deploy-studio.yml
terraform output studio_cd_service_account             # == service_account in deploy-studio.yml
terraform output studio_cd_build_staging_dir           # == STAGING_DIR env in deploy-studio.yml
```

Expected:

| deploy-studio.yml field        | value                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `workload_identity_provider`   | `projects/635716509357/locations/global/workloadIdentityPools/github-actions/providers/github` |
| `service_account`              | `storytree-studio-deployer@storytree-498613.iam.gserviceaccount.com`                           |
| `STAGING_DIR`                  | `gs://storytree-498613-studio-cd-build/source`                                                 |

After the apply succeeds and the outputs match, **undraft the deploy PR** (or remove the `hold`
label). The next studio-affecting merge to `main` will deploy automatically.

## Why it is held draft (not merged fail-soft like ci-presence)

Unlike the presence merge-retire (advisory → fail-soft, merges immediately), a **deploy that cannot
happen should be loud, not silent** — silently skipping is the exact "merged but didn't deploy"
bug. So `deploy-studio.yml` is *not* `continue-on-error`: before the apply, its auth step fails and
the run goes red. To avoid a stream of red runs on `main` between merge and apply, the PR is held
**draft** until the owner applies the IAM deliberately (and reviews the one knowingly-wide grant —
see below). It is `push: main` only, never a PR check, so even a red run blocks no merge.

## The IAM surface (review before applying)

The deploy SA `storytree-studio-deployer` gets:

| Role | Scope | Why |
| --- | --- | --- |
| `roles/iam.workloadIdentityUser` | the deploy SA | the keyless bridge — only this repo's workflows (repo id 1260888565, ADR-0622) **on `main`** (`attribute.ref/refs/heads/main`) may impersonate it (tighter than ci-presence's repo-wide binding) |
| `roles/iam.serviceAccountUser` | on `storytree-studio-host` | actAs at deploy → the revision runs as the keyless runtime SA |
| `roles/run.admin` | the **`storytree-studio` service** only (`google_cloud_run_v2_service_iam_member`) | deploy revisions **and** the `setIamPolicy` that `--iap` performs (binds the IAP service agent as sole invoker) — scoped to this one service so a CD compromise cannot setIamPolicy on / reconfigure any OTHER Cloud Run service |
| `roles/run.viewer` | project | read-only Run visibility for `gcloud run deploy`'s operation polling + the smoke `describe` (no write, no `setIamPolicy`) |
| `roles/cloudbuild.builds.editor` | project | submit + watch the image build |
| `roles/iam.serviceAccountUser` | on the default compute SA (`635716509357-compute@`) | actAs the Cloud Build **execution** SA — `gcloud builds submit` runs the build as it; without this the submit fails `cannot act as …-compute@` (the 2026-06-13 failure) |
| `roles/serviceusage.serviceUsageConsumer` | project | **required for SA-driven `gcloud builds submit`** — `serviceusage.services.use` (without it the staging-bucket access is refused; hit on the first live run) |
| `roles/logging.viewer` | project | stream `CLOUD_LOGGING_ONLY` build logs for a clean success/fail signal |
| `roles/storage.admin` | the `…-studio-cd-build` bucket only | upload build source + the `buckets.get` existence check `submit` does |
| `roles/artifactregistry.reader` | the `storytree` repo | reference the image at deploy |

**`run.admin` is now scoped to the single `storytree-studio` service** (tightening option 1 below,
applied for the defensive-security least-privilege pass) via `google_cloud_run_v2_service_iam_member`,
paired with a read-only project `roles/run.viewer`. It is still `run.admin` (not `run.developer`)
because the deploy re-asserts `--iap` every time (so the wall can never silently drift off) and
`--iap` needs `setIamPolicy` which `run.developer` lacks — but confined to this one service, so a CD
compromise cannot `setIamPolicy` on / reconfigure any OTHER Cloud Run service in the project.
**⚠️ This changes the deploy SA's effective IAM — an owner `terraform apply` is required to take
effect** (it destroys the old project-wide binding and creates the service-scoped + `run.viewer`
pair). Verify the first deploy after apply still succeeds (the `--iap` setIamPolicy + operation
polling must resolve at resource scope; the project `run.viewer` covers describe/operations reads).

Further **tightening option** still open (owner's call, would touch the workflow):

- Drop to `roles/run.developer` and **stop passing `--iap`** in the workflow — IAP is a sticky
  service setting that a new revision preserves — then assert it is still on in the smoke step. Most
  least-privilege; trades self-healing of the IAP posture for an assertion-only guard.

## Post-deploy verification (what CD does, and what it deliberately does NOT)

CD captures the revision the deploy created, re-asserts 100% of traffic onto it
(`update-traffic --to-revisions <new>=100`), then asserts **that named revision is `Ready` and is the
one holding 100% of traffic** — `gcloud run deploy` already fails the job if the container crashes on
boot. Traffic is re-asserted rather than assumed: a `gcloud run deploy --tag <t> --no-traffic`
side-deploy (an attestation deep-link) rewrites the service's traffic block into an explicit pin, and
from then on every CD deploy lands at 0% traffic with the members' studio frozen on the pinned
revision. That is exactly what happened 2026-07-31 → 08-01. Tagged deep-links are unaffected by the
re-assert: `--to-revisions` changes percentages only.

It does **NOT** curl the site: the service is IAP-locked, and the `studio-cloud.md` "verify behind the wall" recipe
(temporary `--no-iap` + a `run.invoker` binding + a spoofed `x-goog-authenticated-user-email` header)
**must never run in automated CD** — it would briefly drop the wall. A signed-in viewer confirms the
served bundle via the `/api/health` `code` git-HEAD stamp.

## Relationship to the manual runbook

`studio-cloud.md` §3–§4 stays valid as the **break-glass** path: the first stand-up, deploying an
arbitrary non-`main` commit, or any deploy while CD is paused. CD is additive, not a replacement.

## Rollback

Cloud Run revisions make rollback a one-liner — no pipeline machinery:

```bash
gcloud run services update-traffic storytree-studio --region australia-southeast1 \
  --project storytree-498613 --to-revisions <previous-revision>=100
```
