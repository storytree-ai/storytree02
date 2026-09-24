// @vitest-environment jsdom
//
// The legend bar is ADAPTIVE (one entry per world model, fans expose the full
// vocabulary): these tests pin the grounding rules — which entries appear for
// an offline frontmatter-only world vs a live one with verdicts/in-flight
// builds, that absent states render dimmed as "not in world yet", and that the
// status fan drives the same hidden-status filter the old toolbar chips did.
// The legend receives the PRESENTED world (worldStatus.ts): hue already carries
// the signed verdict (ADR-0040), so the proof row speaks hue + signpost, never
// ✓/✗ badges. Session presence no longer orbits (ADR-0048 §5) — it has no
// legend row; the world's only orbiting layer is the in-flight build.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WorldLegend, legendFacts } from './WorldLegend';
import type { BuildActivity, ClaimActivity, TreeCapability, TreeStory, WorkStatus } from '../types';

const cap = (
  id: string,
  status: WorkStatus | null,
  extra: Partial<TreeCapability> = {},
): TreeCapability => ({
  id,
  title: id,
  outcome: '',
  status,
  proofMode: 'red-green',
  dependsOn: [],
  testCount: 0,
  ...extra,
});

const story = (
  id: string,
  status: WorkStatus | null,
  capabilities: TreeCapability[],
  extra: Partial<TreeStory> = {},
): TreeStory => ({
  id,
  title: id,
  outcome: '',
  status,
  proofMode: 'UAT',
  uatWitness: 'human',
  dependsOn: [],
  consumedBy: [],
  capabilities,
  ...extra,
});

const buildFor = (unitId: string, at: string): BuildActivity => ({
  unitId,
  tier: 'capability',
  runId: `run-${unitId}`,
  at,
});

const claimFor = (unitId: string, intent: string): ClaimActivity => ({
  unitId,
  kind: 'claim',
  sessionId: `sess-${unitId}`,
  branch: `claude/${unitId}`,
  intent,
  at: '2026-06-13T23:55:00.000Z',
});

/** Today's corpus shape offline: proposed+mapped only (a zero-cap proposed story now
 *  renders the YOUNG form, the sapling state having been folded into it), no proof hues. */
const offlineWorld = (): TreeStory[] => [
  story('library', 'mapped', [cap('library-cli', 'mapped'), cap('seed-corpus', 'proposed')]),
  story('drive-machinery', 'proposed', []),
  story('studio', 'proposed', [cap('read-corpus', 'proposed')], {
    dependsOn: ['library'],
  }),
];

const noop = (): void => {};
// A fixed `now` well after every fixture's verdict.at: the bloom fixtures here
// use the literal 'now' (an unparseable date that never blooms), so the activity
// row stays absent unless a test supplies a real recent verdict.at + matching now.
const NOW = new Date('2026-06-14T00:00:00.000Z');
const renderLegend = (
  stories: TreeStory[],
  over: Partial<Parameters<typeof WorldLegend>[0]> = {},
) =>
  render(
    <WorldLegend
      stories={stories}
      now={NOW}
      hidden={new Set()}
      onToggleStatus={noop}
      onResetHidden={noop}
      {...over}
    />,
  );

afterEach(cleanup);

describe('legendFacts', () => {
  it('grounds the legend in the loaded world', () => {
    const facts = legendFacts(offlineWorld());
    expect(facts.statusTotals.get('proposed')).toEqual({ stories: 2, caps: 2 });
    expect(facts.statusTotals.get('mapped')).toEqual({ stories: 1, caps: 1 });
    // The sapling state was folded into `young` (ADR-0038 / owner 2026-06-21): the legend
    // no longer surfaces a distinct sapling fact.
    expect('saplingPresent' in facts).toBe(false);
    // no presented green — offline under-claims
    expect(facts.anyProven).toBe(false);
  });

  it('presented healthy = a signed pass painted it — anyProven on either tier', () => {
    expect(legendFacts([story('s', 'mapped', [cap('c', 'healthy')])]).anyProven).toBe(true);
    expect(legendFacts([story('s', 'healthy', [])]).anyProven).toBe(true);
    expect(legendFacts([story('s', 'mapped', [cap('c', 'mapped')])]).anyProven).toBe(false);
  });

  it('the dead-flora fact is GONE — unhealthy is a story-only state (ADR-0296 / ADR-0560)', () => {
    // Was `anyDeadFlora`. Story crowns may now wither, but capability flora still cannot, so the
    // dead-flora fact remains withdrawn.
    const facts = legendFacts([story('s', 'mapped', [cap('c', 'unhealthy')])]);
    expect('anyDeadFlora' in facts).toBe(false);
  });
  // ADR-0608 retired the flat hero tree and its growth ladder (`treeForm`: young / full / withered),
  // so there is no per-status tree form left to pin.
});

describe('WorldLegend (adaptive bar)', () => {
  it('story status is read from nameplate text — the row carries no tree silhouette (ADR-0608)', () => {
    const { container } = renderLegend(offlineWorld());

    const statusButton = screen.getByRole('button', { name: 'story status' });
    expect(statusButton.querySelector('svg')).toBeNull();
    fireEvent.click(statusButton);

    const drawer = screen.getByRole('region', { name: 'legend — story status' });
    expect(drawer.textContent).toMatch(/An island is a story\. Read its status beneath its name\./i);
    expect(drawer.textContent).toMatch(/healthy.*signed proof.*baseline/i);
    expect(drawer.textContent).toMatch(/Plants describe individual capabilities/i);
    expect(drawer.textContent).toMatch(/Active work appears as session wisps/i);
    expect(drawer.querySelector('.legend-fan svg')).toBeNull();
    expect(drawer.querySelector('.legend-fan .legend-tile-icon')).toBeNull();
    expect(container.textContent).not.toMatch(/big tree is the story itself/i);
  });

  it('offline world: no orbiting (building) entry; proof stays and explains the under-claim', () => {
    renderLegend(offlineWorld());
    for (const label of ['story status', 'test coverage', 'proof']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'decoration' })).toBeNull();
    // sessions never orbit (ADR-0048 §5) and nothing is building → no orbiting row
    expect(screen.queryByRole('button', { name: 'sessions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'building' })).toBeNull();
    // roads and focus carry no legend entry — self-explanatory in place (ADR-0038)
    expect(screen.queryByRole('button', { name: 'roads' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'focus' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'proof' }));
    expect(screen.getByText(/under-claims/)).toBeTruthy();
    // no signed verdicts anywhere — the proven hue is a dimmed example.
    expect(screen.getByText('proven green').closest('.legend-tile')?.className).toContain(
      'is-absent',
    );
    expect(screen.queryByText('witnessed')).toBeNull();
    expect(screen.queryByText('awaiting witness')).toBeNull();
  });

  it('explains provenance separately from proof (ADR-0395)', () => {
    renderLegend(offlineWorld());

    fireEvent.click(screen.getByRole('button', { name: 'story status' }));
    const treeCopy = screen.getByRole('region', { name: 'legend — story status' }).textContent ?? '';
    // ADR-0608: the amber/brown/withered tree vocabulary retired with the flat hero tree; the
    // provenance split is now taught against the nameplate's status word.
    expect(treeCopy).toMatch(/healthy[^.]*signed proof[^.]*baseline/i);
    expect(treeCopy).toMatch(/proposed[^;.]*new work[^;.]*without a proven baseline/i);
    expect(treeCopy).toMatch(/mapped[^;.]*inherited work[^;.]*adoption/i);
    expect(treeCopy).toMatch(/unhealthy[^.]*proof\s+failed/i);
    expect(treeCopy).not.toMatch(/amber|brown|withered/i);
    fireEvent.click(screen.getByRole('button', { name: 'story status' }));

    fireEvent.click(screen.getByRole('button', { name: 'test coverage' }));
    const floraCopy =
      screen.getByRole('region', { name: 'legend — test coverage' }).textContent ?? '';
    expect(floraCopy).toMatch(/signed pass[^.]*only[^.]*green/i);
    expect(floraCopy).toMatch(/signed fail[^.]*authored rung[^.]*node panel/i);
    expect(floraCopy).not.toMatch(/every other hue[^.]*unproven/i);
    fireEvent.click(screen.getByRole('button', { name: 'test coverage' }));

    fireEvent.click(screen.getByRole('button', { name: 'proof' }));
    const proofCopy = screen.getByRole('region', { name: 'legend — proof' }).textContent ?? '';
    expect(proofCopy).toMatch(/signed proof[^.]*establishes green/i);
    expect(proofCopy).toMatch(/undertaken capability[^.]*own UAT[^.]*reliability obligations/i);
    expect(proofCopy).toMatch(/baseline[^.]*stays green[^.]*later scope[^.]*incomplete/i);
    expect(proofCopy).toMatch(/story failure[^.]*withers/i);
    expect(proofCopy).toMatch(/capability[^.]*current signed pass[^.]*failure[^.]*node panel/i);
  });

  it('proof hues light their tiles without the retired witness vocabulary', () => {
    const stories = [
      story('s', 'healthy', [cap('c', 'healthy', { verdict: { outcome: 'pass', at: 'now' } })], {
        verdict: { outcome: 'pass', at: 'now' },
      }),
    ];
    renderLegend(stories);
    fireEvent.click(screen.getByRole('button', { name: 'proof' }));
    expect(screen.getByRole('region', { name: 'legend — proof' }).textContent).toContain(
      'combined story proof',
    );
    expect(screen.getByText('proven green').closest('.legend-tile')?.className).not.toContain(
      'is-absent',
    );
    expect(screen.queryByText('witnessed')).toBeNull();
    expect(screen.queryByText('awaiting witness')).toBeNull();
  });

  it('ADR-0529: a recent signed PASS lights NO activity row — the retired bloom was the row’s only icon, and the durable record is the hue', () => {
    // A verdict 2 h before NOW would have been well inside the old 6 h bloom window. There is no
    // longer a row to light: what a signed pass does is GREEN the unit (ADR-0040's provenStatus),
    // which the `proof` row already speaks for, and the legend never carried the same bit twice.
    const recent = { outcome: 'pass', at: '2026-06-13T22:00:00.000Z' } as const;
    renderLegend([story('s', 'healthy', [cap('c', 'healthy', { verdict: recent })], { verdict: recent })]);
    expect(screen.queryByRole('button', { name: 'activity' })).toBeNull();
    // …and the row it would have crowded is still there, so this is a deletion and not an outage.
    expect(screen.getByRole('button', { name: 'proof' })).toBeTruthy();
  });


  it('ADR-0212: an in-flight build lights the CLAIM row — the `building` row is retired, not renamed', () => {
    // 5 min before NOW — well inside the TTL
    renderLegend(offlineWorld(), { builds: [buildFor('studio', '2026-06-13T23:55:00.000Z')] });
    // the build no longer has a drawable of its own, so it no longer has a legend row of its own.
    expect(screen.queryByRole('button', { name: 'building' })).toBeNull();
    const chip = screen.getByRole('button', { name: 'sessions working' });
    fireEvent.click(chip);
    // the band vocabulary is taught inside the claim drawer — motion, not a second body.
    const labels = [...document.querySelectorAll('.legend-tile-label')].map((n) => n.textContent);
    for (const band of ['red', 'implementing', 'green']) {
      expect(labels).toContain(band);
    }
    // and the caption teaches the merge itself: one session is one wisp.
    expect(screen.getByText(/does not get a second wisp/)).toBeTruthy();
    // multi-run collapse needs a rule, and the legend states it.
    expect(screen.getByText(/red wins/)).toBeTruthy();
  });

  it('ADR-0212: an aged-out build lights nothing — TTL still governs (no claim row without a claim)', () => {
    // a full day before NOW — past the TTL
    renderLegend(offlineWorld(), { builds: [buildFor('studio', '2026-06-13T00:00:00.000Z')] });
    expect(screen.queryByRole('button', { name: 'sessions working' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'building' })).toBeNull();
  });

  it('a story claim lights the "sessions working" row with the §5 honesty caption (ADR-0138)', () => {
    renderLegend(offlineWorld(), { claims: [claimFor('studio', 'real')] });
    const chip = screen.getByRole('button', { name: 'sessions working' });
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    // the §5 wall, in operator language: a claim is coordination, NOT a proof; only the bloom is a verdict.
    expect(screen.getByText(/NOT a proof/)).toBeTruthy();
    expect(screen.getByText(/coordination/)).toBeTruthy();
    // all three colour-state swatches are offered in the drawer (the tile LABELS — the caption prose
    // also names them, so scope to the tile-label spans).
    const labels = [...document.querySelectorAll('.legend-tile-label')].map((n) => n.textContent);
    for (const state of ['authoring', 'proving', 'supplementing']) {
      expect(labels).toContain(state);
    }
  });

  it('the "sessions working" drawer also fans the GRADE vocabulary (ADR-0200 D7 — geometry ⟂ colour)', () => {
    renderLegend(offlineWorld(), { claims: [claimFor('studio', 'real')] });
    fireEvent.click(screen.getByRole('button', { name: 'sessions working' }));
    const labels = [...document.querySelectorAll('.legend-tile-label')].map((n) => n.textContent);
    for (const grade of ['exploring', 'waiting', 'work', 'departed']) {
      expect(labels).toContain(grade);
    }
  });

  it('nothing claimed AND nothing building → no "sessions working" row (the legend is unchanged)', () => {
    renderLegend(offlineWorld());
    expect(screen.queryByRole('button', { name: 'sessions working' })).toBeNull();
    // ADR-0212 widened the row's visibility to "claimed OR building" (a live build now renders on
    // this layer), so an in-flight build DOES light it — asserted in the ADR-0212 test above.
  });

  it('Escape closes the drawer', () => {
    renderLegend(offlineWorld());
    fireEvent.click(screen.getByRole('button', { name: 'story status' }));
    expect(screen.getByRole('region', { name: 'legend — story status' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'legend — story status' })).toBeNull();
  });

  it('the status fan dims absent states and filters present ones', () => {
    const onToggleStatus = vi.fn();
    renderLegend(offlineWorld(), { onToggleStatus });
    fireEvent.click(screen.getByRole('button', { name: 'story status' }));
    // healthy and story-only unhealthy do not occur in this world; both remain visible as dimmed
    // states in the complete story-status fan.
    expect(screen.getAllByText('not in world yet')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^proposed/ }));
    expect(onToggleStatus).toHaveBeenCalledWith('proposed');
    // building and retired are not legend STATUS states — the world folds
    // building into proposed and prunes retired (ADR-0038)
    expect(screen.queryByText('retired')).toBeNull();
  });

  it('hidden statuses surface the reset chip', () => {
    const onResetHidden = vi.fn();
    renderLegend(offlineWorld(), { hidden: new Set(['proposed']), onResetHidden });
    fireEvent.click(screen.getByRole('button', { name: /show all statuses \(1 hidden\)/ }));
    expect(onResetHidden).toHaveBeenCalled();
  });

  it('a second click on the open entry closes the drawer', () => {
    renderLegend(offlineWorld());
    const chip = screen.getByRole('button', { name: 'story status' });
    fireEvent.click(chip);
    expect(screen.getByRole('region', { name: 'legend — story status' })).toBeTruthy();
    fireEvent.click(chip);
    expect(screen.queryByRole('region', { name: 'legend — story status' })).toBeNull();
  });
});

// ADR-0230's sprite art sheets re-skinned the legend's tree and flora icons to match the flat map;
// ADR-0608 retired the sheets with the flat forest look, so the legend draws no sprite anywhere and
// no tree picture on the story-status row.
describe('WorldLegend — no sprite sheet, no tree picture (ADR-0608)', () => {
  it('renders no sprite <image> and no vector story tree anywhere in the legend', () => {
    renderLegend([story('s', 'unhealthy', [cap('c', 'proposed')])]);
    fireEvent.click(screen.getByRole('button', { name: 'story status' }));
    expect(document.querySelector('image')).toBeNull();
    expect(document.querySelector('.story-tree')).toBeNull();
    // the unhealthy tile is still offered — only its picture went.
    expect(screen.getByRole('button', { name: /^unhealthy/ })).toBeTruthy();
  });
});
