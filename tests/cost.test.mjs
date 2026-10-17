import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadWorkloads, pricingScenario, computeCostPerTask } from '../scripts/cost.mjs';

const orFixture = JSON.parse(readFileSync(new URL('./fixtures/or.json', import.meta.url), 'utf8')).data;
const alpha = orFixture.find((m) => m.id === 'provider/model-alpha');
const beta = orFixture.find((m) => m.id === 'provider/model-beta');
const chat = { input: 1000, output: 500, cache_read: 0 };

test('coût chat au scénario base (current hors override)', () => {
  // mardi 2026-10-13 08:00 UTC : hors 9h-17h -> prix de base.
  const p = pricingScenario(alpha, 'current', new Date('2026-10-13T08:00:00Z'));
  assert.equal(p.source, 'base');
  assert.equal(computeCostPerTask(p, chat), 0.0035);
});

test('coût chat au scénario peak (override semaine)', () => {
  const p = pricingScenario(alpha, 'peak');
  assert.equal(p.source, 'override');
  assert.equal(computeCostPerTask(p, chat), 0.007);
});

test('coût chat au scénario min (override week-end)', () => {
  const p = pricingScenario(alpha, 'min');
  assert.equal(p.source, 'override');
  assert.equal(computeCostPerTask(p, chat), 0.00175);
});

test('overrides vide retombe sur la base', () => {
  const p = pricingScenario(beta, 'current', new Date('2026-10-13T10:00:00Z'));
  assert.equal(p.source, 'base');
});

test('overrides vides : coût', () => {
  const p = pricingScenario(beta, 'current', new Date('2026-10-13T10:00:00Z'));
  assert.equal(computeCostPerTask(p, chat), 0.00035);
});

test('dimanche dans la plage week-end', () => {
  // dimanche 2026-10-11 : coupé à la semaine par utc_days.
  const p = pricingScenario(alpha, 'current', new Date('2026-10-11T15:00:00Z'));
  assert.equal(p.source, 'override');
  assert.equal(computeCostPerTask(p, chat), 0.00175);
});

test('utc_end 0 couvre jusqu à la fin de journée', () => {
  const openEnd = {
    id: 'x', name: 'X', pricing: { prompt: '1e-6', completion: '2e-6', input_cache_read: '0', overrides: [
      { utc_days: ['saturday'], prompt: '5e-7', completion: '1e-6', input_cache_read: '0', utc_start: 1800, utc_end: 0 },
    ] },
  };
  const p = pricingScenario(openEnd, 'current', new Date('2026-10-10T23:00:00Z')); // samedi 23h UTC
  assert.equal(p.source, 'override');
  assert.equal(p.prompt, 5e-7);
});

test('heure juste à la fin de plage (utc_end exclusif)', () => {
  const p = pricingScenario(alpha, 'current', new Date('2026-10-13T17:00:00Z')); // mardi 17h
  assert.equal(p.source, 'base', '17:00 >= utc_end 1700 -> hors plage');
});

test('loadWorkloads lit data/workloads.json', () => {
  const w = loadWorkloads('');
  assert.deepEqual(w.chat, chat);
  assert.deepEqual(w.agent, { input: 20000, output: 8000, cache_read: 100000 });
  assert.deepEqual(w.reasoning, { input: 1500, output: 12000, cache_read: 0 });
});