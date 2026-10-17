import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const JOURS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function loadWorkloads(path) {
  const p = path || join(SKILL_DIR, 'data', 'workloads.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function pricingScenario(model, scenario, now = new Date()) {
  const base = { prompt: Number(model.pricing.prompt), completion: Number(model.pricing.completion), input_cache_read: Number(model.pricing.input_cache_read) };
  const overrides = model.pricing.overrides ?? [];

  if (scenario === 'current') {
    const jour = JOURS[now.getUTCDay()];
    const hhmm = now.getUTCHours() * 100 + now.getUTCMinutes();
    const ov = overrides.find((o) => {
      if (!(o.utc_days ?? []).includes(jour)) return false;
      const start = o.utc_start ?? 0;
      // utc_end absent ou 0 = « jusqu à la fin de journée ».
      const end = o.utc_end || 2400;
      return hhmm >= start && hhmm < end;
    });
    return ov ? { prompt: Number(ov.prompt), completion: Number(ov.completion), input_cache_read: Number(ov.input_cache_read), source: 'override' } : { ...base, source: 'base' };
  }

  // min/peak : compare sur prompt (le plan : min/max de prompt, prix associés du même override).
  const candidats = [base, ...overrides.map((o) => ({ prompt: Number(o.prompt), completion: Number(o.completion), input_cache_read: Number(o.input_cache_read) }))];
  const retenu = candidats.reduce((best, c) =>
    scenario === 'min' ? (c.prompt < best.prompt ? c : best) : (c.prompt > best.prompt ? c : best)
  );
  return { ...retenu, source: retenu === base ? 'base' : 'override' };
}

export function computeCostPerTask(p, w) {
  return w.input * p.prompt + w.output * p.completion + w.cache_read * p.input_cache_read;
}