import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_CACHE_DIR = join(SKILL_DIR, 'data', '.cache');

const AA_URL = 'https://artificialanalysis.ai/api/v2/language/models';
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
  return fetchWithCache('or', OR_URL, TTL.or, force);
}

export async function fetchAAModels(apiKey, { force = false } = {}) {
  return fetchWithCache('aa', AA_URL, TTL.aa, force, {
    headers: { 'x-api-key': apiKey },
  });
}

async function fetchWithCache(name, url, ttl, force, init) {
  const cache = readCache(name);
  const fresh = cache && Date.now() - cache.cached_at < ttl;
  if (!force && fresh) return cache.data;

  try {
    const res = await attemptFetch(url, 2, init);
    const data = (await res.json()).data;
    writeCache(name, data);
    return data;
  } catch (err) {
    // Si un run précédent a laissé un cache exploitable, on le préserve.
    if (cache) return cache.data;
    throw new Error(
      `Échec de récupération des modèles (${url}) : ${err.message}. ` +
        'Si le réseau est temporairement indisponible, un cache récent reste utilisable.'
    );
  }
}

async function attemptFetch(url, attempts, init) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      // Une réponse non-OK (rate-limit 429, 5xx) compte comme un échec retentable.
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}