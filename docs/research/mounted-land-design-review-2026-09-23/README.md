# Mounted land: design review, 23 September 2026

The biggest problem is the old map painted over the new land. Its opaque empty hexagons cut the smooth shoreline back into a board; the oversized painted tree then competes with the 3D pines. Removing those two layers makes a substantial improvement without changing the land art. A smaller gap where roads approach shore remains a separate defect.

This ranked review was written **before product changes**. The same-page diagnostic pictures change browser styling only; they are not a shipped fix or an owner verdict. The owner’s look remains the verdict on the whole.

## 1. Empty hexagons hide the coast and make every island look unfinished

**What is wrong:** a pale board surrounds every island and cuts chunks out of its smooth shoreline.

![Empty board covers the shoreline](01-board-hides-coast.png)

**Class:** TRANSITION. **Confidence:** high, a defect rather than a taste call. The empty SVG cells have opaque fills and sit above the 3D canvas. Temporarily hiding only `.hex-coast` reveals the actual smooth coast and more of the incoming roads. The canvas was drawing those pixels correctly underneath it. This is especially damaging to one-cell islands, whose empty board is much larger than their land.

**Fix:** suppress the empty board’s paint under `landMount`, preserving identity and picking. Keep the flat map unchanged. Do not reshape the 3D coast to compensate for an overlay.

## 2. The large painted tree looks pasted over a forest of much smaller trees

**What is wrong:** the broad-leaf tree uses a different drawing style and towers over the 3D pines on the same island.

![Painted hero above the kit pines](02-hero-sticker.png)

**Class:** TRANSITION, with a scale/composition consequence. **Confidence:** high; removal is explicitly owner-authorised.

**Fix first, as requested:** hide the hero under either mounted arm, including its growth-track and fallback forms. Keep nameplates, coverage plants, UAT flowers, activity lights and picking. The nameplate’s explicit status word remains the story-level reading, including on zero-capability islands. The mounted ground also retains its existing status colour: where parcels differ, its colours describe those parcels and must not be mistaken for a replacement for the story’s status word. The legend must stop telling mounted-map readers to look for a big tree that no longer exists. No status is inferred from the decorative 3D pine species.

## 3. Some roads stop before they reach the island

**What is wrong:** the road ends in empty space just before the shore, so the connection looks broken.

![Library roads end before the shore](03-roads-stop-short.png)

**Class:** COMPOSITION. **Confidence:** high for the visible gap; the mechanism still needs tracing. This crop is the **same-page diagnostic with empty board and hero paint hidden**, so it isolates the residual gap from defect 1. Both the north and south approach to Library are visible. No renderer geometry was changed to produce it.

**Next:** check the connection between the sea ribbon and the shore landing. Repair the actual integration if the endpoint is simply not consumed. Preserve which stories the roads connect, shared routing and status colours.

## 4. Dense islands have two competing vegetation styles

**What is wrong:** the flat, broad-leaf coverage plants and the smaller 3D pines merge into a busy carpet that makes the land hard to read.

![Dense coverage plants and kit vegetation](04-busy-vegetation.png)

**Class:** COMPOSITION. **Confidence:** medium; **the desired balance is taste**, not a proven surface defect. The flat plants encode capability status and test density, so deleting them would remove information. After the hero and board are gone, this may be acceptable.

**Owner options to stage after the clear fixes:** keep the present coverage emphasis, or make the coverage plants visually quieter while retaining their number, identity and interaction. Do not silently choose a new plant scale, density or palette. This is not authority to remove proof marks.

## Inspection and controls

The live PostgreSQL-backed studio served this worktree on port 5199. The browser checked ordinary opening, whole-forest fit, close views of **drive-machinery, library, website-experience, storage-protocol, proof-protocol and website**, native drag, and keyboard pan. The flat map, `?landMount=1`, and `?landMount=1&landMountProps=1` were compared. The last is the props staging arm shown in the owner’s original picture; the plain mount currently defaults to ground only.

Every view replays **one fresh live API snapshot**, captured for this review, rather than loading a different forest for each arm. Raw API data stays in `/tmp/laneI-api-snapshot.json` because it includes session/profile data. `before.json` and `inspect.json` record camera transforms, labels, identities and status readings. Full screenshots are in `before/` and `inspect/`; each ranked item above has a literal crop of those pixels. `capture.mjs` is the browser driver. Every render held `/tmp/storytree-heavy.lock`; no virtual clock was installed. No interaction-speed or hardware-floor claim is made.

At ordinary working zoom, the flat control has the same data and layout as the mount. The close inspection used native wheel/drag up to the fitted route’s allowed zoom ceiling. The apparent forest-wide sparseness and road prominence at fit are not being turned into new defects: the owner already has a separate spacing review, and an overview is not the reading scale for individual labels.

## Removal record and status check

To be completed with the implementation and matched after pictures. This section will record exactly which old paint was removed and why, the status carriers that remain, and the outcome of each ranked finding. It will not claim an owner visual signature.
