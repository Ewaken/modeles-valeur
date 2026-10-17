import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadApiKey, fetchOpenRouterModels, fetchAAModels, mapAAModel } from '../scripts/api.mjs';

const aaFixture = JSON.parse(readFileSync(new URL('./fixtures/aa.json', import.meta.url), 'utf8'));
const aaRawFixture = JSON.parse(readFileSync(new URL('./fixtures/aa-raw.json', import.meta.url), 'utf8'));
const orFixture = JSON.parse(readFileSync(new URL('./fixtures/or.json', import.meta.url), 'utf8'));

// --- faux réseau : sert les fixtures, compte les appels ---
let fetchCount = 0;
let fetchMode = 'ok'; // 'ok' | 'fail' | 'rate-limit' | 'forbidden'
let lastHeaders = null;
const sharedFetch = globalThis.fetch; // conservé pour restauration dans les tests qui remplacent fetch
globalThis.fetch = async (url, options = {}) => {
  fetchCount++;
  lastHeaders = options.headers ?? {};
  if (fetchMode === 'fail') throw new Error('réseau coupé');
  if (fetchMode === 'rate-limit') {
    return { ok: false, status: 429, json: async () => ({}) };
  }
  if (fetchMode === 'forbidden') {
    return { ok: false, status: 403, json: async () => ({ error: 'Pro subscription required' }) };
  }
  if (String(url).includes('openrouter.ai')) {
    return { ok: true, json: async () => orFixture };
  }
  if (String(url).includes('artificialanalysis.ai')) {
    return { ok: true, json: async () => aaRawFixture };
  }
  throw new Error('URL inattendue dans le stub : ' + url);
};

const cacheDirs = [];
function freshCacheDir() {
  const dir = mkdtempSync(join(tmpdir(), 'modeles-valeur-cache-'));
  cacheDirs.push(dir);
  return dir;
}
function resetNetwork() {
  fetchMode = 'ok';
  fetchCount = 0;
  lastHeaders = null;
}

test.after(() => {
  delete process.env.ARTIFICIALANALYSIS_API_KEY;
  delete process.env.MODELES_VALEUR_CACHE_DIR;
  for (const dir of cacheDirs) rmSync(dir, { recursive: true, force: true });
});

test('loadApiKey lit la variable d env', () => {
  process.env.ARTIFICIALANALYSIS_API_KEY = 'clé-test';
  assert.equal(loadApiKey(), 'clé-test');
});

test('loadApiKey échoue proprement sans clé', () => {
  delete process.env.ARTIFICIALANALYSIS_API_KEY;
  assert.throws(() => loadApiKey(), /data-api/);
});

test('fetchOpenRouterModels parse les prix en conservant les overrides', async () => {
  resetNetwork();
  process.env.MODELES_VALEUR_CACHE_DIR = freshCacheDir();
  const r = await fetchOpenRouterModels({ force: true });
  assert.equal(r.length, 3);
  assert.equal(r[0].pricing.overrides.length, 2);
});

test('fetchAAModels parse et aplatit les modèles', async () => {
  resetNetwork();
  process.env.MODELES_VALEUR_CACHE_DIR = freshCacheDir();
  const r = await fetchAAModels('clé-test', { force: true });
  assert.equal(r.length, 4);
  assert.equal(r[0].intelligence_index, 60);          // aplatit de evaluations.*
  assert.equal(r[0].median_output_tokens_per_second, 100); // aplatit de performance.*
  assert.deepEqual(lastHeaders['x-api-key'], 'clé-test');
});

test('mapAAModel aplatit le shape imbriqué', () => {
  const m = mapAAModel({
    slug: 'model-alpha', name: 'Model Alpha',
    evaluations: { artificial_analysis_intelligence_index: 60, artificial_analysis_coding_index: 55, artificial_analysis_agentic_index: 80 },
    performance: { median_output_tokens_per_second: 100 },
  });
  assert.deepEqual(m, { slug: 'model-alpha', name: 'Model Alpha', intelligence_index: 60, artificial_analysis_coding_index: 55, artificial_analysis_agentic_index: 80, median_output_tokens_per_second: 100 });
});

test('mapAAModel tolère champs manquants → null', () => {
  assert.deepEqual(mapAAModel({ slug: 'x', name: 'X' }), { slug: 'x', name: 'X', intelligence_index: null, artificial_analysis_coding_index: null, artificial_analysis_agentic_index: null, median_output_tokens_per_second: null });
});

test('fetchAAModels agrège toutes les pages et dédoublonne par slug', async () => {
  resetNetwork();
  process.env.MODELES_VALEUR_CACHE_DIR = freshCacheDir();
  const alpha = { slug: 'model-alpha', name: 'A', evaluations: { artificial_analysis_intelligence_index: 60 }, performance: { median_output_tokens_per_second: 100 } };
  const beta  = { slug: 'model-beta',  name: 'B', evaluations: { artificial_analysis_intelligence_index: 40 }, performance: { median_output_tokens_per_second: 200 } };
  const gamma = { slug: 'model-gamma', name: 'G', evaluations: { artificial_analysis_intelligence_index: 20 }, performance: { median_output_tokens_per_second: 50 } };
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const isPage2 = String(url).includes('page=2');
    const body = isPage2
      ? { data: [beta, gamma], pagination: { total_pages: 2, has_more: false } }
      : { data: [alpha, beta], pagination: { total_pages: 2, has_more: true } };
    return { ok: true, json: async () => body };
  };
  try {
    const r = await fetchAAModels('clé-test', { force: true });
    assert.equal(r.length, 3); // beta renvoyé sur les 2 pages → dédoublonné
    assert.deepEqual(r.map((m) => m.slug).sort(), ['model-alpha', 'model-beta', 'model-gamma']);
  } finally {
    globalThis.fetch = prev;
  }
});

test('HTTP 403 AA → erreur claire, pas de liste vide', async () => {
  resetNetwork();
  process.env.MODELES_VALEUR_CACHE_DIR = freshCacheDir();
  fetchMode = 'forbidden';
  await assert.rejects(() => fetchAAModels('clé-test', { force: true }), /403/i);
});

test('le cache est écrit puis relu', async () => {
  resetNetwork();
  process.env.MODELES_VALEUR_CACHE_DIR = freshCacheDir();
  const first = await fetchOpenRouterModels({ force: true });
  const second = await fetchOpenRouterModels();
  assert.deepEqual(second, first);
  assert.equal(fetchCount, 1, 'fetch ne doit être appelé qu une seule fois');
});

test('une nouvelle tentative en cas de rate-limit, puis échec proprement', async () => {
  resetNetwork();
  process.env.MODELES_VALEUR_CACHE_DIR = freshCacheDir();
  fetchMode = 'rate-limit';
  await assert.rejects(() => fetchOpenRouterModels({ force: true }), /artificialanalysis|openrouter|réseau|API/i);
  assert.equal(fetchCount, 2, 'deux tentatives attendues');
});

test('relit le cache périmé si le réseau échoue', async () => {
  resetNetwork();
  const dir = freshCacheDir();
  process.env.MODELES_VALEUR_CACHE_DIR = dir;
  // Cache périmé (TTL dépassé), format disque exact : { cached_at, data }.
  const stale = { cached_at: Date.now() - 2 * 60 * 60 * 1000, data: orFixture.data };
  writeFileSync(join(dir, 'or.json'), JSON.stringify(stale));
  fetchMode = 'fail';
  const second = await fetchOpenRouterModels({ force: true });
  assert.deepEqual(second, orFixture.data, 'le cache d un run précédent reste utilisable');
  assert.equal(fetchCount, 2, 'tentative + nouvelle tentative');
});