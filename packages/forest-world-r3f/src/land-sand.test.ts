import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AUTHORED_SHORE_WIDTH } from './shore-fall.js';
import { grassScalar } from './land-grass.js';
import { LAND_SCALE } from './land-per-capability.js';
import {
  SAND_BAND_RAMP,
  SAND_BEACH_WIDTH,
  SAND_DIVISOR,
  SAND_EDGE,
  SAND_EDGE_AMPLITUDE,
  SAND_OCTAVES,
  SAND_RAMP,
  sandBandFactor,
  sandColourAt,
  sandColourOf,
  sandEdgeLattice,
  sandGlsl,
  sandLinearOf,
  sandRampEndpoints,
} from './land-sand.js';

test('the transcribed constants are the ones actually in build_land.py`s mat_attribute()', () => {
  // ⚠ SLICED TO THE ENCLOSING FUNCTION, the discipline ADR-0490 D2 asks for — the same slice
  // `land-grass.test.ts` makes, and for the same reason: `mat_procedural()` is a REJECTED variant
  // sitting above this one with near-identical node names, so a whole-file substring search can
  // pass on the losing numbers.
  const here = dirname(fileURLToPath(import.meta.url));
  const script = readFileSync(
    join(here, '..', '..', '..', 'docs', 'research', 'chapter2-land-idiom-2026-08-27', 'build_land.py'),
    'utf8',
  );
  const start = script.indexOf('def mat_attribute(');
  assert.ok(start > 0, 'mat_attribute() is missing from build_land.py');
  const decoy = script.indexOf('def mat_procedural(');
  assert.ok(decoy > 0 && decoy < start, 'the decoy is expected to sit ABOVE mat_attribute()');
  const body = script.slice(start, script.indexOf('\ndef ', start + 1));
  for (const line of [
    'shore_edge = _noise(nt, 7.5, 6.0)',
    'shore_ramp = _ramp(nt, [(0.34, (0, 0, 0, 1)), (0.70, (1, 1, 1, 1))])',
    'div.inputs[1].default_value = BEACH + 0.9',
    '(0.35, (0.395, 0.350, 0.252, 1.0))',
    '(0.70, (0.612, 0.556, 0.412, 1.0))',
  ]) {
    assert.ok(body.includes(line), `mat_attribute() no longer contains: ${line}`);
  }
  // BEACH itself is a module constant of the script, not of this function — pinned separately so
  // a change to it is a visible failure rather than a silently different beach.
  assert.ok(script.includes('BEACH = 3.1'), 'build_land.py no longer sets BEACH = 3.1');
});

test('the divisor READS the already-transcribed beach width rather than respelling 3.1', () => {
  // One number, one transcription. A second copy could drift from the shore FALL that shapes the
  // land the sand sits on, and the drift would read as a sand band that has slipped off its beach.
  assert.equal(SAND_BEACH_WIDTH, AUTHORED_SHORE_WIDTH);
  // The recipe's `BEACH + 0.9`, both terms times LAND_SCALE (`land-per-capability.ts`): 4 * LAND_SCALE.
  assert.equal(SAND_DIVISOR, AUTHORED_SHORE_WIDTH + 0.9 * LAND_SCALE);
  assert.equal(SAND_DIVISOR, 4 * LAND_SCALE);
});

test('the edge noise is the script`s own, and its lattice is a slow break rather than texture', () => {
  assert.deepEqual({ ...SAND_EDGE }, { scale: 7.5, detail: 6, roughness: 0.5 });
  assert.equal(SAND_OCTAVES, 6);
  // ⚠ THE SCRIPT STATES THIS NOISE'S JOB IN ITS OWN COMMENT — "break the sand line so it is not a
  // ring". At ~31 ground units it turns over about seven times around an island: slow enough to
  // read as an irregular coast. A lattice near the grain's ~2.5 would read as sand TEXTURE and
  // leave the sand LINE a clean ring, which is the failure the noise exists to prevent.
  // 31.17 on the tuned island; the lattice follows the island (× LAND_SCALE, `land-per-capability.ts`).
  assert.ok(Math.abs(sandEdgeLattice() - 31.17 * LAND_SCALE) < 0.05, `lattice was ${sandEdgeLattice()}`);
  assert.ok(sandEdgeLattice() > 10, 'an edge noise this fine breaks grains, not the sand LINE');
});

test('⚠ THE BAND`S SENSE: 0 delivers SAND at the water and 1 delivers GRASS inland', () => {
  // ⚠⚠ THE EASIEST THING IN THIS LAYER TO INVERT, and inverting it still draws a beach — just on
  // the wrong side of the island, sand in the interior and grass at the waterline. Blender's
  // Mix/RGBA at :888-892 wires sand into A and grass into B with this ramp as the Factor, and Mix
  // is A + (B - A) * factor.
  assert.deepEqual([...SAND_BAND_RAMP], [0.34, 0.7]);
  // On the waterline the distance is 0, so only the edge noise (0..1) can lift it; over the whole
  // ramp the quotient must still be at or under the ramp's foot for most of the coast.
  let coastSand = 0;
  let inlandGrass = 0;
  const N = 60;
  for (let i = 0; i < N; i += 1) {
    const x = i * 7.3;
    const z = i * 4.1;
    if (sandBandFactor(0, x, z) < 0.5) coastSand += 1;
    if (sandBandFactor(SAND_DIVISOR, x, z) === 1) inlandGrass += 1;
  }
  assert.ok(coastSand > N * 0.5, `only ${coastSand}/${N} waterline samples read as sand`);
  assert.equal(inlandGrass, N, 'every sample a full beach-width inland must be pure grass');
});

test('the band factor rises MONOTONICALLY with distance from the water', () => {
  // The band is a ramp across the beach, not a step at it — which is what gives the sand an edge
  // the eye reads as a shore rather than as a cut. At a fixed ground point the only moving part is
  // the distance, so the factor must be non-decreasing in it.
  for (const [x, z] of [
    [0, 0],
    [37.5, 12.25],
    [-88.1, 210.4],
  ] as const) {
    let prev = -1;
    for (let d = 0; d <= SAND_DIVISOR; d += 0.1) {
      const f = sandBandFactor(d, x, z);
      assert.ok(f >= prev, `factor fell from ${prev} to ${f} at distance ${d} on (${x}, ${z})`);
      prev = f;
    }
  }
});

test('⚠ the edge noise DISPLACES the distance, it does not scale it', () => {
  // `build_land.py:872-876` is a MULTIPLY_ADD whose multiplier is pinned to 1.0, so it is an ADD.
  // Written as a multiply, the band would collapse to nothing wherever the noise is near zero —
  // the sand line would break into disconnected patches instead of wandering.
  //
  // The tell: at a FIXED point, moving the distance by `d` must move the pre-ramp quotient by
  // exactly `d / SAND_DIVISOR`. Under a multiply it would move by `d * noise / SAND_DIVISOR`,
  // which varies from point to point. Two points with different noise values must therefore show
  // the SAME factor difference across the ramp's linear interior.
  // Tuned-island points scaled by LAND_SCALE (the edge noise's lattice scaled with the island, so
  // the noise at each is unchanged: ~0.26 and ~0.56), distances in the same basis, and the noise
  // DISPLACEMENT scaled with them (`SAND_EDGE_AMPLITUDE`) — so the tuned pair 1.4/1.5 is the same
  // pair, and both points sit exactly where they sat inside the ramp.
  const inRamp = (x: number, z: number): number[] =>
    [1.4 * LAND_SCALE, 1.5 * LAND_SCALE].map((d) => sandBandFactor(d, x, z));
  const a = inRamp(11.3 * LAND_SCALE, 5.7 * LAND_SCALE);
  const b = inRamp(203.9 * LAND_SCALE, 88.2 * LAND_SCALE);
  const da = a[1]! - a[0]!;
  const db = b[1]! - b[0]!;
  // ⚠ THE PRECONDITION IS ASSERTED, NOT USED AS A GUARD. Both pairs have to sit strictly inside
  // the ramp for the slope comparison to mean anything — and written as `if (inside) { assert }`
  // the whole test would go vacuously green the moment a constant moved one of them onto a clamp.
  // Asserting it makes that event a failure instead of a silence.
  for (const [label, pair] of [['a', a], ['b', b]] as const) {
    assert.ok(
      pair[0]! > 0 && pair[1]! < 1,
      `sample ${label} is clamped (${pair[0]}, ${pair[1]}) — the slope comparison would prove nothing`,
    );
  }
  assert.ok(Math.abs(da - db) < 1e-9, `slopes differ: ${da} vs ${db} — the noise is scaling`);
  // And the slope is the ramp's own: 0.1 tuned units (times LAND_SCALE) over the scaled 4.0
  // divisor across a 0.36-wide ramp. A multiply would make this vary with the noise at each point
  // instead.
  const expected = (0.1 * LAND_SCALE) / SAND_DIVISOR / (SAND_BAND_RAMP[1] - SAND_BAND_RAMP[0]);
  assert.ok(Math.abs(da - expected) < 1e-9, `slope ${da} vs ${expected}`);
});

test('the sand ramp is driven by LAYER 1`s base scalar, so the beach grains like the grass', () => {
  // ⚠ NOT A NOISE OF ITS OWN (`build_land.py:887` wires `mB` into the ramp's Fac). If the sand had
  // its own field the beach would read as a decal laid over the ground rather than as the same
  // ground in another colour — and the two fields would drift under any retune of layer 1.
  // ⚠ THE FIRST VERSION OF THIS ASSERTION COMPARED `sandColourOf(grassScalar(x, z))` TO ITSELF —
  // vacuously true, and it left `sandColourAt` with NO COVERAGE, which is how the mutation rung
  // found it. The real claim is that the ground-point form IS the scalar form driven by LAYER 1's
  // scalar, so it has to name both sides.
  for (const [x, z] of [
    [42.5, -17.25],
    [0, 0],
    [-133.7, 208.4],
  ] as const) {
    assert.deepEqual(
      { ...sandColourAt(x, z) },
      { ...sandColourOf(grassScalar(x, z)) },
      `the sand at (${x}, ${z}) is not the ramp at layer 1's own base scalar`,
    );
  }
  // And it genuinely varies across the ground — otherwise the equality above holds for a constant.
  assert.notDeepEqual({ ...sandColourAt(0, 0) }, { ...sandColourAt(-133.7, 208.4) });
  // The ramp is flat outside its stops and moves between them — piecewise LINEAR, as Blender's
  // `_ramp` default is, which `land-grass.ts` already established for this script.
  assert.deepEqual([...sandLinearOf(0)], [...sandLinearOf(0.35)]);
  assert.deepEqual([...sandLinearOf(1)], [...sandLinearOf(0.7)]);
  const mid = sandLinearOf(0.525);
  assert.ok(mid[0]! > sandLinearOf(0.35)[0]! && mid[0]! < sandLinearOf(0.7)[0]!);
});

test('the delivered sand is a SAND — warm, light, and nothing like the grass ramp', () => {
  // The stops are linear RGB and the delivery is through the sRGB transfer; a session that dropped
  // the linear numbers into the shader unconverted would get a sand about 2.5x too dark that reads
  // as mud, and it would look like an amplitude mistake rather than a colour-space one.
  const { dark, light } = sandRampEndpoints();
  for (const c of [dark, light]) {
    assert.ok(c.r > c.g && c.g > c.b, `sand must run warm (r>g>b), got ${JSON.stringify(c)}`);
  }
  assert.ok(light.r > dark.r && light.g > dark.g && light.b > dark.b, 'the ramp must lighten');
  // Delivered, not linear: the dark stop's red is 0.395 linear, which is ~168/255 delivered. A
  // raw-linear delivery would put it near 101.
  assert.ok(dark.r > 140, `the dark stop delivered ${dark.r} — that is the linear value, unconverted`);
});

test('sandGlsl emits the band and the ramp EXACTLY, with its constants written in', () => {
  const glsl = sandGlsl();
  // ⚠ THE DIVISOR AND BOTH RAMP STOPS AS EMITTED TEXT. Every line of an emitter is a string
  // literal, so a mutant that blanks one leaves a shader that still contains the identifiers a
  // looser test looks for while computing something else.
  // ⚠ THE DIVISOR IS A UNIFORM, NOT WRITTEN IN — it is the one constant on this layer the owner
  // moves, and a page comparing beach widths must vary a number rather than compile a shader per
  // width. Asserting the uniform NAME here is what stops it silently reverting to a literal.
  assert.ok(glsl.includes(`float t = (shore + ${SAND_EDGE_AMPLITUDE.toFixed(6)} * st_sandEdge(p)) / width;`));
  // ⚠⚠ AND THE WIDTH IS A PARAMETER RATHER THAN A UNIFORM THIS BLOCK READS. The source is spliced
  // ABOVE the shader's uniform declarations, so a `uSandWidth` in here is used before it is
  // declared and the material FAILS TO COMPILE — which a containment test cannot see, because the
  // source still contains every token it looks for. Found on a real GPU, not in this file.
  assert.ok(!glsl.includes('uSandWidth'), 'the emitted source must declare no uniform of its own');
  assert.ok(!/\buniform\b/.test(glsl), 'the emitter is spliced above the uniform block');
  // ⚠ THE ANCHOR IS ASSERTED BEFORE IT IS SLICED ON — the same discipline the ramp-slope test
  // above states for its precondition, and for the same reason. `indexOf` returns -1 when the
  // anchor is gone and `slice(-1)` is the LAST CHARACTER of the source, which this negative regex
  // can never match: a renamed band function would leave the assertion below permanently green
  // with nothing able to see it. The golden pins the name too, but a session that renames the
  // function REGENERATES the golden in the same edit — this line is the one that does not move
  // with it.
  const bandAt = glsl.indexOf('st_sandBand');
  assert.ok(bandAt > 0, 'st_sandBand is missing from the emitted source');
  assert.ok(
    !/\/ \d+\.\d+;/.test(glsl.slice(bandAt)),
    'the band must not divide by a written-in constant',
  );
  assert.ok(
    glsl.includes(
      `return clamp((t - ${SAND_BAND_RAMP[0].toFixed(6)}) / ${(
        SAND_BAND_RAMP[1] - SAND_BAND_RAMP[0]
      ).toFixed(6)}, 0.0, 1.0);`,
    ),
  );
  // It calls layer 1's scalar rather than declaring a fourth octave stack, and layer 1's transfer
  // rather than a second copy of the sRGB knee.
  assert.ok(glsl.includes('st_grassSrgb(st_sandRamp(st_grassScalar(p)))'));
  assert.equal([...glsl.matchAll(/st_grassSrgb/g)].length, 1);
  // Both authored stops reach the emitted ramp, in linear, at six decimals.
  for (const stop of SAND_RAMP) {
    assert.ok(
      glsl.includes(`vec3(${stop.linear.map((v) => v.toFixed(6)).join(', ')})`),
      `the emitted ramp is missing the stop at ${stop.at}`,
    );
  }
  // The edge noise is unrolled to its own octave count — six, from the script.
  assert.equal([...glsl.matchAll(/st_grainOctave\(p \* /g)].length, SAND_OCTAVES);
});

test('sandGlsl is held to an EXACT GOLDEN — the only assertion that sees a blanked line', () => {
  // ⚠⚠ A CONTAINMENT SWEEP CANNOT SEE THIS FAILURE, and `check:mutation-diff` proved it: it
  // emptied SIXTEEN string literals in this emitter one at a time and every `includes()` test in
  // this file stayed green, because a shader missing a line still contains all the constants a
  // looser assertion looks for. The same finding `land-grass.ts` records for `rampGlsl`.
  //
  // ⚠ AND IT IS WRITTEN OUT RATHER THAN REBUILT FROM THE CONSTANTS. A golden assembled from
  // `SAND_RAMP` and `SAND_DIVISOR` would be the emitter's own arithmetic restated, and would pass
  // for any mutant that changed both sides together. This is the text a reader can check by eye
  // against `build_land.py:869-893`.
  // ⚠ LAND_SCALE moved exactly seven numerals here and nothing else (diffed against the pre-scale
  // golden): the edge noise's header spacing (31.17 -> 11.75, the recipe's 233.8 / 7.5 over the
  // SHIPPED span) and its six octave frequencies, which are that spacing's reciprocal doubled.
  assert.equal(
    sandGlsl(),
    [
      '// GENERATED from land-sand.ts — do not hand-edit these constants.',
      '// Layer 2 of the approved ground: build_land.py:869-893, mat_attribute().',
      '// st_sandEdge: Cycles scale 7.5 -> 11.75 ground units,',
      '// 6 octaves, roughness 0.5.',
      'float st_sandEdge(vec2 p) {',
      '  float s = 0.0;',
      '  s += 1.000000 * st_grainOctave(p * 0.085108);',
      '  s += 0.500000 * st_grainOctave(p * 0.170215);',
      '  s += 0.250000 * st_grainOctave(p * 0.340430);',
      '  s += 0.125000 * st_grainOctave(p * 0.680861);',
      '  s += 0.062500 * st_grainOctave(p * 1.361721);',
      '  s += 0.031250 * st_grainOctave(p * 2.723443);',
      '  return s / 1.968750;',
      '}',
      '',
      'vec3 st_sandRamp(float t) {',
      '  float st_sandRamp_f;',
      '  vec3 st_sandRamp_c = vec3(0.395000, 0.350000, 0.252000);',
      '  st_sandRamp_f = clamp((t - 0.350000) / 0.350000, 0.0, 1.0);',
      '  st_sandRamp_c = mix(st_sandRamp_c, vec3(0.612000, 0.556000, 0.412000), st_sandRamp_f);',
      '  return st_sandRamp_c;',
      '}',
      '',
      '// THE BAND FACTOR: 0 is pure sand at the water, 1 is pure grass inland.',
      '// The MULTIPLY_ADD at build_land.py:872-876 pins its multiplier to 1.0, so the edge noise',
      '// DISPLACES the distance rather than scaling it.',
      'float st_sandBand(vec2 p, float shore, float width) {',
      `  float t = (shore + ${SAND_EDGE_AMPLITUDE.toFixed(6)} * st_sandEdge(p)) / width;`,
      '  return clamp((t - 0.340000) / 0.360000, 0.0, 1.0);',
      '}',
      '',
      '// THE SAND COLOUR as a delivered sRGB triple in 0..1 — the ramp driven by LAYER 1`s own base',
      '// scalar, so the beach grains with the same field the grass does.',
      'vec3 st_sandColour(vec2 p) {',
      '  return st_grassSrgb(st_sandRamp(st_grassScalar(p)));',
      '}',
    ].join('\n'),
  );
});
