/**
 * THE SPINE'S node:test REPORTER (ADR-0573 D2): one JSON line per test event, written to the
 * per-observation report path the spine clears before every observation it trusts (ADR-0249).
 *
 * Ported from the probe that measured it (`docs/research/batched-red-attribution-probe-2026-09-14.md`,
 * Appendix A.3). Read `per-test-report.ts` for the reader and the traps it handles.
 *
 * ⚠ It never runs ALONE. Naming any node:test reporter silences node's default stdout (measured on
 * Node 24.15.0, 2026-09-15), and that stdout is the failure output a refused observation carries to the
 * orchestrator (PR #1910). The proof command names `spec` to stdout beside this one.
 *
 * Loaded from the SPINE's own committed copy (`perTestReporterUrl()`), never a worktree copy, for the
 * reason ADR-0211's guard is. Node builtins only, so it loads in a bare worktree.
 */
export default async function* perTestReporter(source) {
  for await (const event of source) {
    const { type } = event;
    if (!["test:pass", "test:fail", "test:diagnostic", "test:summary"].includes(type)) continue;
    const d = event.data ?? {};
    const out = { type };
    for (const key of ["name", "nesting", "file", "line", "column", "testNumber", "skip", "todo", "success", "counts"]) {
      if (d[key] !== undefined) out[key] = d[key];
    }
    if (type === "test:diagnostic") out.message = d.message;
    const details = d.details;
    if (details !== undefined) {
      out.testType = details.type;
      const err = details.error;
      if (err !== undefined) {
        out.failureType = err.failureType;
        out.errorCode = err.code;
        const cause = err.cause;
        if (cause !== undefined && cause !== null) {
          try {
            const msg = typeof cause.message === "string" ? cause.message : String(cause);
            out.causeName = cause.name ?? cause.constructor?.name;
            out.causeCode = cause.code;
            out.causeMessage = msg.split("\n")[0];
          } catch {
            // A malformed cause must not prevent later test events from being reported.
          }
        }
      }
    }
    yield `${JSON.stringify(out)}\n`;
  }
}
