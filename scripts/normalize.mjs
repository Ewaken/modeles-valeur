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

export function trigrams(s) {
  const n = normalize(s);
  const out = new Set();
  for (let i = 0; i + 3 <= n.length; i++) out.add(n.slice(i, i + 3));
  return out;
}

export function similarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Seuil de similarité minimale pour retenir une association fuzzy.
const SEUIL = 0.6;

export function loadAliases(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function matchModels(aaModels, orModels, aliases) {
  // Index strict par nom normalisé pour le repli exact.
  // shortcut: ne couvre que or.name, pas or.id ; les modèles
  // dont le nom diverge pronfondément passent par le fuzzy.
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
      // L'alias pointe vers un id inconnu : données cassées, on tombe sur le
      // fuzzy plutôt que de rapporter un faux 'alias'.
      return fuzzyFor(aa, byNorm, orModels);
    }
    return fuzzyFor(aa, byNorm, orModels);
  });
}

function fuzzyFor(aa, byNorm, allOrs) {
  // 1. Égalité stricte sur normalize(or.name) (comportement existant)
  const strict = byNorm.get(normalize(aa.name)) ?? [];
  if (strict.length === 1) {
    return { aa, or: strict[0], method: 'fuzzy', ambiguous: false };
  }
  if (strict.length > 1) {
    return { aa, or: null, method: 'unmatched', ambiguous: true };
  }

  // 2. Scoring trigramme aa.slug ↔ or.id (sans provider) ET aa.name ↔ or.name
  const slugOrName = aa.slug || aa.name;
  const scored = [];
  for (const or of allOrs) {
    const orBaseId = or.id.split('/').slice(1).join('/');
    const score = Math.max(
      similarity(slugOrName, orBaseId),
      similarity(aa.name, or.name)
    );
    if (score >= SEUIL) scored.push({ or, score });
  }
  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { aa, or: null, method: 'unmatched', ambiguous: false };

  // 3. Ambiguïté : écart < 5% entre les deux meilleurs
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.05) {
    return { aa, or: null, method: 'unmatched', ambiguous: true };
  }

  return { aa, or: scored[0].or, method: 'fuzzy', ambiguous: false };
}