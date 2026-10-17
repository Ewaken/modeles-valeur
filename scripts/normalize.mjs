import { readFileSync } from 'node:fs';

// tokens de bruit : suffixes d'effort + dates (années/mois), retirés de la clé.
const STOPWORDS = new Set(['max', 'high', 'xhigh', 'low', 'medium', 'mini', 'pro']);
const DATE_TOKEN = /^\d{4}$/;

export function normalize(s) {
  // retire le préfixe provider ("provider/nom" -> "nom"), minuscules,
  // découpe sur les non-alphanumériques, jette les tokens de bruit.
  const name = String(s).split('/').pop().toLowerCase();
  return name
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t) && !DATE_TOKEN.test(t))
    .join('');
}

export function loadAliases(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function matchModels(aaModels, orModels, aliases) {
  const byNorm = new Map();
  for (const or of orModels) {
    const key = normalize(or.name);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(or);
  }
  const byId = new Map(orModels.map((or) => [or.id, or]));

  return aaModels.map((aa) => {
    const aliasTarget = aliases[aa.slug];
    if (aliasTarget) {
      const or = byId.get(aliasTarget);
      if (or) return { aa, or, method: 'alias', ambiguous: false };
      // L'alias pointe vers un id inconnu : données cassées, on tombe sur la
      // normalisation plutôt que de rapporter un faux 'alias'.
      return fuzzyFor(aa, byNorm);
    }
    return fuzzyFor(aa, byNorm);
  });
}

function fuzzyFor(aa, byNorm) {
  const candidates = byNorm.get(normalize(aa.name)) ?? [];
  if (candidates.length === 1) {
    return { aa, or: candidates[0], method: 'fuzzy', ambiguous: false };
  }
  return { aa, or: null, method: 'unmatched', ambiguous: candidates.length > 1 };
}