import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_CACHE_DIR = join(SKILL_DIR, 'data', '.cache');

const AA_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
const OR_URL = 'https://openrouter.ai/api/v1/models';
const TTL = { aa: 6 * 60 * 60 * 1000, or: 60 * 60 * 1000 };

function cacheDir() {
  return process.env.MODELES_VALEUR_CACHE_DIR || DEFAULT_CACHE_DIR;
}

export function loadApiKey() {
  const fromEnv = process.env.ARTIFICIALANALYSIS_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  const configPath = join(SKILL_DIR, 'data', 'config.json');
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    if (cfg.artificialanalysis_api_key && cfg.artificialanalysis_api_key.trim()) {
      return cfg.artificialanalysis_api_key.trim();
    }
  }
  throw new Error(
    'Clé API artificialanalysis.ai manquante. Créez un compte et générez une clé sur ' +
      'https://artificialanalysis.ai/data-api puis définissez la variable ' +
      "d'environnement ARTIFICIALANALYSIS_API_KEY ou renseignez data/config.json."
  );
}

export function readCache(name) {
  const path = join(cacheDir(), `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function writeCache(name, data) {
  const dir = cacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ cached_at: Date.now(), data }));
}

export async function fetchOpenRouterModels({ force = false } = {}) {
  return withCache('or', TTL.or, force, async () => {
    const res = await attemptFetch(OR_URL, 2);
    return (await res.json()).data;
  }, OR_URL);
}

export async function fetchAAModels(apiKey, { force = false } = {}) {
  return withCache('aa', TTL.aa, force, () => fetchAllAAPages(apiKey), AA_URL);
}

// Agrège toutes les pages du endpoint gratuit AA, dédoublonne par slug, aplatit le shape.
async function fetchAllAAPages(apiKey) {
  const all = [];
  const first = await attemptFetch(AA_URL, 2, { headers: { 'x-api-key': apiKey } });
  const firstJson = await first.json();
  const totalPages = firstJson.pagination?.total_pages ?? 1;
  all.push(...firstJson.data);

  for (let page = 2; page <= totalPages; page++) {
    const res = await attemptFetch(`${AA_URL}?page=${page}`, 2, { headers: { 'x-api-key': apiKey } });
    const json = await res.json();
    all.push(...(json.data ?? []));
  }

  // Dédoublonnage par slug (un modèle peut apparaître sur plusieurs pages).
  const dedup = [...new Map(all.map((m) => [m.slug, m])).values()];
  return dedup.map(mapAAModel);
}

export function mapAAModel(raw) {
  return {
    slug: raw.slug,
    name: raw.name,
    intelligence_index: raw.evaluations?.artificial_analysis_intelligence_index ?? null,
    artificial_analysis_coding_index: raw.evaluations?.artificial_analysis_coding_index ?? null,
    artificial_analysis_agentic_index: raw.evaluations?.artificial_analysis_agentic_index ?? null,
    median_output_tokens_per_second: raw.performance?.median_output_tokens_per_second ?? null,
  };
}

async function withCache(name, ttl, force, produce, urlLabel) {
  const cache = readCache(name);
  const fresh = cache && Date.now() - cache.cached_at < ttl;
  if (!force && fresh) return cache.data;

  try {
    const data = await produce();
    writeCache(name, data);
    return data;
  } catch (err) {
    if (cache) {
      console.error('⚠ Cache utilisé — impossible de rafraîchir les données');
      return cache.data;
    }
    throw new Error(
      `Échec de récupération des modèles (${urlLabel}) : ${err.message}. ` +
        'Si le réseau est temporairement indisponible, un cache récent reste utilisable.'
    );
  }
}

async function attemptFetch(url, attempts, init) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status !== 429 && res.status >= 400 && res.status < 500) {
        throw new Error(`HTTP ${res.status} (non retryable)`);
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}