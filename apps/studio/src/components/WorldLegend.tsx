// WorldLegend — the story world's legend bar (ADR-0036 d.6c, model-per-row
// rework; vocabulary recalibrated by ADR-0038).
//
// Games-style: ONE entry per world model (story trees, test-coverage flora,
// proof marks, in-flight builds), representative state
// icons side by side, a single caption. Clicking an entry expands a drawer
// fanning out that model's FULL state vocabulary — states that don't occur in
// the current world render dimmed ("not in world yet"), and entries whose model
// has no instance at all (no verdicts, nothing building) drop out of the bar
// entirely, so the legend only ever describes what's on screen. Session
// presence has NO legend row — it no longer orbits (ADR-0048 §5); it lives in
// the toolbar's session dock. Roads and the focus tints carry no legend entry —
// they're self-explanatory in place (ADR-0038). The legend receives the
// PRESENTED world (worldStatus.ts): retired is pruned and building wears
// proposed before anything reaches here.
//
// The status fan doubles as the status filter (it absorbed the old toolbar
// chips): tiles toggle the same `hidden` set, and the world fades matching
// trees/flora. Icons reuse the world's OWN css classes (story-tree st-*,
// garden-flora, story-sign, world-wisp band-building), so the legend can never
// drift from the world's palette — it IS the world's palette.
//
// The captions carry the observability contract's caveats in operator-facing
// text: green-is-the-signed-verdict (ADR-0040 — authored status can never paint
// green), story failure/unresolved health withers the crown (ADR-0560),
// non-green capability hue reveals the honest authored rung (ADR-0395),
// crown-is-never-a-roll-up, offline-under-claims, and
// build-wisps-are-the-harness (ADR-0048).

import { useEffect, useRef, useState } from 'react';
import { anyInFlight } from '../lib/activity';
import type { BuildActivity, ClaimActivity, SubagentColourState, TreeStory } from '../types';

// ADR-0212 retired the `building` row: the build wisp is no longer its own drawable, so it is no
// longer its own legend row — the band it contributes is taught inside `claim`, where the one
// session body now lives.
export type RowKey = 'tree' | 'flora' | 'proof' | 'claim';

/**
 * Status fan order: the story growth ladder. `building` folds into proposed
 * and `retired` never reaches the legend; unhealthy remains a story-only
 * withered state (worldStatus.ts, ADR-0038/0296/0395/0560).
 */
const STATUS_ORDER = ['proposed', 'mapped', 'healthy', 'unhealthy'] as const;

/** Statuses an ALIVE plant can wear in the world. Since ADR-0296 withdrew the
 *  withered form from the picture, every rendered status is an alive one. */
const ALIVE_STATUSES = ['proposed', 'mapped', 'healthy'] as const;

export interface LegendFacts {
  /** status → instance counts across both tiers ('unknown' = spec error / no status). */
  statusTotals: Map<string, { stories: number; caps: number }>;
  /** Any unit wears healthy — which, post ADR-0040, only a signed pass can paint. */
  anyProven: boolean;
}

/**
 * Ground the legend in the loaded world: which states actually occur right now.
 * Receives the PRESENTED world (worldStatus.ts), so `healthy` here already
 * means "the last signed run passed" — authored paint never reaches it.
 */
export function legendFacts(stories: TreeStory[]): LegendFacts {
  const statusTotals = new Map<string, { stories: number; caps: number }>();
  const bump = (key: string, tier: 'stories' | 'caps'): void => {
    const cur = statusTotals.get(key) ?? { stories: 0, caps: 0 };
    cur[tier] += 1;
    statusTotals.set(key, cur);
  };
  let anyProven = false;
  for (const s of stories) {
    const st = s.status ?? 'unknown';
    bump(st, 'stories');
    if (st === 'healthy') anyProven = true;
    for (const c of s.capabilities) {
      const cst = c.status ?? 'unknown';
      bump(cst, 'caps');
      if (cst === 'healthy') anyProven = true;
    }
  }
  return {
    statusTotals,
    anyProven,
  };
}

// ---------- mini icons (world css classes — the world's palette, never a copy) ----------

function PlantIcon({
  status,
  dead,
}: {
  status: string;
  dead?: boolean;
}): React.JSX.Element {
  if (dead) {
    return (
      <svg viewBox="-12 -18 24 24" aria-hidden="true">
        <g className={`garden-flora st-${status}`}>
          <ellipse className="flora-bed" cx={0} cy={0.4} rx={8} ry={2.8} opacity={0.7} />
          <path
            className="flora-dead-stem"
            strokeWidth={1.2}
            d="M 0.5 0 C 0.6 -6 0.4 -10 2.6 -11.4 C 4.4 -12.4 5.8 -10.8 5.6 -9.2"
          />
          <circle className="flora-dead-head flora-dead-accent" cx={5.6} cy={-8.2} r={1.7} />
          <path className="flora-dead-stem" strokeWidth={1.1} d="M -3.5 0 C -4 -5 -4.5 -8.5 -2.5 -10" />
          <circle className="leaf-litter" cx={-7} cy={-0.5} r={1} />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="-12 -19 24 24" aria-hidden="true">
      <g className={`garden-flora st-${status}`}>
        <polygon
          className="flora-dark"
          points="0,-12.5 5.5,-10.5 8.5,-5.5 7,-1 0,0.8 -7,-1 -8.5,-5.5 -5.5,-10.5"
        />
        <polygon
          className="flora-light"
          points="-1,-12.5 4.5,-10.8 6,-7 0.5,-5.6 -4.8,-7.4 -4.6,-10.6"
        />
        <circle className="flora-core" cx={2} cy={-7.5} r={1.5} />
      </g>
    </svg>
  );
}

/** A work body wearing a live BUILD BAND (ADR-0212) — the same `world-claim-wisp state-<x>` ring as
 *  {@link ClaimWispIcon} plus its `band-<x>` class, because since ADR-0212 there is no separate build
 *  drawable to draw: the band rides the ONE session body. Reusing the world's own classes is what
 *  keeps the swatch honest — the band is a MOTION channel in CSS, so this swatch inherits the same
 *  steady-red / pulsing-green behaviour the map shows, and inherits the hue from `state` (never
 *  green) rather than restating it here. */
function BuildBandIcon({
  state,
  band,
}: {
  state: SubagentColourState;
  band: 'red' | 'building' | 'green';
}): React.JSX.Element {
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden="true">
      <g className={`world-claim-wisp state-${state} band-${band}`}>
        <circle className="world-claim-wisp-glow" r={5.5} />
        <circle className="world-claim-wisp-dot" r={2.2} />
      </g>
    </svg>
  );
}

/** The story-CLAIM wisp (ADR-0138 §5) — the world's OWN `world-claim-wisp state-<x>` classes (the
 *  hollow ring + core), so the legend swatch can never drift from the live claim wisp AND can never be
 *  mistaken for the proven-green HUE (the §5 honesty wall, in the legend too). `state` picks the role hue.
 *  This is the WORK grade's icon (the classic orbit) — see {@link HoverWispIcon}/{@link QueueWispIcon}
 *  for the other two grades (ADR-0200 D7). */
function ClaimWispIcon({ state }: { state: SubagentColourState }): React.JSX.Element {
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden="true">
      <g className={`world-claim-wisp state-${state}`}>
        <circle className="world-claim-wisp-glow" r={5.5} />
        <circle className="world-claim-wisp-dot" r={2.2} />
      </g>
    </svg>
  );
}

/** The EXPLORING-grade claim wisp (ADR-0200 D7) — the world's own `world-hover-wisp state-<x>`
 *  classes, so the legend can never drift from the live hovering wisp. */
function HoverWispIcon({ state }: { state: SubagentColourState }): React.JSX.Element {
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden="true">
      <g className={`world-hover-wisp state-${state}`}>
        <circle className="world-hover-wisp-glow" r={5.5} />
        <circle className="world-hover-wisp-dot" r={2.2} />
      </g>
    </svg>
  );
}

/** The WAITING-grade claim wisp (ADR-0200 D7) — the world's own `world-queue-wisp state-<x>`
 *  classes, so the legend can never drift from the live queued wisp. */
function QueueWispIcon({ state }: { state: SubagentColourState }): React.JSX.Element {
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden="true">
      <g className={`world-queue-wisp state-${state}`}>
        <circle className="world-queue-wisp-glow" r={5.5} />
        <circle className="world-queue-wisp-dot" r={2.2} />
      </g>
    </svg>
  );
}

/** A departing claim's icon (ADR-0200 D7) — the world's own `world-departing-wisp` classes (no
 *  colour-state — a departure carries none, it wears the fixed neutral slate tone). */
function DepartingWispIcon(): React.JSX.Element {
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden="true">
      <g className="world-departing-wisp">
        <circle className="world-departing-wisp-glow" r={5.5} />
        <circle className="world-departing-wisp-dot" r={2.2} />
      </g>
    </svg>
  );
}

// ---------- tiles & fans ----------

function Tile({
  icon,
  label,
  note,
  absent,
  off,
  wide,
  title,
  onClick,
  pressed,
}: {
  icon?: React.JSX.Element | undefined;
  label: string;
  note?: string;
  absent?: boolean;
  off?: boolean;
  wide?: boolean;
  title?: string;
  onClick?: () => void;
  pressed?: boolean | undefined;
}): React.JSX.Element {
  const cls = `legend-tile${absent ? ' is-absent' : ''}${off ? ' is-off' : ''}${wide ? ' is-wide' : ''}`;
  const body = (
    <>
      {icon && <span className="legend-tile-icon">{icon}</span>}
      <span className="legend-tile-label">{label}</span>
      {note && <span className="legend-tile-note">{note}</span>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={onClick}
        title={title ?? ''}
        {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} title={title ?? ''}>
      {body}
    </div>
  );
}

function countNote(tot: { stories: number; caps: number }): string {
  const parts: string[] = [];
  if (tot.stories > 0) parts.push(`${tot.stories} ${tot.stories === 1 ? 'story' : 'stories'}`);
  if (tot.caps > 0) parts.push(`${tot.caps} ${tot.caps === 1 ? 'cap' : 'caps'}`);
  return parts.join(' · ');
}

// ---------- the legend model (shared by the chip bar + the drawer body) ----------

/** One legend row's chip facts. The drawer body keyed off `key` lives in {@link LegendDrawerBody}. */
interface LegendRow {
  key: RowKey;
  label: string;
  visible: boolean;
  icons: React.JSX.Element;
}

export interface LegendModel {
  facts: LegendFacts;
  rows: LegendRow[];
  totals: (st: string) => { stories: number; caps: number };
  unknownPresent: boolean;
}

/** Derive the legend's grounded model from the loaded world — the chip rows + the facts the
 *  drawer bodies read. Pure (no state); shared by the dock and the Shared Islands panel so the
 *  two render the SAME legend. Exported as {@link legendModelFor} for the panel's flyout.
 *  `claims` (ADR-0138 §5) is optional + defaults to none, so a caller that doesn't render the claim
 *  layer (the flag is off) keeps the legend exactly as it was. */
export function legendModelFor(
  stories: TreeStory[],
  builds: BuildActivity[],
  now: Date,
  claims: ClaimActivity[] = [],
): LegendModel {
  return legendModel(stories, builds, now, claims);
}

function legendModel(
  stories: TreeStory[],
  builds: BuildActivity[],
  now: Date,
  claims: ClaimActivity[] = [],
): LegendModel {
  const facts = legendFacts(stories);
  const totals = (st: string): { stories: number; caps: number } =>
    facts.statusTotals.get(st) ?? { stories: 0, caps: 0 };
  const present = (st: string): boolean => {
    const t = totals(st);
    return t.stories > 0 || t.caps > 0;
  };
  const building = anyInFlight(builds, now);
  const rows: LegendRow[] = [
    {
      // ADR-0608: the flat hero tree retired with the flat forest look, so a story's status is
      // read from the word beneath its nameplate — the row carries no tree picture to point at.
      key: 'tree',
      label: 'story status',
      visible: true,
      icons: <></>,
    },
    {
      key: 'flora',
      label: 'test coverage',
      visible: stories.some((s) => s.capabilities.length > 0),
      icons: <PlantIcon status={ALIVE_STATUSES.find((st) => totals(st).caps > 0) ?? 'unknown'} />,
    },
    {
      // Always visible: "no proof on screen" is itself a state of the world —
      // it's exactly what an offline operator needs the legend to explain
      // (ADR-0033 d.3 / ADR-0040's under-claim rule).
      key: 'proof',
      label: 'proof',
      visible: true,
      icons: <>{facts.anyProven && <PlantIcon status="healthy" />}</>,
    },
    {
      // The coordination layer (ADR-0138 §5): a claim wisp orbits while a SESSION is working a story
      // ("someone is here"), coloured by what the orchestrator is doing. NOT a proof — only a signed
      // verdict paints the proven-green HUE (the §5 honesty wall). Drops out when nothing is claimed (flag off
      // → no claims → no row), so `main` never shows it until the owner attests.
      // ADR-0212: the retired `building` row folded in here — a live build is now a BAND on this same
      // body, so the row is visible when anything is claimed OR building.
      key: 'claim',
      label: 'sessions working',
      visible: claims.length > 0 || building,
      icons: <ClaimWispIcon state="authoring" />,
    },
  ];
  return { facts, rows, totals, unknownPresent: present('unknown') };
}

/** A row's human label, for the flyout heading / aria. */
export function legendRowLabel(key: RowKey): string {
  return (
    {
      tree: 'story status',
      flora: 'test coverage',
      proof: 'proof',
      claim: 'sessions working',
    } as const
  )[key];
}

/**
 * One legend row's drawer BODY — the state fan + caption, with NO positioning wrapper. Shared
 * by the legacy bottom dock and the Shared Islands panel's right-flyout, so the legend content
 * can never drift between the two surfaces. Keeps the `role="region"` + `legend — <row>` aria
 * label that the existing tests / a11y rely on.
 */
export function LegendDrawerBody({
  rowKey,
  model,
  hidden,
  onToggleStatus,
}: {
  rowKey: RowKey;
  model: LegendModel;
  hidden: ReadonlySet<string>;
  onToggleStatus: (st: string) => void;
}): React.JSX.Element {
  const { facts, totals, unknownPresent } = model;
  const region = (label: string, body: React.JSX.Element): React.JSX.Element => (
    <div className="legend-drawer" role="region" aria-label={`legend — ${label}`}>
      {body}
    </div>
  );
  if (rowKey === 'tree') {
    return region(
      'story status',
      <>
        <div className="legend-fan">
          {STATUS_ORDER.map((st) => {
            const tot = totals(st);
            const here = tot.stories > 0 || tot.caps > 0;
            const off = hidden.has(st);
            return (
              <Tile
                key={st}
                label={st}
                note={here ? `${countNote(tot)}${off ? ' — hidden' : ''}` : 'not in world yet'}
                absent={!here}
                off={off}
                {...(here
                  ? {
                      onClick: () => onToggleStatus(st),
                      pressed: off,
                      title: off ? `show ${st}` : `fade ${st}`,
                    }
                  : {})}
              />
            );
          })}
          {unknownPresent && (
            <Tile
              label="unknown"
              note={`${countNote(totals('unknown'))}${hidden.has('unknown') ? ' — hidden' : ''}`}
              off={hidden.has('unknown')}
              onClick={() => onToggleStatus('unknown')}
              pressed={hidden.has('unknown')}
              title="spec missing or failed to parse"
            />
          )}
        </div>
        <p className="legend-cap">
          An island is a <strong>story</strong>. Read its status beneath its name.{' '}
          <strong>healthy</strong> means signed proof established its baseline.{' '}
          <strong>proposed</strong> is new work without a proven baseline; <strong>mapped</strong>{' '}
          is inherited work awaiting or completing adoption; <strong>unhealthy</strong> means proof
          failed or an authored issue remains. Plants describe individual capabilities. Active work
          appears as session wisps. Click a tile to fade that status across the forest.
        </p>
      </>,
    );
  }
  if (rowKey === 'flora') {
    return region(
      'test coverage',
      <>
        <div className="legend-fan">
          <Tile
            icon={<PlantIcon status={ALIVE_STATUSES.find((st) => totals(st).caps > 0) ?? 'unknown'} />}
            label="alive"
            note="colour = status, same key as the trees"
          />
        </div>
        <p className="legend-cap">
          Flora density is a compressed view of each capability&apos;s declared,{' '}
          <strong>test-proven contracts</strong>: more behavioural obligations grow a denser drift,
          but one plant is not one source test. Colour preserves the authored rung when proof is
          missing or failing: proposed greenfield work is amber, while inherited mapped brownfield
          provenance is brown. A current signed pass is the only source of green. A signed{' '}
          <em>fail</em> falls to the authored rung while remaining visible on the node panel&apos;s
          verdict line.
        </p>
      </>,
    );
  }
  if (rowKey === 'proof') {
    return region(
      'proof',
      <>
        <div className="legend-fan">
          <Tile
            icon={<PlantIcon status="healthy" />}
            label="proven green"
            note="the last signed run passed"
            absent={!facts.anyProven}
          />
        </div>
        <p className="legend-cap">
          Signed proof establishes green. A story&apos;s crown answers to the combined story proof:
          every undertaken capability plus the story&apos;s own UAT and reliability obligations. Once
          that delivered scope establishes a baseline, the crown stays green while later scope is
          merely incomplete; a current story <em>failure</em> withers it. A capability still needs a
          current signed pass; its failure remains visible on the node panel&apos;s verdict line while
          the plant falls back to the honest authored rung. With the live store down, verdicts are absent and the world{' '}
          <strong>under-claims</strong>: proposed greenfield work is amber, inherited mapped
          brownfield provenance is brown, and an explicitly authored unresolved story-health
          issue remains unhealthy; the store banner is the signal.
        </p>
      </>,
    );
  }
  if (rowKey === 'claim') {
    return region(
      'sessions working',
      <>
        <div className="legend-fan">
          <Tile
            icon={<ClaimWispIcon state="authoring" />}
            label="authoring"
            note="a session is shaping the story (story-author)"
          />
          <Tile
            icon={<ClaimWispIcon state="proving" />}
            label="proving"
            note="driving the red-green gate — a claim, NOT yet a proof"
          />
          <Tile
            icon={<ClaimWispIcon state="supplementing" />}
            label="supplementing"
            note="wiring / glue around the story"
          />
        </div>
        <p className="legend-cap">
          A hollow orbiting ring means <strong>a session is working this story</strong> right now —
          the <strong>coordination</strong> signal (so another session waits / pulls after its merge
          instead of stomping it, ADR-0138). Its colour says what the orchestrator is doing:{' '}
          <strong>authoring</strong> (amber), <strong>proving</strong> (teal), or{' '}
          <strong>supplementing</strong> (violet). It is <strong>NOT a proof</strong>: a claim — even
          a “proving” one — never greens the story. Only a <strong>signed verdict</strong> paints the
          proven-green <strong>colour</strong> (ADR-0040), and that colour is the durable record. The
          ring self-clears when the session’s branch merges or its claim goes stale.
        </p>
        {/* ADR-0200 D7: the claim's GRADE — a SEPARATE dimension from the colour above (geometry ⟂
            colour): which shape a claim takes, not what the orchestrator is doing. */}
        <div className="legend-fan">
          <Tile
            icon={<HoverWispIcon state="proving" />}
            label="exploring"
            note="at rest beside the tree — reading / planning, not yet committed"
          />
          <Tile
            icon={<QueueWispIcon state="proving" />}
            label="waiting"
            note="queued in line — behind the session holding work"
          />
          <Tile icon={<ClaimWispIcon state="proving" />} label="work" note="orbiting — driving / editing" />
          <Tile
            icon={<DepartingWispIcon />}
            label="departed"
            note="a claim just released — fading, no longer held"
          />
        </div>
        <p className="legend-cap">
          Its <strong>shape</strong> is a separate signal from its colour: a dashed ring at rest means{' '}
          <strong>exploring</strong>, a small dim dot in a line means <strong>waiting</strong>, and the
          full orbiting ring above means <strong>work</strong> — the exclusive build/edit hold. A plain
          grey ring with no colour at all means the claim just <strong>departed</strong>: it fades out
          over a couple of minutes rather than vanishing outright, so a released claim reads as “someone
          just left,” never as a claim still silently held.
        </p>
        {/* ADR-0212: the retired `building` row, folded in as a THIRD dimension of the same body —
            what the session's build is doing. Position = stage, colour = intent, motion = build. */}
        <div className="legend-fan">
          <Tile
            icon={<BuildBandIcon state="proving" band="red" />}
            label="red"
            note="holding on a failing test — steady, not breathing"
          />
          <Tile
            icon={<BuildBandIcon state="proving" band="building" />}
            label="implementing"
            note="driving the gate — a steady working pulse"
          />
          <Tile
            icon={<BuildBandIcon state="proving" band="green" />}
            label="green"
            note="the run went green — quickening, but the ring stays its intent colour"
          />
        </div>
        <p className="legend-cap">
          A working session that is also <strong>building</strong> does not get a second wisp — one
          session is always one wisp (ADR-0212). Instead the same ring changes its{' '}
          <strong>motion</strong>: <strong>steady</strong> while a run holds red, a working{' '}
          <strong>pulse</strong> while it implements, and a <strong>quickened</strong> pulse once it
          observes green. With several runs on one story, <strong>red wins</strong> — a green
          elsewhere never masks a failing run. Note what does <em>not</em> change: the{' '}
          <strong>colour</strong>. A green run leaves the ring teal/amber/violet, because a build
          going green is not a signed verdict, and only a signed verdict greens the story itself.
        </p>
      </>,
    );
  }
  throw new Error(`unknown legend row: ${rowKey satisfies never}`);
}

// ---------- the legend ----------

/**
 * The world legend. Two surfaces share one model:
 *   • UNCONTROLLED (the legacy bottom dock, `variant` absent): owns its own open state and
 *     renders the drawer DOWNWARD under the chip bar (Escape / click-outside dismiss).
 *   • CONTROLLED (the Shared Islands panel, ADR-0088): the panel owns `open`/`onToggle` (the
 *     shared right-flyout) and renders the {@link LegendDrawerBody} itself, to the RIGHT of the
 *     panel. WorldLegend then renders ONLY the chip bar (`renderDrawer={false}`), so a chip
 *     expansion never reflows the panel's vertical content.
 */
export function WorldLegend({
  stories,
  builds = [],
  claims = [],
  now,
  hidden,
  onToggleStatus,
  onResetHidden,
  open: openProp,
  onToggle,
  renderDrawer = true,
  barClassName,
}: {
  stories: TreeStory[];
  builds?: BuildActivity[];
  /** ADR-0138 §5: in-flight story claims; default none, so a caller with the flag off keeps the
   *  legend unchanged (no "sessions working" row). */
  claims?: ClaimActivity[];
  now: Date;
  hidden: ReadonlySet<string>;
  onToggleStatus: (st: string) => void;
  onResetHidden: () => void;
  /** Controlled open row (panel mode). When provided, internal open state is not used. */
  open?: RowKey | null;
  /** Controlled toggle (panel mode). Receives the next open key or null. */
  onToggle?: (key: RowKey | null) => void;
  /** Render the drawer body inline under the bar (default, dock mode). The panel passes false
   *  and renders {@link LegendDrawerBody} in its right-flyout instead. */
  renderDrawer?: boolean;
  /** Extra class on the chip bar (e.g. a vertical-wrap variant in the panel). */
  barClassName?: string;
}): React.JSX.Element {
  const controlled = openProp !== undefined && onToggle !== undefined;
  const [openState, setOpenState] = useState<RowKey | null>(null);
  const open = controlled ? (openProp ?? null) : openState;
  const dockRef = useRef<HTMLDivElement>(null);
  // Uncontrolled dock: an open drawer covers a lot of map — Escape and any click outside
  // dismiss it. (Controlled panel mode wires its own dismissal at the flyout level.)
  useEffect(() => {
    if (controlled || !open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenState(null);
    };
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && !dockRef.current?.contains(e.target)) setOpenState(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, controlled]);

  const model = legendModel(stories, builds, now, claims);
  const toggle = (key: RowKey): void => {
    if (controlled) onToggle?.(open === key ? null : key);
    else setOpenState((cur) => (cur === key ? null : key));
  };
  const openRow = open ? model.rows.find((r) => r.key === open && r.visible) : undefined;

  return (
    <div className={controlled ? 'world-legend-panel' : 'world-legend-dock'} ref={dockRef}>
      <div className={`legend-bar${barClassName ? ` ${barClassName}` : ''}`} role="group" aria-label="legend">
        {model.rows
          .filter((r) => r.visible)
          .map((r) => (
            <button
              key={r.key}
              type="button"
              className={`legend-chip${open === r.key ? ' on' : ''}`}
              aria-expanded={open === r.key}
              onClick={() => toggle(r.key)}
            >
              {r.icons}
              {r.label}
            </button>
          ))}
        {hidden.size > 0 && (
          <button type="button" className="legend-chip legend-reset" onClick={onResetHidden}>
            show all statuses ({hidden.size} hidden)
          </button>
        )}
      </div>

      {renderDrawer && openRow && (
        <LegendDrawerBody
          rowKey={openRow.key}
          model={model}
          hidden={hidden}
          onToggleStatus={onToggleStatus}
        />
      )}
    </div>
  );
}
