import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const aaRawFixture = JSON.parse(readFileSync(new URL('./fixtures/aa-raw.json', import.meta.url), 'utf8'));
const orFixture = JSON.parse(readFileSync(new URL('./fixtures/or.json', import.meta.url), 'utf8'));
const aliasFixture = JSON.parse(readFileSync(new URL('./fixtures/alias.json', import.meta.url), 'utf8'));

globalThis.fetch = async (url) => {
  const data = String(url).includes('artificialanalysis') ? aaRawFixture : orFixture;
  return { ok: true, json: async () => data };
};

let tempDir;
before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mv-rank-'));
  process.env.ARTIFICIALANALYSIS_API_KEY = 'test';
  process.env.MODELES_VALEUR_CACHE_DIR = tempDir;
  // Alias réel (data/alias.json) injecté depuis la fixture pour avoir 3 points
  // et prouver la troncature --top.
  const aliasFile = join(tempDir, 'alias.json');
  writeFileSync(aliasFile, JSON.stringify(aliasFixture));
  process.env.MODELES_VALEUR_ALIASES = aliasFile;
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ARTIFICIALANALYSIS_API_KEY;
  delete process.env.MODELES_VALEUR_CACHE_DIR;
  delete process.env.MODELES_VALEUR_ALIASES;
});

import { main, isDirectRun } from '../scripts/rank.mjs';

async function run(argv) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const origConsoleError = console.error;
  let out = '';
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { out += s; return true; };
  console.error = (...args) => { out += args.join(' ') + '\n'; };
  try {
    const code = await main(argv);
    return { code, out };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    console.error = origConsoleError;
  }
}

test('sortie JSON : ordre et champs', async () => {
  const { code, out } = await run(['--json', '--workload', 'chat', '--scenario', 'current']);
  assert.equal(code, 0);
  const obj = JSON.parse(out);
  const slugs = obj.classement.map((e) => e.modele);
  assert.equal(slugs[0], 'model-beta');
  assert.equal(slugs[1], 'model-alpha');
  for (const e of obj.classement) {
    assert.equal(typeof e.quality, 'number');
    assert.equal(typeof e.costPerTask, 'number');
    assert.equal(typeof e.value, 'number');
    assert.equal(typeof e.pareto, 'boolean');
  }
});

test('sortie CSV : en-tête français', async () => {
  const { code, out } = await run(['--csv']);
  assert.equal(code, 0);
  assert.ok(out.startsWith('rang,modele,openrouter,qualite,cout_tache,valeur,tokens_s,pareto'));
});

test('section non-associés présente pour gamma', async () => {
  const { code, out } = await run(['--json']);
  assert.equal(code, 0);
  const obj = JSON.parse(out);
  assert.ok(obj.non_associes.includes('model-gamma'));
});

test('--top N tronque', async () => {
  const { code, out } = await run(['--top', '2', '--json']);
  assert.equal(code, 0);
  const obj = JSON.parse(out);
  assert.equal(obj.classement.length, 2);
});

test('--index math est rejeté', async () => {
  const { code, out } = await run(['--index', 'math']);
  assert.equal(code, 1);
  assert.match(out, /agentic/);
});

test('le garde CLI compare les chemins après résolution', () => {
  // Chemin relatif : resolve le rend absolu → match.
  const abs = resolve('./some/script.mjs');
  assert.equal(isDirectRun(abs, './some/script.mjs'), true);
  // Chemins différents → no match.
  assert.equal(isDirectRun(abs, './other/script.mjs'), false);
  // argv1 manquant → no match.
  assert.equal(isDirectRun(abs, undefined), false);
});