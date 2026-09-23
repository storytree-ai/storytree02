type GroundVisibleDescriptor = {
  readonly id: string;
  readonly islandId: string;
  readonly kind: 'ground' | 'island' | 'pathway';
  readonly ground: string;
};

type RegrowCursor = {
  readonly progress: number;
  readonly settled: boolean;
  readonly absentIslandIds: ReadonlySet<string>;
  readonly growingIslandProgressById: ReadonlyMap<string, number>;
  readonly hiddenPathwayIds: ReadonlySet<string>;
  readonly drawingPathwayProgressById: ReadonlyMap<string, { readonly drawn: number; readonly fromEnd: boolean }>;
};

type Growth = {
  readonly ground: object;
  readonly islandProgressById: ReadonlyMap<string, number>;
  readonly visiblePathwayProgressById: ReadonlyMap<string, { readonly drawn: number; readonly fromEnd: boolean }>;
};

// The payload and its comparison input are one cache entry: they can never be initialized apart.
let cachedGround: { readonly descriptors: readonly GroundVisibleDescriptor[] } | undefined;

function sameGroundContent(
  left: readonly GroundVisibleDescriptor[],
  right: readonly GroundVisibleDescriptor[],
): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const before = left[index];
    const after = right[index];
    if (
      before === undefined || after === undefined ||
      before.id !== after.id ||
      before.islandId !== after.islandId ||
      before.kind !== after.kind ||
      before.ground !== after.ground
    ) return false;
  }

  return true;
}

function groundFor(descriptors: readonly GroundVisibleDescriptor[]): object {
  if (cachedGround !== undefined && sameGroundContent(cachedGround.descriptors, descriptors)) {
    return cachedGround;
  }

  cachedGround = { descriptors };
  return cachedGround;
}

export function forestWorldCanvasGrowth(
  descriptors: readonly GroundVisibleDescriptor[],
  cursor: RegrowCursor | null,
): Growth {
  return {
    ground: groundFor(descriptors),
    islandProgressById: cursor === null || cursor.settled
      ? new Map()
      : new Map(cursor.growingIslandProgressById),
    visiblePathwayProgressById: cursor === null || cursor.settled
      ? new Map()
      : new Map(cursor.drawingPathwayProgressById),
  };
}
