import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadApiKey, fetchOpenRouterModels, fetchAAModels } from '../scripts/api.mjs';

const aaFixture = JSON.parse(readFileSync(new URL('./fixtures/aa.json', import.meta.url), 'utf8'));
const orFixture = JSON.parse(readFileSync(new URL('./fixtures/or.json', import.meta.url), 'utf8'));

// --- faux réseau : sert les fixtures, compte les appels ---
let fetchCount = 0;
let fetchMode = 'ok'; // 'ok' | 'fail' | 'rate-limit'
let lastHeaders = null;
globalThis.fetch = async (url, options = {}) => {
  fetchCount++;
  lastHeaders = options.headers ?? {};
  if (fetchMode === 'fail') throw new Error('réseau coupé');
  if (fetchMode === 'rate-limit') {
    return { ok: false, status: 429, json: async () => ({}) };
  }
  if (String(url).includes('openrouter.ai')) {
    return { ok: true, json: async () => orFixture };
  }
  if (String(url).includes('artificialanalysis.ai')) {
    return { ok: true, json: async () => aaFixture };
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

test('fetchAAModels parse les modèles', async () => {
  resetNetwork();
  process.env.MODELES_VALEUR_CACHE_DIR = freshCacheDir();
  const r = await fetchAAModels('clé-test', { force: true });
  assert.equal(r.length, 4);
  assert.equal(r[0].intelligence_index, 60);
  assert.deepEqual(lastHeaders['x-api-key'], 'clé-test');
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