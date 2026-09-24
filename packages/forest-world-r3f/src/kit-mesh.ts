// kit-mesh.ts — THE BROWSER HALF OF THE BOUGHT KIT: parse it once, and stand the vocabulary's
// placements on the island as merged geometry.
//
// ⚠⚠ CROSSED INTO `src/` ON 2026-08-30 as a SPLIT of `harness/kit-scene.ts`. What is here is
// everything the SHIPPED canvas needs to draw a bought object; what stayed is the harness's own
// FETCH (`loadKit(url)`, which serves the `.glb` off vite) and its LIGHT CALIBRATION, which is an
// instrument that probes a renderer rather than part of the treatment. The shipped canvas has no
// `/assets/` to fetch from — the web sync carries only `.ts` — so it parses the embedded bytes
// (`kit-asset.ts`) instead, which is the same asset by construction.
//
// ⚠ IT MERGES PER MATERIAL, IT DOES NOT INSTANCE, and that is what keeps the comparison fair.
// `hardware-floor.mjs` measured this renderer DRAW-CALL bound, so an arm that issued one draw call
// per prop would be measured as far more expensive for a reason that has nothing to do with being
// bought or textured. Every placement's transform is baked into its vertices and everything
// sharing a material becomes one mesh.
//
// ⚠ AND THE LOADER ROUTES THROUGH `applyRawColourConvention`. This renderer is not
// colour-managed; a base-colour map decoded the ordinary way renders about 3.5x dark and looks
// like a deliberate art direction. `texture-convention.test.ts` refuses a loader path that skips
// it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { decodeKitAsset } from './kit-asset.js';
import {
  KIT_ASSEMBLIES,
  ALL_KIT_ROLES,
  KIT_ROLE_ASSEMBLIES,
  KIT_ROLE_SIZE,
  KIT_ROLE_TILT,
  kitObjectNames,
} from './kit-vocabulary.js';
import type {
  KitAssembly,
  KitPlacement,
  KitRole,
  RoleFootprints,
  RoleHeights,
  RoleTable,
} from './kit-vocabulary.js';
import { leafTintGain, leafTintGainFor } from './leaf-tint.js';
import { mapMeans } from './map-texels.js';
import type { DecodedMap, TexelCanvasFactory } from './map-texels.js';
import { KIT_PROP_INDIRECT_FRACTION, installPropLighting, propLightingOf } from './prop-lighting.js';
import { parseHex } from './shade-ladder.js';
import { applyRawColourConvention } from './texture-convention.js';
import type { ConventionMaterial, Rgb } from './texture-convention.js';
import { presentationMaterial } from './kit-status-presentation.js';

/** One kit object, its transform already baked so every bounding box is in one space. */
export interface KitObject {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  materialName: string;
}

/** An assembly, recentred on its own footprint with its base at y = 0. */
export interface KitAssemblyGeometry {
  objects: KitObject[];
  /** Which declared kit objects it is made of — one may contribute more than one part. */
  names: readonly string[];
  /** The assembly's own height in kit units, before it is scaled to its role's height. */
  height: number;
  /** Its widest horizontal extent in kit units — what the delivered width is derived from. */
  width: number;
}

/** The materials whose texels are LEAVES, and therefore the ones a state's tint rotates.
 *
 *  ⚠ HAND-AUTHORED, UPSTREAM OF THE ASSET, and this is what keeps the dead trunk bare. The kit
 *  gives `Pine_Trunk_No_Leaves_01` BOTH `Pine_Trunks` and `Pine_Branches` — its dead branches
 *  wear the same material as a live crown's needles. Tinting by MATERIAL alone would therefore
 *  paint a dead tree's branches yellow for a state it does not hold; the tint is a property of
 *  the PLACEMENT (`KitPlacement.tint`, `null` for the dead form) and this set only says which of
 *  that placement's parts the tint reaches. */
export const LEAF_MATERIALS: ReadonlySet<string> = new Set(['Pine_Branches']);
/** The leafy-plant material receives the coverage route, while pine state tints stay separate. */
export const COVERAGE_FOLIAGE_MATERIAL = 'Pine_Forest_Foliage';

export interface LoadedKit {
  assemblies: Map<KitAssembly, KitAssemblyGeometry>;
  materials: string[];
  /** Each leaf material's own base-colour mean over its solid texels — what a tint is rotated
   *  from. Read off the asset rather than declared, because a footprint or a mean restated here
   *  would be a second copy that drifts the first time the kit is re-exported. */
  leafMeans: Map<string, Rgb>;
  triangles: number;
  /** Bytes of the `.glb` as fetched, read off the response rather than transcribed. */
  wireBytes: number;
  textures: Array<{ name: string; width: number; height: number }>;
  /** Decoded bytes the GPU holds for those textures, mipmaps included. */
  gpuBytes: number;
}

/** The base-colour and data maps a kit material can carry, in the order a report lists them. */
export const KIT_TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const;

/** One decoded texture the kit holds, named by the slot and material that reach it. */
export interface KitTexture {
  name: string;
  width: number;
  height: number;
}

/**
 * PUT ONE KIT MATERIAL INTO THIS SURFACE'S CONVENTION.
 *
 * Two corrections the kit's own export needs for a map, both the same ones `loadPine` makes and
 * for the same reasons: the foliage is authored `BLEND`, which for a stand of cut-out leaf cards
 * is the classic sorting failure, so it is switched to an alpha TEST; and the base-colour maps
 * are put in this surface's raw convention.
 *
 * And ONE treatment of its own: the prop's ambient-to-key split (`prop-lighting.ts`) at the
 * shipped fraction, installed on the material rather than on the scene's lights so the ground's
 * calibration is untouched. At the ladder floor it multiplies by one.
 */
export function prepareKitMaterial(material: THREE.MeshStandardMaterial): void {
  if (material.transparent) {
    // `alphaTest` and `transparent` are mutually exclusive in three: leaving `transparent` on
    // keeps the mesh in the sorted transparent pass even with a test set.
    material.transparent = false;
    material.alphaTest = 0.5;
    material.depthWrite = true;
  }
  material.side = THREE.DoubleSide;
  applyRawColourConvention(material satisfies ConventionMaterial);
  installPropLighting(material, KIT_PROP_INDIRECT_FRACTION);
}

/**
 * MOVE EVERY MATERIAL THE KIT HOLDS TO ONE AMBIENT FRACTION — the comparison page's ladder lever,
 * and what a tinted clone made afterwards inherits (`tintedMaterial` copies the base's fraction).
 * Meshes already merged keep their material objects, so a scene built before this call re-lights
 * on its next frame without a rebuild.
 */
export function setKitPropLighting(kit: LoadedKit, fraction: number): void {
  // A material shared by several parts is reached several times; `installPropLighting` moves an
  // installed material in place, so the repeat is a no-op rather than a second record.
  for (const assembly of kit.assemblies.values()) {
    for (const part of assembly.objects) installPropLighting(part.material, fraction);
  }
}

/** The decoded textures one material contributes, keyed by the texture's own uuid so two slots
 *  sharing one image are counted once. */
export function materialTextures(material: THREE.MeshStandardMaterial): Array<[string, KitTexture]> {
  const out: Array<[string, KitTexture]> = [];
  for (const key of KIT_TEXTURE_SLOTS) {
    const tex = material[key];
    if (!tex || !tex.image) continue;
    const img = tex.image as { width?: number; height?: number };
    out.push([
      tex.uuid,
      { name: `${key}:${material.name}`, width: img.width ?? 0, height: img.height ?? 0 },
    ]);
  }
  return out;
}

/** How many triangles a geometry carries, indexed or not. */
export function geometryTriangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return index ? index.count / 3 : geometry.getAttribute('position').count / 3;
}

/**
 * THE DECLARED KIT OBJECT ONE PRIMITIVE BELONGS TO: its own name if that is declared, else its
 * parent group's, else its name with the primitive index stripped.
 *
 * ⚠ A KIT OBJECT WEARING TWO MATERIALS IS EXPORTED AS TWO PRIMITIVES. The dead pine wears both
 * `Pine_Trunks` and `Pine_Branches`, so glTF gives it one node with two primitives and
 * `GLTFLoader` turns that into a Group whose children are named `<object>_0`, `<object>_1`.
 * Keying on the mesh's own name loses the object entirely — which the manifest floor catches
 * rather than drawing a quietly incomplete island, but only because this resolution exists.
 */
export function declaredObjectName(
  own: string,
  parent: { name: string } | null,
  declared: ReadonlySet<string>,
): string {
  if (declared.has(own)) return own;
  // ⚠ THE PARENT ITSELF, NOT ITS NAME BEHIND A `?? ''`. A placeholder for "no parent" is
  // unobservable — every string the manifest does not declare behaves identically — so it is a
  // mutant nothing can kill, standing exactly where the resolution's own null case lives.
  if (parent && declared.has(parent.name)) return parent.name;
  return own.replace(/_\d+$/, '');
}

/** What one pass over a glTF scene accumulates. Mutable on purpose: the pass IS the read. */
export interface KitCollector {
  /** ⚠ A LIST PER NAME, NOT ONE OBJECT — see {@link declaredObjectName}. */
  objects: Map<string, KitObject[]>;
  materials: Set<string>;
  textures: Map<string, KitTexture>;
  triangles: number;
}

/** An empty collector, so a caller never has to restate its four fields. */
export function newKitCollector(): KitCollector {
  return { objects: new Map(), materials: new Set(), textures: new Map(), triangles: 0 };
}

/**
 * READ ONE SCENE NODE INTO THE COLLECTOR — the whole per-primitive half of the load.
 *
 * ⚠ EVERY GEOMETRY IS BAKED THROUGH ITS NODE'S WORLD MATRIX FIRST. glTF keeps a node transform
 * separate from its mesh, so a bounding box read straight off the geometry is in some other
 * space than the one the kit laid its objects out in — and this vocabulary's whole trunk/crown
 * relationship is a fact about that layout.
 */
export function collectKitPrimitive(
  obj: THREE.Object3D,
  declared: ReadonlySet<string>,
  into: KitCollector,
): void {
  if (!(obj instanceof THREE.Mesh)) return;
  const material = obj.material;
  if (!(material instanceof THREE.MeshStandardMaterial)) return;

  prepareKitMaterial(material);
  for (const [uuid, record] of materialTextures(material)) into.textures.set(uuid, record);

  const geometry = (obj.geometry as THREE.BufferGeometry).clone().applyMatrix4(obj.matrixWorld);
  geometry.computeBoundingBox();
  into.triangles += geometryTriangles(geometry);
  into.materials.add(material.name);

  const key = declaredObjectName(obj.name, obj.parent, declared);
  const part = { name: key, geometry, material, materialName: material.name };
  const existing = into.objects.get(key);
  if (existing) existing.push(part);
  else into.objects.set(key, [part]);
}

/**
 * THE MANIFEST FLOOR. Every count and every placement downstream is per assembly FOUND, so an
 * asset that lost an object would draw a quietly emptier island and nothing would say so.
 */
export function assertKitComplete(
  declared: Iterable<string>,
  objects: ReadonlyMap<string, unknown>,
  source: string,
): void {
  const missing = [...declared].filter((n) => !objects.has(n));
  if (missing.length > 0) {
    throw new Error(
      `kit-mesh: ${source} is missing objects the vocabulary declares: ${missing.join(', ')}. ` +
        'Re-export the kit, or correct KIT_ASSEMBLIES — an island quietly missing a prop is an ' +
        'island under-reporting the work.',
    );
  }
}

/**
 * RECENTRE ONE ASSEMBLY'S PARTS ON THEIR JOINT FOOTPRINT, base at y = 0, and measure it.
 *
 * ⚠ ONE JOINT BOX FOR THE WHOLE ASSEMBLY — see `KIT_ASSEMBLIES`. Recentring each object on its
 * OWN base drops a pine's crown 18% of the tree's height into its trunk.
 */
export function assembleParts(parts: KitObject[], names: readonly string[]): KitAssemblyGeometry {
  const box = new THREE.Box3();
  for (const part of parts) box.union(part.geometry.boundingBox!);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  // ⚠ NO `computeBoundingBox()` AFTER THE TRANSLATE. `BufferGeometry.applyMatrix4` — which
  // `translate` is — recomputes a bounding box that is already there, and every part reaching here
  // has one (the union above would have thrown otherwise). A second call changes nothing, which
  // makes it a mutant no assertion can kill.
  for (const part of parts) part.geometry.translate(-cx, -box.min.y, -cz);
  return {
    objects: parts,
    names,
    height: box.max.y - box.min.y,
    width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
  };
}

/** Decoded bytes the GPU holds for a set of textures: 4 per texel, and the full mip chain is 4/3
 *  of the base level. */
export function textureGpuBytes(textures: Iterable<KitTexture>): number {
  let gpuBytes = 0;
  for (const t of textures) gpuBytes += Math.round(t.width * t.height * 4 * (4 / 3));
  return gpuBytes;
}

/**
 * HOW A LEAF MATERIAL'S OWN BASE-COLOUR MEAN IS READ.
 *
 * ⚠ A SEAM, AND IT NAMES THE ONE BROWSER-BOUND STEP IN THE WHOLE LOAD. Decoding a texture's
 * texels needs a canvas; every claim about what the mean is FOR — that it is read once, off the
 * ASSET rather than off the delivered frame, and that a leaf material without one is refused —
 * is arithmetic, and is proved here rather than only on a GPU.
 */
export type LeafMeanReader = (image: DecodedMap) => Rgb;

/** The default reader: the map's own solid texels, averaged. The canvas comes through as a second
 *  argument so this is provable without one — see `map-texels.ts`'s {@link TexelCanvasFactory}. */
export const decodedLeafMean = (image: DecodedMap, canvasFor?: TexelCanvasFactory): Rgb =>
  mapMeans(image, canvasFor).raw;

/**
 * EACH LEAF MATERIAL'S OWN BASE-COLOUR MEAN, read ONCE from the asset's own decoded texels — not
 * declared and not derived from the delivered frame. A tint rotates a map onto a token's
 * chromaticity at the MAP's own luminance (`leaf-tint.ts`), so it needs the map's mean and
 * nothing else; taking it from the picture instead would be an expectation derived from its own
 * subject.
 */
export function collectLeafMeans(
  objects: Iterable<KitObject[]>,
  source: string,
  meanOf: LeafMeanReader = decodedLeafMean,
  leaves: ReadonlySet<string> = LEAF_MATERIALS,
): Map<string, Rgb> {
  const leafMeans = new Map<string, Rgb>();
  for (const parts of objects) {
    for (const part of parts) {
      if (!leaves.has(part.materialName)) continue;
      if (leafMeans.has(part.materialName)) continue;
      const image = part.material.map?.image as DecodedMap | undefined;
      if (!image) {
        throw new Error(
          `kit-mesh: in ${source} the leaf material ${part.materialName} carries no base-colour ` +
            'map, so a state tint has nothing to rotate — a crown would silently wear the token ' +
            'as a flat colour instead of the asset it was bought for',
        );
      }
      leafMeans.set(part.materialName, meanOf(image));
    }
  }
  const missingLeaf = [...leaves].filter((m) => !leafMeans.has(m));
  if (missingLeaf.length > 0) {
    throw new Error(
      `kit-mesh: ${source} carries none of the declared leaf materials [${missingLeaf.join(', ')}] — ` +
        "every tinted state would fall back to the kit's own green and the island would report " +
        'every capability as proven',
    );
  }
  return leafMeans;
}

/**
 * EVERYTHING DOWNSTREAM OF THE glTF PARSE — one pass over the scene, then arithmetic.
 *
 * ⚠⚠ SPLIT OUT OF {@link parseKit} SO IT CAN BE PROVED. What needs a browser in this module is
 * decoding an IMAGE; walking a scene graph, resolving which declared object a primitive belongs
 * to, recentring an assembly on its joint footprint, the manifest floor and the GPU-byte
 * arithmetic are none of them browser-bound. Left inside the load they were 101 mutants nothing
 * could reach and `check:mutation-diff` said so — the same finding that pulled `texelMeans` out
 * of the canvas read in `map-texels.ts`.
 */
export function kitFromScene(
  scene: THREE.Object3D,
  wireBytes: number,
  source: string,
  meanOf: LeafMeanReader = decodedLeafMean,
): LoadedKit {
  const declared = new Set(kitObjectNames());
  const found = newKitCollector();
  scene.traverse((obj) => collectKitPrimitive(obj, declared, found));

  assertKitComplete(declared, found.objects, source);

  const assemblies = new Map<KitAssembly, KitAssemblyGeometry>();
  for (const [assembly, names] of Object.entries(KIT_ASSEMBLIES) as Array<
    [KitAssembly, readonly string[]]
  >) {
    assemblies.set(
      assembly,
      assembleParts(
        names.flatMap((n) => found.objects.get(n)!),
        names,
      ),
    );
  }

  return {
    assemblies,
    materials: [...found.materials].sort(),
    leafMeans: collectKitLeafMeans(found.objects.values(), source, meanOf),
    triangles: found.triangles,
    wireBytes,
    textures: [...found.textures.values()],
    gpuBytes: textureGpuBytes(found.textures.values()),
  };
}

/**
 * LOAD THE KIT — the glTF parse, and then {@link kitFromScene}.
 *
 * ⚠ `updateMatrixWorld` FIRST. glTF keeps a node transform separate from its mesh and
 * `GLTFLoader` does not resolve the graph for you, so every world matrix is identity until this
 * runs — and every geometry would then be baked through the wrong one.
 */
export async function parseKit(
  bytes: ArrayBuffer,
  source: string,
  meanOf?: LeafMeanReader,
): Promise<LoadedKit> {
  // Stryker disable next-line StringLiteral: EQUIVALENT — the second argument is the base PATH
  // external URIs resolve against, and this asset has none: `kit-asset.test.ts` holds that the
  // committed `.glb` is self-contained (one BIN chunk, no `uri` anywhere in its JSON), so every
  // path resolves the same asset and no fetch is ever issued.
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  // Stryker disable next-line BooleanLiteral,CallExpression: EQUIVALENT ON THIS ASSET, and provably
  // rather than by inspection — `kit-mesh.test.ts` pins both halves of the argument.
  //
  // The ARGUMENT: `force` only reaches a node that has turned `matrixAutoUpdate` OFF, and every
  // other node dirties itself on the same call and recomputes regardless. `GLTFLoader` turns it off
  // on nothing.
  //
  // The CALL: every part of each declared assembly sits under ONE node transform in this kit, and
  // `assembleParts` recentres on the joint box — so a translation common to all of a assembly's
  // parts is subtracted straight back out, and resolving the graph or not delivers the same
  // `LoadedKit`. ⚠ THAT IS A FACT ABOUT THE ASSET, NOT ABOUT THIS CODE, and the call is REQUIRED:
  // a kit whose crown and trunk hung off different nodes, or a scaled node, would come out
  // proportioned by an accident of how it was authored. The test fails if a re-export does that,
  // and this annotation stops being true in the same run.
  gltf.scene.updateMatrixWorld(true);
  return kitFromScene(gltf.scene, bytes.byteLength, source, meanOf);
}

/**
 * PARSE THE KIT THE SHIPPED CANVAS CARRIES — the embedded bytes, not a fetch.
 *
 * ⚠ THE SHIPPED PATH HAS NO URL TO FETCH. `pnpm sync:web-engine` copies `.ts` and `.tsx` only,
 * so a module reaching for `/assets/dressing-kit.glb` would work in the parent harness and 404 in
 * the public engine copy — silently, only for visitors. `kit-asset.ts` is the same asset by
 * construction: a drift test re-derives it from the committed `.glb` byte for byte.
 */
export async function loadEmbeddedKit(): Promise<LoadedKit> {
  return parseKit(decodeKitAsset(), 'the embedded kit (src/kit-asset.ts)');
}

/**
 * THE GROUND WIDTH EACH ROLE OCCUPIES, measured off the kit's own geometry at its role's scale.
 *
 * This is what keeps two props apart (`dressIslandFromKit`'s `footprint`), and it is measured
 * rather than declared for one reason: a pine's canopy is as wide as ITS OWN geometry says once
 * scaled to 18 ground units of height, and a number restated in the vocabulary would drift the
 * first time the asset is re-exported at a different rung or with a different tree.
 *
 * The widest assembly serving a role wins, so a role's clearance is enough for any of its arms.
 */
export function roleFootprints(kit: LoadedKit): RoleFootprints {
  return roleMeasure(kit, widthAtScale);
}

/**
 * THE GROUND HEIGHT EACH ROLE REACHES, measured off the kit's own geometry at its role's scale —
 * what a placement's shadow is cast from. A HEIGHT-sized role delivers its declared height exactly
 * by construction; a WIDTH-sized one (the bloom) delivers whatever its proportions give at that
 * width, and that number is why this is measured rather than restated
 * (`KIT_HEIGHTS_2026_08_29` freezes it, `heightDriftOf` holds the two together).
 *
 * The tallest assembly serving a role wins, as the widest wins the footprint: the caster has to
 * be enough for any arm.
 */
export function roleHeights(kit: LoadedKit): RoleHeights {
  return roleMeasure(kit, heightAtScale);
}

/** One measure of every role: the LARGEST value `pick` returns over the assemblies serving it,
 *  each at its own role scale. ONE loop for the footprint and the height, so the two tables the
 *  placement and the shadow are read from cannot be measured two different ways. */
function roleMeasure(
  kit: LoadedKit,
  pick: (assembly: KitAssemblyGeometry, scale: number) => number,
): RoleTable {
  const out = {} as Record<KitRole, number>;
  for (const role of ALL_KIT_ROLES) {
    let largest = 0;
    for (const name of KIT_ROLE_ASSEMBLIES[role]) {
      const assembly = kit.assemblies.get(name);
      if (!assembly) throw new Error(`kit-mesh: no assembly ${name} for role ${role}`);
      largest = Math.max(largest, pick(assembly, assemblyRoleScale(name, assembly, role)));
    }
    out[role] = largest;
  }
  return out;
}

function collectKitLeafMeans(
  objects: Iterable<KitObject[]>,
  source: string,
  meanOf: LeafMeanReader,
): Map<string, Rgb> {
  const all = [...objects];
  const means = collectLeafMeans(all, source, meanOf);
  for (const parts of all) {
    for (const part of parts) {
      if (part.materialName !== COVERAGE_FOLIAGE_MATERIAL || means.has(part.materialName)) continue;
      const image = part.material.map?.image as DecodedMap | undefined;
      if (!image) throw new Error(`kit-mesh: coverage foliage ${part.materialName} carries no base-colour map`);
      means.set(part.materialName, meanOf(image));
    }
  }
  return means;
}

function widthAtScale(assembly: KitAssemblyGeometry, scale: number): number {
  return assembly.width * scale;
}

function heightAtScale(assembly: KitAssemblyGeometry, scale: number): number {
  return assembly.height * scale;
}

/**
 * WHAT ONE ASSEMBLY IS MULTIPLIED BY TO STAND AT A ROLE'S SIZE — the role's declared units over
 * the assembly's own extent on the axis the role is sized by.
 *
 * ⚠ THE DECLARED AXIS, not always the height. Scaling a wide flat prop by its height multiplies
 * its footprint by the same factor — see `KIT_ROLE_SIZE`. ONE function for the footprint, the
 * height and the drawn geometry, because three copies of "units over own" are three chances to
 * read the wrong axis and only one of them would show in a picture.
 */
function assemblyRoleScale(name: KitAssembly, assembly: KitAssemblyGeometry, role: KitRole): number {
  const size = KIT_ROLE_SIZE[role];
  const own = size.axis === 'height' ? assembly.height : assembly.width;
  if (!(own > 0)) throw new Error(`kit-mesh: assembly ${name} has no ${size.axis}`);
  return size.units / own;
}

/**
 * THE MATERIAL A PLACEMENT'S PART WEARS — the kit's own, or a tinted clone of it.
 *
 * ⚠ ONE CLONE PER (MATERIAL, TINT), CACHED. `MeshStandardMaterial` compiles a program per
 * material, and this renderer is draw-call bound, so a clone per PLACEMENT would trade the merge
 * this file exists to do for one draw call per tree. Three tints over one leaf material is three
 * extra draw calls on a whole island.
 */
export function tintedMaterial(
  kit: LoadedKit,
  base: THREE.MeshStandardMaterial,
  materialName: string,
  tint: string | null,
  cache: Map<string, THREE.MeshStandardMaterial>,
): THREE.MeshStandardMaterial {
  if (tint === null || (!LEAF_MATERIALS.has(materialName) && materialName !== COVERAGE_FOLIAGE_MATERIAL)) return base;
  const key = `${materialName}::${tint}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const mean = kit.leafMeans.get(materialName);
  if (!mean) throw new Error(`kit-mesh: no base-colour mean for the leaf material ${materialName}`);
  const gain = tint.startsWith('#') ? leafTintGain(parseHex(tint), mean) : leafTintGainFor(tint, mean);
  if (!gain) {
    throw new Error(
      `kit-mesh: the state ${tint} has no declared leaf tint, so a placement asking for one is ` +
        'asking the crown to carry a state the vocabulary does not name',
    );
  }
  const clone = base.clone();
  // ⚠ The gain is applied to `color`, which three multiplies into the sampled texel — so the
  // map's own variation survives and only its chromaticity moves. `ColorManagement` is off on
  // this surface (`configureExactColour`), so the three numbers reach the shader unconverted,
  // which is the whole basis of `leaf-tint.ts`'s arithmetic being predictive at all.
  clone.color.setRGB(gain.r, gain.g, gain.b);
  // ⚠ `Material.clone()` copies neither `onBeforeCompile` nor the program cache key, so the
  // prop-lighting patch has to be re-installed at the BASE's fraction — or a capability's tinted
  // crown would be lit flat beside an untinted pine lit sculpted, and the tint is the state.
  installPropLighting(clone, propLightingOf(base)?.fraction ?? KIT_PROP_INDIRECT_FRACTION);
  clone.needsUpdate = true;
  cache.set(key, clone);
  return clone;
}

/** What one placement's geometry is multiplied by to stand at its role's size — and then by the
 *  placement's OWN scale, which is 1 for everything that reports something and the size rung's
 *  spread for ground cover (`KitPlacement.scale`). */
export function placementScale(kit: LoadedKit, placement: KitPlacement): number {
  const assembly = kit.assemblies.get(placement.assembly);
  if (!assembly) throw new Error(`kit-mesh: no assembly ${placement.assembly}`);
  return assemblyRoleScale(placement.assembly, assembly, placement.role) * placement.scale;
}

/** One placement's world size in ground units, after its role's scale. */
export interface PlacementExtent {
  width: number;
  height: number;
}

/** What one placement actually occupies on the island, which is what the object floor is read
 *  against — not the size that was asked for on one axis. */
export function placementExtent(kit: LoadedKit, placement: KitPlacement): PlacementExtent {
  const assembly = kit.assemblies.get(placement.assembly)!;
  const scale = placementScale(kit, placement);
  return { width: assembly.width * scale, height: assembly.height * scale };
}

/** One merge bucket: everything sharing a material, tint, and presentation becomes one mesh. */
interface MergeBucket {
  material: THREE.MeshStandardMaterial;
  parts: THREE.BufferGeometry[];
}

/**
 * BUILD THE DRESSING: one merged mesh per (material, tint, presentation), however many props there are.
 *
 * The transform is `translate * rotate * scale`, applied to a CLONE of the kit's geometry, so
 * the kit itself is never mutated and two placements of one assembly cannot interfere.
 *
 * ⚠ THE ROTATION IS TWO ANGLES, NOT ONE. `yaw` turns the prop about the vertical and is the
 * placement's own; `KIT_ROLE_TILT` leans it off the vertical and is the ROLE's, which is how a
 * failing criterion nods over where a signed one stands up (ADR-0600). The order is `YXZ` — yaw
 * applied first, then the lean — so a wilt's lean is always away from the SAME world direction
 * however the placement turned it, which is what stops a field of them reading as a windless
 * scatter of random angles.
 *
 * ⚠ THE TINT IS PART OF THE BUCKET KEY, and it has to be: a merged mesh wears ONE material, so
 * merging a yellow-crowned tree with a green one by material alone would silently paint both
 * whichever colour arrived first — an island reporting a state that half its capabilities do not
 * hold, drawn with no error anywhere. The cost is one extra draw call per tint actually used.
 */
export function kitMeshes(
  kit: LoadedKit,
  placements: readonly KitPlacement[],
  onTransformedPart?: (placement: KitPlacement, geometry: THREE.BufferGeometry) => void,
  alphaByPlacement?: ReadonlyMap<KitPlacement, number>,
): THREE.Mesh[] {
  const byMaterial = new Map<string, MergeBucket>();
  const tints = new Map<string, THREE.MeshStandardMaterial>();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');

  for (const placement of placements) {
    const assembly = kit.assemblies.get(placement.assembly);
    if (!assembly) {
      // ⚠ ITS OWN WORDING, not `placementScale`'s. Both refuse the same missing assembly one line
      // apart, and two identical messages are two refusals no test can tell apart — which reads as
      // a redundant guard rather than as the two independent floors they are.
      throw new Error(`kit-mesh: this dressing names the assembly ${placement.assembly}, which the kit does not hold`);
    }
    const scale = placementScale(kit, placement);
    // ⚠ NO ORDER ARGUMENT. `Euler.set`'s fourth parameter defaults to the euler's OWN order, which
    // `e` was constructed with and nothing changes — restating it here is a literal no reachable
    // input can distinguish from its absence, i.e. a mutant `check:mutation-diff` cannot kill.
    e.set(KIT_ROLE_TILT[placement.role], placement.yaw, 0);
    q.setFromEuler(e);
    m.compose(
      new THREE.Vector3(placement.at.x, placement.y, placement.at.z),
      q,
      new THREE.Vector3(scale, scale, scale),
    );
    for (const part of assembly.objects) {
      const geometry = part.geometry.clone().applyMatrix4(m);
      onTransformedPart?.(placement, geometry);
      const tinted = tintedMaterial(kit, part.material, part.materialName, placement.tint, tints);
      const alpha = alphaByPlacement?.get(placement) ?? 1;
      // Bark ignores placement tint, so it still shares one bucket across crown states.
      const effectiveTint = tinted === part.material ? null : placement.tint;
      const key = `${part.materialName}::${effectiveTint}::${alpha}`;
      const bucket = byMaterial.get(key);
      if (bucket) bucket.parts.push(geometry);
      // The merge bucket already owns the material: allocate it once, when that bucket is born.
      else byMaterial.set(key, { material: presentationMaterial(tinted, alpha), parts: [geometry] });
    }
  }

  const out: THREE.Mesh[] = [];
  for (const [name, bucket] of byMaterial) {
    const merged = mergeGeometries(bucket.parts, false);
    if (!merged) {
      throw new Error(
        `kit-mesh: could not merge the ${bucket.parts.length} geometries wearing ${name} — ` +
          'they do not share an attribute set, so this dressing would silently cost one draw ' +
          'call per prop on a draw-call-bound renderer',
      );
    }
    for (const part of bucket.parts) part.dispose();
    out.push(new THREE.Mesh(merged, bucket.material));
  }
  return out;
}
