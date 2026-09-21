// Entry for the db:* npm scripts (ADR-0063): up / down / status over the Cloud SQL Admin REST API
// (no gcloud subprocess, so they never feed the credential-lock cascade), reusing db-control.ts's
// REST effects. Thin I/O shell — the decisions it calls are unit-tested in db-control.ts; this is
// just argv → effect → stdout.

import {
  ensureLiveDb,
  probeLiveDbDetailed,
  renderDbProbe,
  statusLiveDbViaRest,
  stopLiveDbViaRest,
} from "@storytree/drive";

import { runDbSchema, WRITE_FLAG } from "./db-schema.js";
import { loadLocalSecrets } from "./secrets.js";

async function main(): Promise<void> {
  // Root scripts delegate via `pnpm --filter @storytree/cli db -- <action>` (the storytree-script
  // pattern), so a leading "--" arrives as argv[0]; strip it.
  const argv = process.argv.slice(2);
  const action = argv[0] === "--" ? argv[1] : argv[0];
  const log = (m: string): void => console.error(`[db] ${m}`);
  switch (action) {
    case "up": {
      const res = await ensureLiveDb(log);
      if (!res.ok) {
        console.error(res.reason);
        // A still-warming refusal is a WAIT, not a wedge: the start was issued and the instance
        // reports ALWAYS — re-probe, never re-start. Exit EX_TEMPFAIL (75) so callers/operators
        // can tell it from genuinely unreachable (1) without parsing the message.
        process.exitCode = res.stillWarming === true ? 75 : 1;
        return;
      }
      console.log(res.started ? "RUNNABLE (started)" : "RUNNABLE (already up)");
      return;
    }
    case "down": {
      await stopLiveDbViaRest();
      console.log("activationPolicy=NEVER requested (the instance stops shortly)");
      return;
    }
    case "status": {
      const s = await statusLiveDbViaRest();
      // Mirror the old gcloud `--format="value(state,settings.activationPolicy)"` shape.
      console.log(`${s.state}\t${s.activationPolicy}`);
      return;
    }
    case "probe": {
      // The canonical probe-don't-assume check CLAUDE.md names, as a COMMAND (it was prose only, so
      // every session re-derived it). Runs through the CLI's normal composition root, which is the
      // whole point: `loadLocalSecrets()` hydrates STORYTREE_DB_USER, and the `PoolHandle` shape +
      // `closePool` teardown are handled once, where they are already handled.
      //
      // Deliberately does NOT start the instance and does NOT consult the Admin API: it answers ONE
      // question — can this machine reach the DB right now, and how fast. `db:up` owns starting (and
      // ADR-0060's 75/1 vocabulary); `db:status` owns state/activationPolicy. So the exits here are
      // the plain pair: 0 = reachable, 1 = not.
      //
      // A trailing `--pg` is accepted and ignored: every `db` action is live by definition, and the
      // flag is muscle memory from the `storytree … --pg` write commands.
      loadLocalSecrets();
      const result = await probeLiveDbDetailed();
      const line = renderDbProbe(result);
      if (result.reachable) {
        console.log(line);
        return;
      }
      console.error(line);
      process.exitCode = 1;
      return;
    }
    case "schema": {
      // `tool-signal-gaps-arc`, from friction `no-verb-applies-the-schema-ddl-and-nothing-else`.
      //
      // An additive-column landing had no first-class way to apply JUST the DDL. `applySchema` is
      // exported, but every entry point that called it — `load-corpus.ts`, `batch-migrate.ts` —
      // also performs a data migration nobody wants as a side effect. So each such landing
      // hand-rolled a one-shot `.ts` inside a workspace package and paid the same connection traps,
      // ~10 minutes and three failed invocations apiece. Additive columns are the house migration
      // style (`grade` in ADR-0200 D2, `role` since), so everyone landing one hit this.
      //
      // The shape is `db:probe`'s exactly, for the same reason: a hand-rolled one-shot promoted to
      // a verb once it had been re-derived enough times. Secrets hydration, the `PoolHandle` shape
      // and `closePool` teardown all sit inside the verb.
      //
      // ★ THE BARE FORM NO LONGER APPLIES ANYTHING (increment
      // `db-schema-requires-explicit-write-posture`). It previews, and `--write` is what applies.
      // The earlier note here said this "applies SCHEMA ONLY and touches no row", which is true of
      // INSERT/UPDATE and false of the file: the bundled DDL carries two top-level `DROP TABLE IF
      // EXISTS` statements and two `DO $$ … $$` blocks that drop and re-add constraints, against the
      // ONE shared instance every session on this box uses. The decision, the summariser and both
      // renders are in `db-schema.ts`; what stays here is the I/O this shell owns.
      await runDbSchema({
        argv,
        readDdl: async () => {
          const { SCHEMA_SQL_PATH } = await import("@storytree/library/store");
          const { readFile } = await import("node:fs/promises");
          return { path: SCHEMA_SQL_PATH, sql: await readFile(SCHEMA_SQL_PATH, "utf8") };
        },
        applyDdl: async () => {
          loadLocalSecrets();
          const { applySchema, createPool, closePool } = await import("@storytree/library/store");
          const handle = await createPool();
          try {
            await applySchema(handle.pool);
          } finally {
            await closePool(handle.pool, handle.connector);
          }
        },
        out: (line) => {
          console.log(line);
        },
      });
      return;
    }
    default:
      console.error(`usage: db-cli <up|down|status|probe|schema [${WRITE_FLAG}]>`);
      process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
