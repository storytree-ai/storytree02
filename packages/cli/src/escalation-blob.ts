/**
 * The explorer-onboarding ESCALATION BLOB — the last machine-provable slice of ADR-0207 D6.
 *
 * D6's repair loop resolves the environment problems the guide CAN fix: a probe FAILs, {@link
 * ./repair-planner.ts | planRepairs} turns it into an idempotent installer step, the guide re-runs it,
 * doctor re-checks. But some unmet invariants are beyond that loop — the ones the dev cannot repair by
 * re-running an installer because they need the OWNER (GitHub Read access revoked) or the dev's own
 * out-of-band identity (their Claude subscription lapsed). ADR-0207 D6: *"When doctor cannot fix
 * (access revoked, subscription lapsed), the guide generates a secrets-redacted diagnostic blob for the
 * dev to paste to the owner — structured escalation, not a debugging session."*
 *
 * This module is the deterministic HEART of that escalation: a PURE function {@link buildEscalationBlob}
 * that turns a {@link DoctorReport} (and optionally the {@link RepairPlan} of what the dev already
 * tried) into a structured, secrets-redacted {@link EscalationBlob} the dev pastes to the owner. Like
 * doctor and the planner it carries no filesystem, process, or model — the guide (the desktop
 * conversational surface, a follow-on) imports it directly and never scrapes text.
 *
 * Two boundaries make this "structured escalation, not a debugging session":
 *   • WHEN to escalate is NARROW. Only OWNER-side / non-self-repairable invariants trigger a blob:
 *     `repo-fetchable` refused (D6's "access revoked" — an owner grant) and `claude-credential` absent
 *     (NEITHER route to a Claude credential produced one). A report whose only failures are installer-repairable
 *     (git/node/provision/…) is the repair loop's job, NOT the owner's — it yields NO blob. A healthy
 *     report, likewise, yields no blob. Freshness/offline WARNs are advisory, never escalation.
 *   • D3 REDACTION is a STRUCTURAL property, not an accident of clean inputs. Every free-text field
 *     that enters the blob is passed through {@link redact}, which strips any credentials-file path or
 *     credential-token shape. doctor already never emits a secret (it detects the credential file by
 *     EXISTENCE only, never its path or contents), so the guard is belt-and-suspenders — but it means
 *     the blob provably carries no secret even if a future probe detail were to leak one. The blob is
 *     structured DATA (named invariants + levels), never scraped log text.
 */

import { HOSTED_READ_REFUSED_DETAIL } from "./doctor.js";
import type { DoctorReport, Probe, ProbeLevel } from "./doctor.js";
import type { RepairPlan } from "./repair-planner.js";

/** The owner-side dimension an unmet invariant sits on. */
export type EscalationCategory = "access" | "identity";

/** One unmet invariant the dev cannot self-repair — the reason this escalation exists. */
export interface UnmetInvariant {
  /** The doctor probe (e.g. "claude-credential"). */
  readonly probe: string;
  /** Whether the owner grants it (access) or the dev resolves it with their own identity (identity). */
  readonly category: EscalationCategory;
  /** doctor's observed detail, redacted — what is wrong. */
  readonly detail: string;
  /** What the owner (or the dev, out of band) must do to unblock — narration, never a credential. */
  readonly ownerAction: string;
}

/** One line of redacted environment context so the owner sees the whole picture, not just the blocks. */
export interface EnvLine {
  readonly probe: string;
  readonly level: ProbeLevel;
  readonly detail: string;
}

/**
 * The structured escalation payload a dev pastes to the owner. `needed` is false — and every list
 * empty — when nothing is owner-escalation-worthy (a healthy report, or one whose only failures the
 * repair loop can fix). Every string field is redaction-clean (D3).
 */
export interface EscalationBlob {
  /** True iff there is at least one owner-side / non-self-repairable unmet invariant. */
  readonly needed: boolean;
  /** One-line reason, for the top of the paste. */
  readonly summary: string;
  /** The owner-side blocks — why the dev is stuck. Empty iff `!needed`. */
  readonly unmet: UnmetInvariant[];
  /** Redacted full doctor status (every probe) for context. Empty iff `!needed`. */
  readonly environment: EnvLine[];
  /** install.ps1 @steps the dev already re-ran before escalating (from the RepairPlan, if given). */
  readonly triedRepairs: string[];
}

// ---------------------------------------------------------------------------
// D3: redaction — a structural guard, applied to every string entering the blob.
// ---------------------------------------------------------------------------

/** The placeholder a redacted secret is replaced with. */
export const REDACTED = "[redacted]";

/**
 * PURE: strip anything that looks like a Claude credential from free text before it enters the blob.
 * The D3 boundary is that storytree never handles the credential — so the escalation the dev pastes
 * must provably carry none, even if some upstream detail leaked one. Redacts: the credentials-file
 * path (`…/.claude/.credentials.json` or a bare `.credentials.json`), `sk-ant-…` OAuth tokens, and any
 * long opaque token blob. doctor emits none of these today (it detects the file by existence only), so
 * on real doctor output this is a no-op — its job is to make "no secret" a property of the module.
 */
export function redact(text: string): string {
  return text
    // A credentials-file path in any form (with or without a leading directory / ~ / home path).
    .replace(/[^\s"']*\.credentials\.json/gi, REDACTED)
    // Anthropic OAuth/API tokens (sk-ant-…).
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, REDACTED)
    // Any remaining long opaque token blob (>= 40 token chars) — belt-and-suspenders for leaked secrets.
    .replace(/[A-Za-z0-9_-]{40,}/g, REDACTED);
}

// ---------------------------------------------------------------------------
// Classification: which probes are OWNER-side / non-self-repairable.
// ---------------------------------------------------------------------------

/**
 * PURE: the escalation category of one probe, or null if it is not owner-escalation-worthy. The set is
 * deliberately NARROW — only the two invariants the dev cannot fix by re-running an installer:
 *   • `repo-fetchable` REFUSED (a WARN carrying the github-auth fix) — offline OR GitHub Read revoked;
 *     D6's "access revoked". The offline-UNDETERMINED case (repo-fetchable=null, no fixStep) is NOT
 *     escalation — doctor cannot conclude access is gone, so the dev reconnects and re-runs, they don't
 *     bother the owner.
 *   • `claude-credential` ABSENT (FAIL) — NEITHER of ADR-0430's two routes produced a credential: no
 *     browser login AND no hydratable `CLAUDE_CODE_OAUTH_TOKEN`. Either half is beyond the repair loop —
 *     a lapsed subscription is the dev's own to renew, and a vault the box cannot read is the owner's to
 *     hear about — so the owner action must name BOTH rather than assuming the identity half.
 * Everything else — installer-repairable local-tooling failures (git/node/provision/seed/cli) and
 * freshness/offline WARNs — is the repair loop's or advisory, never an owner escalation.
 */
export function escalationCategoryOf(probe: Probe): EscalationCategory | null {
  if (probe.level === "PASS") return null;
  // Access: the read-only remote refused. Distinguished from offline-undetermined by the github-auth
  // fixStep doctor only sets on the concrete refusal (repo-fetchable=false), never on the null case.
  if (probe.name === "repo-fetchable" && probe.level === "WARN" && probe.fixStep === "github-auth") {
    return "access";
  }
  // Access: the D4 hosted live read refused this dev's identity — the IAP membership grant is the
  // owner's half of the D2 invite ceremony, so a refusal is theirs to fix. Only the CONCRETE refusal
  // escalates: `unconfigured` is a local setting and `unreachable` cannot distinguish offline from
  // revoked, so neither bothers the owner (the repo-fetchable rule, applied to D4).
  if (probe.name === "hosted-read" && probe.level === "WARN" && probe.detail === HOSTED_READ_REFUSED_DETAIL) {
    return "access";
  }
  // Identity/credential: NEITHER route produced a Claude credential (ADR-0430). This stays `identity`
  // because the fix is out-of-band to the repair loop either way, but the KEY is the credential, not one
  // route to it: after the re-point a FAIL can just as easily be a vault the box cannot read, and
  // ADR-0430's Consequences require the failure to name the vault rather than send the reader down the
  // login branch. That is why this discriminant is keyed on `claude-credential` — the name is on the
  // routing path, not merely on the row.
  if (probe.name === "claude-credential" && probe.level === "FAIL") return "identity";
  return null;
}

/**
 * The owner-facing next step — narration the dev pastes, never a secret. Keyed on the PROBE, not just
 * the category: the two `access` blocks are different halves of D2's invite ceremony and have
 * genuinely different remedies (a GitHub Read grant vs an IAP membership grant), so collapsing them
 * to one message would send the owner to the wrong console.
 */
function ownerActionFor(probe: Probe, category: EscalationCategory): string {
  if (probe.name === "hosted-read") {
    return "Grant the dev's Google identity access to the hosted studio (the IAP membership half of the invite ceremony, ADR-0207 D2/D4); re-grant if it was pulled. Their offline checkout still works meanwhile.";
  }
  if (category === "access") {
    return "Confirm the dev still has GitHub Read access to storytree-ai/storytree02 (it may be offline, or the grant may have been revoked); re-invite if it was pulled.";
  }
  return "No Claude credential reached this machine by EITHER route (ADR-0430), so name which one was expected. On a fleet box the token comes from Google Secret Manager (`claude-code-oauth-token`) — check the dev's access to the vault, or that the value reached `~/.storytree/secrets.json`; do NOT have them mint a fresh one, which can take another machine down (docs/machine-onboarding.md §2.2). Otherwise the dev signs in to their OWN Claude subscription (`claude`), and a lapsed subscription is theirs to renew. Either way storytree never mints or discloses the credential (ADR-0430 D6).";
}

// ---------------------------------------------------------------------------
// The pure builder.
// ---------------------------------------------------------------------------

/**
 * PURE: turn a doctor report (and optionally the repair plan of what was already tried) into a
 * structured, secrets-redacted escalation blob. Escalation is warranted IFF some probe is owner-side /
 * non-self-repairable ({@link escalationCategoryOf}); otherwise `needed` is false and every list empty.
 */
export function buildEscalationBlob(report: DoctorReport, opts: { plan?: RepairPlan } = {}): EscalationBlob {
  const unmet: UnmetInvariant[] = report.probes
    .map((p): UnmetInvariant | null => {
      const category = escalationCategoryOf(p);
      if (category === null) return null;
      return { probe: p.name, category, detail: redact(p.detail), ownerAction: ownerActionFor(p, category) };
    })
    .filter((u): u is UnmetInvariant => u !== null);

  if (unmet.length === 0) {
    return { needed: false, summary: "No escalation needed — nothing here requires the owner.", unmet: [], environment: [], triedRepairs: [] };
  }

  // Only INSTALLER steps count as "already tried" — those are the self-repairs the guide walks the dev
  // through before escalating. Instruction actions (the dev's own login) are the escalation, not a try.
  const triedRepairs = (opts.plan?.actions ?? [])
    .filter((a) => a.kind === "installer-step")
    .map((a) => (a.kind === "installer-step" ? a.step : ""))
    .filter((s) => s.length > 0);

  const environment: EnvLine[] = report.probes.map((p) => ({ probe: p.name, level: p.level, detail: redact(p.detail) }));
  const categories = [...new Set(unmet.map((u) => u.category))];
  const summary =
    `Setup blocked on ${unmet.length} invariant(s) the dev cannot self-repair` +
    ` (${categories.join(", ")}) — needs the owner.`;

  return { needed: true, summary: redact(summary), unmet, environment, triedRepairs };
}

/**
 * PURE: render an escalation blob as the stable, paste-able text the dev sends the owner. Structured —
 * a header, the unmet invariants with their owner action, the redacted environment, and what was tried.
 * Provably carries no secret (every field was redacted at build time).
 */
export function formatEscalationBlob(blob: EscalationBlob): string {
  if (!blob.needed) return "No escalation needed — setup is either healthy or self-repairable.";

  const lines: string[] = ["storytree onboarding — escalation to owner (ADR-0207 D6)", "", blob.summary, ""];

  lines.push("Blocked on (needs you):");
  blob.unmet.forEach((u, i) => {
    lines.push(`  ${i + 1}. [${u.category}] ${u.probe}: ${u.detail}`);
    lines.push(`       -> ${u.ownerAction}`);
  });

  if (blob.triedRepairs.length > 0) {
    lines.push("", `Already tried (idempotent installer steps re-run): ${blob.triedRepairs.join(", ")}.`);
  }

  lines.push("", "Full setup status:");
  const glyph = { PASS: "ok  ", WARN: "warn", FAIL: "FAIL" } satisfies Record<ProbeLevel, string>;
  for (const e of blob.environment) lines.push(`  [${glyph[e.level]}] ${e.probe.padEnd(22)} ${e.detail}`);

  lines.push("", "(No credentials are included — storytree never handles your Claude token, ADR-0207 D3.)");
  return lines.join("\n");
}
