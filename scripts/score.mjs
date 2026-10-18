import { computeCostPerTask, loadWorkloads, pricingScenario } from './cost.mjs';

// Qualité selon l'indice demandé : intelligence | coding | agentic.
export function qualityOf(aa, index) {
  if (index === 'coding') return aa.artificial_analysis_coding_index ?? null;
  if (index === 'agentic') return aa.artificial_analysis_agentic_index ?? null;
  return aa.intelligence_index ?? null;
}

// Compte les tokens d'un slug (le modèle de base a le slug le plus court).
function slugTokens(slug) {
  return String(slug).split(/[^a-z0-9]+/).filter(Boolean).length;
}

// Fusionne en UNE entrée chaque groupe de matches pointant sur le même or.id.
// Représentant : slug le plus court (= modèle de base) ; départage : meilleur
// indice de qualité. Les non-associés (m.or === null) passent tels quels.
export function dedupByOrId(matches, index) {
  const groups = new Map();
  for (const m of matches) {
    if (!m.or) continue;
    const arr = groups.get(m.or.id) ?? [];
    arr.push(m);
    groups.set(m.or.id, arr);
  }

  const out = matches.filter((m) => !m.or); // non-associés conservés
  let merged = 0;
  for (const arr of groups.values()) {
    const rep = arr.reduce((best, m) => {
      const a = slugTokens(m.aa.slug);
      const b = slugTokens(best.aa.slug);
      if (a !== b) return a < b ? m : best;
      const qm = qualityOf(m.aa, index) ?? -Infinity;
      const qb = qualityOf(best.aa, index) ?? -Infinity;
      return qm > qb ? m : best;
    });
    out.push(rep);
    merged += arr.length - 1;
  }
  return { matches: out, merged };
}

// Construit les points classables : qualité nulle et sans équivalent OR sont exclus.
export function buildPoints(matches, { workload, scenario, index, now = new Date() }) {
  const w = loadWorkloads()[workload];
  const points = [];
  for (const m of matches) {
    const quality = m.or ? qualityOf(m.aa, index) : null;
    if (m.or === null || quality === null) continue;
    const prix = pricingScenario(m.or, scenario, now);
    const costPerTask = computeCostPerTask(prix, w);
    // Un modèle fuzzy-matché mais sans tarif OpenRouter produit un coût NaN ;
    // le garder fausserait la frontière de Pareto (NaN compare faux partout).
    if (!Number.isFinite(costPerTask)) continue;
    points.push({
      aa: m.aa,
      or: m.or,
      quality,
      costPerTask,
      value: quality / costPerTask,
      speed: m.aa.median_output_tokens_per_second,
      pareto: false,
    });
  }
  const frontier = paretoFrontier(points);
  for (const p of points) p.pareto = frontier.has(p);
  return points;
}

// O(n²) : chaque point est dominé s'il existe un autre point au moins aussi bon
// sur quality ET costPerTask, strictement meilleur sur au moins l'un des deux.
export function paretoFrontier(points) {
  const nonDomines = new Set(points);
  for (const p of points) {
    for (const q of points) {
      if (p === q) continue;
      const domine = q.quality >= p.quality && q.costPerTask <= p.costPerTask && (q.quality > p.quality || q.costPerTask < p.costPerTask);
      if (domine) {
        nonDomines.delete(p);
        break;
      }
    }
  }
  return nonDomines;
}

// Frontière de Pareto en tête (déjà précalculée par buildPoints), puis valeur décroissante.
export function rank(points) {
  return [...points].sort((a, b) => {
    if (a.pareto !== b.pareto) return a.pareto ? -1 : 1;
    return b.value - a.value;
  });
}