import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalize, loadAliases, matchModels } from '../scripts/normalize.mjs';

const aaModels = JSON.parse(readFileSync(new URL('./fixtures/aa.json', import.meta.url), 'utf8')).data;
const orModels = JSON.parse(readFileSync(new URL('./fixtures/or.json', import.meta.url), 'utf8')).data;
const aliases = JSON.parse(readFileSync(new URL('./fixtures/alias.json', import.meta.url), 'utf8'));

test('normalize retire provider, casse et ponctuation', () => {
  assert.equal(normalize('Provider/Model Alpha'), 'modelalpha');
  assert.equal(normalize('Provider/model-alpha'), 'modelalpha');
});

test('normalize retire les suffixes d effort', () => {
  assert.equal(normalize('claude-sonnet-max'), 'claudesonnet');
});

test('normalize retire les tokens de date', () => {
  assert.equal(normalize('modele-2024-0902'), 'modele');
  assert.equal(normalize('brain-1017'), 'brain');
});

test('match par nom normalisé', () => {
  const alpha = aaModels.find((m) => m.slug === 'model-alpha');
  const m = matchModels([alpha], orModels, {})[0];
  assert.equal(m.method, 'fuzzy');
  assert.equal(m.or.id, 'provider/model-alpha');
  assert.equal(m.ambiguous, false);
});

test('match par alias prioritaire malgré noms divergents', () => {
  const special = aaModels.find((m) => m.slug === 'alias-special');
  const m = matchModels([special], orModels, aliases)[0];
  assert.equal(m.method, 'alias');
  assert.equal(m.or.id, 'vendor/thing');
  assert.equal(m.ambiguous, false);
});

test('modèle AA absent d OpenRouter -> unmatched', () => {
  const gamma = aaModels.find((m) => m.slug === 'model-gamma');
  const m = matchModels([gamma], orModels, {})[0];
  assert.equal(m.method, 'unmatched');
  assert.equal(m.or, null);
});

test('candidat ambigu (plusieurs OR au même nom normalisé) -> unmatched + ambiguous', () => {
  // Deux OR portant le même nom normalisé : la correspondance n est pas univoque.
  const dupOr = [
    { id: 'a/modele', name: 'Provider/Modele', pricing: {} },
    { id: 'b/modele', name: 'Vendor/Modele', pricing: {} },
  ];
  const aa = [{ slug: 'modele', name: 'Modele', intelligence_index: 50, artificial_analysis_coding_index: null, artificial_analysis_agentic_index: null, median_output_tokens_per_second: null }];
  const m = matchModels(aa, dupOr, {})[0];
  assert.equal(m.method, 'unmatched');
  assert.equal(m.or, null);
  assert.equal(m.ambiguous, true);
});

test('loadAliases lit le fichier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeles-alias-'));
  try {
    const p = join(dir, 'alias.json');
    writeFileSync(p, JSON.stringify({ a: 'b' }));
    assert.deepEqual(loadAliases(p), { a: 'b' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});