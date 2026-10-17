import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAAModels, fetchOpenRouterModels } from './api.mjs';
import { matchModels, similarity } from './normalize.mjs';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ALIAS_PATH = join(SKILL_DIR, 'data', 'alias.json');
const SUGGEST_PATH = join(SKILL_DIR, 'data', 'alias.suggestions.json');
const SEUIL_SUGGESTION = 0.3;

async function main() {
  const apiKey = process.env.ARTIFICIALANALYSIS_API_KEY;
  if (!apiKey) throw new Error('ARTIFICIALANALYSIS_API_KEY requise');

  const aaModels = await fetchAAModels(apiKey, { force: true });
  const orModels = await fetchOpenRouterModels({ force: true });
  const existing = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
  const existingKeys = new Set(Object.keys(existing));

  // 1. Lancer le matching pour voir qui est déjà couvert par alias+fuzzy
  const results = matchModels(aaModels, orModels, existing);
  const matchedSlugs = new Set(results.filter(r => r.or).map(r => r.aa.slug));

  // 2. Pour les non-associés, trouver la meilleure suggestion
  const suggestions = {};

  for (const aa of aaModels) {
    if (existingKeys.has(aa.slug) || matchedSlugs.has(aa.slug)) continue;

    let bestScore = 0;
    let bestId = null;
    const slugOrName = aa.slug || aa.name;

    for (const or of orModels) {
      const orBaseId = or.id.split('/').slice(1).join('/');
      const score = Math.max(
        similarity(slugOrName, orBaseId),
        similarity(aa.name, or.name),
      );
      if (score > bestScore && score >= SEUIL_SUGGESTION) {
        bestScore = score;
        bestId = or.id;
      }
    }

    if (bestId) {
      suggestions[aa.slug] = { suggest: bestId, score: Number(bestScore.toFixed(3)) };
    }
  }

  if (Object.keys(suggestions).length === 0) {
    console.log('Aucune suggestion — tous les modèles non-appariés sont trop divergents.');
    console.log(`(${aaModels.length} AA, ${orModels.length} OR, ${existingKeys.size} alias)`);
    return;
  }

  writeFileSync(SUGGEST_PATH, JSON.stringify(suggestions, null, 2) + '\n');
  console.log(`${Object.keys(suggestions).length} suggestions écrites dans ${SUGGEST_PATH}`);
  console.log('Pour les valider :');
  console.log('  1. Lire les suggestions');
  console.log('  2. Copier dans data/alias.json les associations correctes');
  console.log('  3. Lancer node scripts/rank.mjs --force pour vérifier');
}

main().catch((err) => { console.error(err.message); process.exit(1); });