import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildPoints, rank, qualityOf, dedupByOrId } from '../scripts/score.mjs';

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
  // Modèle sans tarif OpenRouter : doit être exclu par le garde !Number.isFinite.
  { aa: bySlug('alias-special'), or: { id: 'vendor/free-thing', name: 'Free Thing', pricing: {} }, method: 'fuzzy', ambiguous: false },
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

test('modèle sans tarif (coût NaN) exclu du classement', () => {
  const points = buildPoints(matches, opts);
  assert.ok(!points.some((p) => p.or.id === 'vendor/free-thing'));
  assert.ok(points.every((p) => Number.isFinite(p.costPerTask)));
});

test('classement : frontière puis valeur', () => {
  const points = buildPoints(matches, opts);
  assert.deepEqual(rank(points).map((p) => p.aa.slug), ['model-beta', 'model-alpha', 'alias-special']);
});

test('qualityOf agentic lit le bon champ', () => {
  const a = { intelligence_index: 60, artificial_analysis_coding_index: 55, artificial_analysis_agentic_index: 80 };
  assert.equal(qualityOf(a, 'agentic'), 80);
});

// ── dedupByOrId ─────────────────────────────────────────────────────

test('dedupByOrId : 5 variants → 1 entrée, slug le plus court, merged === 4', () => {
  const variants = [
    { aa: { slug: 'claude-haiku-5-5-low' }, or: { id: 'anthropic/claude-haiku-5.5' } },
    { aa: { slug: 'claude-haiku-5-5' }, or: { id: 'anthropic/claude-haiku-5.5' } },
    { aa: { slug: 'claude-haiku-5-5-high' }, or: { id: 'anthropic/claude-haiku-5.5' } },
    { aa: { slug: 'claude-haiku-5-5-xhigh' }, or: { id: 'anthropic/claude-haiku-5.5' } },
    { aa: { slug: 'claude-haiku-5-5-medium' }, or: { id: 'anthropic/claude-haiku-5.5' } },
  ];
  const { matches, merged } = dedupByOrId(variants, 'intelligence');
  assert.equal(matches.length, 1);
  assert.equal(merged, 4);
  assert.equal(matches[0].aa.slug, 'claude-haiku-5-5');
});

test('dedupByOrId : modèle distinct préservé', () => {
  const data = [
    { aa: { slug: 'claude-haiku-5-5' }, or: { id: 'anthropic/claude-haiku-5.5' } },
    { aa: { slug: 'claude-haiku-5-5-low' }, or: { id: 'anthropic/claude-haiku-5.5' } },
    { aa: { slug: 'ling-3-0-flash-vl' }, or: { id: 'inclusionai/ling-3.0-flash-vl' } },
  ];
  const { matches, merged } = dedupByOrId(data, 'intelligence');
  assert.equal(matches.length, 2);
  assert.equal(merged, 1);
  assert.ok(matches.some((m) => m.aa.slug === 'claude-haiku-5-5'));
  assert.ok(matches.some((m) => m.aa.slug === 'ling-3-0-flash-vl'));
});

test('dedupByOrId : non-associés intouchés', () => {
  const data = [
    { aa: { slug: 'claude-haiku-5-5' }, or: { id: 'anthropic/claude-haiku-5.5' } },
    { aa: { slug: 'something-weird' }, or: null },
  ];
  const { matches, merged } = dedupByOrId(data, 'intelligence');
  assert.equal(matches.length, 2);
  assert.equal(merged, 0);
  assert.ok(matches.some((m) => m.or === null && m.aa.slug === 'something-weird'));
});

test('dedupByOrId : départage par qualité à longueur de slug égale', () => {
  const data = [
    { aa: { slug: 'gpt-6-sol-low', intelligence_index: 50 }, or: { id: 'openai/gpt-6-sol-pro' } },
    { aa: { slug: 'gpt-6-sol-xhigh', intelligence_index: 80 }, or: { id: 'openai/gpt-6-sol-pro' } },
  ];
  const { matches, merged } = dedupByOrId(data, 'intelligence');
  assert.equal(matches.length, 1);
  assert.equal(merged, 1);
  assert.equal(matches[0].aa.slug, 'gpt-6-sol-xhigh'); // meilleure qualité (80 > 50)
});