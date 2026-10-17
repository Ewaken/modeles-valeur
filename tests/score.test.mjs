import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildPoints, rank } from '../scripts/score.mjs';

const FIX = resolve(process.cwd(), 'tests/fixtures');
const aaModels = JSON.parse(readFileSync(resolve(FIX, 'aa.json'), 'utf8')).data;
const orModels = JSON.parse(readFileSync(resolve(FIX, 'or.json'), 'utf8')).data;

const bySlug = (s) => aaModels.find((m) => m.slug === s);
const byId = (id) => orModels.find((m) => m.id === id);

// Match construits à la main, comme sortis de matchModels : pas de fetch.
const matches = [
  { aa: bySlug('model-alpha'), or: byId('provider/model-alpha'), method: 'fuzzy', ambiguous: false },
  { aa: bySlug('model-beta'), or: byId('provider/model-beta'), method: 'fuzzy', ambiguous: false },
  { aa: bySlug('alias-special'), or: byId('vendor/thing'), method: 'alias', ambiguous: false },
  { aa: bySlug('model-gamma'), or: null, method: 'unmatched', ambiguous: false },
];

// Mardi 8h UTC : hors plage des overrides semaine (9-17h) et week-end, prix de base.
const HORS_OVERRIDE = new Date('2026-10-13T08:00:00Z');
const opts = { workload: 'chat', scenario: 'current', index: 'intelligence', now: HORS_OVERRIDE };

test('value = qualité / coût', () => {
  const points = buildPoints(matches, opts);
  const alpha = points.find((p) => p.aa.slug === 'model-alpha');
  const beta = points.find((p) => p.aa.slug === 'model-beta');
  assert.ok(Math.abs(alpha.value - 60 / 0.0035) < 0.01, `alpha ~17142.86, got ${alpha.value}`);
  assert.ok(Math.abs(beta.value - 40 / 0.00035) < 0.01, `beta ~114285.71, got ${beta.value}`);
});

test('frontière de Pareto exclut le dominé', () => {
  const points = buildPoints(matches, opts);
  const pareto = Object.fromEntries(points.map((p) => [p.aa.slug, p.pareto]));
  // special (q55, coût 0.015) est dominé par alpha (q60, coût 0.0035).
  assert.equal(pareto['model-alpha'], true);
  assert.equal(pareto['model-beta'], true);
  assert.equal(pareto['alias-special'], false);
});

test('qualité nulle exclue du classement', () => {
  const points = buildPoints(matches, opts);
  assert.equal(points.length, 3);
  assert.ok(!points.some((p) => p.aa.slug === 'model-gamma'));
});

test('classement : frontière puis valeur', () => {
  const points = buildPoints(matches, opts);
  assert.deepEqual(rank(points).map((p) => p.aa.slug), ['model-beta', 'model-alpha', 'alias-special']);
});