import { computeCostPerTask, loadWorkloads, pricingScenario } from './cost.mjs';

// Qualité selon l'indice demandé : intelligence | coding | agentic.
export function qualityOf(aa, index) {
  if (index === 'coding') return aa.artificial_analysis_coding_index ?? null;
  if (index === 'agentic') return aa.artificial_analysis_agentic_index ?? null;
  return aa.intelligence_index ?? null;
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