// measure-uat-silence.mjs — how much of the UAT signal survives the 2D → 3D mapping, on the REAL map.
//
// ⚠ IT READS THE COMMITTED EXPORT, NOT A FIXTURE. `docs/research/chapter2-real-forest-2026-09-08/
// scenes/shipped.json` is the layout the studio built for the live corpus on 2026-09-07 with no
// rung override — the map, not a ladder arm. A synthetic island would answer nothing here: the
// question is how many REAL criteria are unsigned, and a fixture picks that number itself.
//
// WHAT IT COUNTS. The 2D scene emits one wrapper per UAT criterion in one of three kinds —
// `tall-flower-proven`, `tall-flower-pending`, `tall-flower-failing` (ADR-0226 D4, the verdict read
// from the FORM). `packages/forest-world-r3f/src/world-to-3d.ts` maps ONLY the `proven` wrapper, to
// a `uat-bloom`; the other two fall through to the explicit skip, deliberately (a bloom claims "the
// owner SIGNED this", so emitting one for an unsigned criterion would assert a signature nobody
// gave — ADR-0392 D5 / ADR-0398 D7). So the 3D map is SILENT about every unsigned criterion, and
// this script measures what that silence costs on the real corpus.
//
// ⚠ ISLAND IDENTITY IS TAKEN ONLY FROM A GROUP THAT SAYS IT IS AN ISLAND (`ground` / `territory` /
// `tile`), the same rule `world-to-3d.ts` holds — every other `<g id=…>` on an island carries an id
// for its own reasons, and inheriting one would attribute a story's criteria to a capability.
//
// Run: node docs/research/chapter2-uat-silence-2026-09-23/measure-uat-silence.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXPORT = fileURLToPath(
  new URL('../chapter2-real-forest-2026-09-08/scenes/shipped.json', import.meta.url),
);
const ISLAND_GROUP_KINDS = new Set(['ground', 'territory', 'tile']);
const CRITERION_KINDS = ['tall-flower-proven', 'tall-flower-pending', 'tall-flower-failing'];

const perIsland = new Map();
function walk(node, island) {
  const kind = node.kind;
  const own = ISLAND_GROUP_KINDS.has(kind) && node.id ? node.id : island;
  if (CRITERION_KINDS.includes(kind)) {
    const counts = perIsland.get(own) ?? { proven: 0, unsigned: 0 };
    if (kind === 'tall-flower-proven') counts.proven += 1;
    else counts.unsigned += 1;
    perIsland.set(own, counts);
  }
  for (const child of node.children ?? []) walk(child, own);
}
walk(JSON.parse(readFileSync(EXPORT, 'utf8')).scene, undefined);

const rows = [...perIsland.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
const totalProven = rows.reduce((n, [, c]) => n + c.proven, 0);
const totalUnsigned = rows.reduce((n, [, c]) => n + c.unsigned, 0);
// SILENT: the island has criteria and none is signed, so 3D draws nothing and the island reads as
// carrying no UAT work at all. MISREPORTING: some are signed and some are not, so 3D draws only the
// signed ones and the island reads as FULLY proven — the dangerous direction.
const silent = rows.filter(([, c]) => c.unsigned > 0 && c.proven === 0);
const misreporting = rows.filter(([, c]) => c.unsigned > 0 && c.proven > 0);
const honest = rows.filter(([, c]) => c.unsigned === 0);

console.log(`criteria on the real map: ${totalProven + totalUnsigned} (${totalProven} signed, ${totalUnsigned} unsigned)`);
console.log(`the 3D map draws ${totalProven} of them — ${((totalUnsigned / (totalProven + totalUnsigned)) * 100).toFixed(0)}% of the UAT signal is not drawn\n`);
console.log(`islands carrying criteria: ${rows.length}`);
console.log(`  SILENT (criteria, none signed — 3D draws nothing):        ${silent.length}`);
for (const [id, c] of silent) console.log(`      ${id}  signed=${c.proven} unsigned=${c.unsigned}`);
console.log(`  MISREPORTING (mixed — 3D reads as fully proven):          ${misreporting.length}`);
for (const [id, c] of misreporting) console.log(`      ${id}  signed=${c.proven} unsigned=${c.unsigned}`);
console.log(`  HONEST (all signed):                                      ${honest.length}`);
