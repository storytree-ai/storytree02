import { describe, it, expect } from 'vitest';
import { deriveOfflineAssets, type KnowledgeUnitLike } from './deriveOfflineCorpus';
import { libraryTemplates } from '@storytree/library';

// ADR-0210: deriveOfflineAssets is the in-memory replacement for build-corpus.mjs — it renders the
// structured knowledge seed into GuidanceAssets and appends the library templates, so the offline
// JsonBackend can seed its runtime store without a committed generated assets.json.

const unit = (over: Partial<KnowledgeUnitLike> & { id: string; kind: string }): KnowledgeUnitLike => ({
  title: over.id.toUpperCase(),
  description: 'one line',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...over,
});

describe('deriveOfflineAssets', () => {
  it('maps knowledge units to assets (category = kind) then appends the 12 templates', async () => {
    const assets = await deriveOfflineAssets([
      unit({ id: 'u1', kind: 'definition' }),
      unit({ id: 'u2', kind: 'principle' }),
    ]);

    // knowledge first, in order
    expect(assets.slice(0, 2).map((a) => a.id)).toEqual(['u1', 'u2']);
    expect(assets[0]?.category).toBe('definition');
    expect(typeof assets[0]?.body).toBe('string');

    // the templates follow, matching libraryTemplates() exactly
    const templateIds = libraryTemplates().map((t) => t.id);
    expect(assets.slice(2).map((a) => a.id)).toEqual(templateIds);
    expect(assets.filter((a) => a.category === 'template')).toHaveLength(12);
  });

  it('an empty knowledge seed yields exactly the templates', async () => {
    const assets = await deriveOfflineAssets([]);
    expect(assets).toHaveLength(12);
    expect(assets.every((a) => a.category === 'template')).toBe(true);
  });

  it('carries provenance through only when the unit has it', async () => {
    const [withProv, withoutProv] = await deriveOfflineAssets([
      unit({ id: 'p1', kind: 'definition', provenance: 'Imported from v1' }),
      unit({ id: 'p2', kind: 'definition' }),
    ]);
    expect(withProv?.provenance).toBe('Imported from v1');
    expect(withoutProv && 'provenance' in withoutProv).toBe(false);
  });

  it('computes a decision\'s card line and superseded status on read — nothing stores them (ADR-0609)', async () => {
    const decision = (id: string, over: Partial<KnowledgeUnitLike> = {}): KnowledgeUnitLike => {
      const { description: _d, ...rest } = unit({ id, kind: 'adr', title: `Title of ${id}`, status: 'accepted', ...over });
      return rest;
    };
    const assets = await deriveOfflineAssets([
      decision('adr-0001', { status: 'superseded' }), // a legacy stored word — the edge below backs it
      decision('adr-0002', { supersedes: [1] }),
      decision('adr-0003', { status: 'superseded' }), // a legacy word NO decided record backs
      decision('adr-0004', { status: 'proposed' }),
      unit({ id: 'p1', kind: 'principle', status: 'superseded' }),
    ]);
    const byId = new Map(assets.map((a) => [a.id, a]));
    expect(byId.get('adr-0001')?.description).toBe('ADR-0001 — Title of adr-0001');
    expect(byId.get('adr-0001')?.status).toBe('superseded');
    expect(byId.get('adr-0002')?.status).toBe('accepted');
    expect(byId.get('adr-0003')?.status).toBe('accepted');
    expect(byId.get('adr-0004')?.status).toBe('proposed');
    // A non-decision keeps its authored line and its own status word.
    expect(byId.get('p1')?.description).toBe('one line');
    expect(byId.get('p1')?.status).toBe('superseded');
  });
});
