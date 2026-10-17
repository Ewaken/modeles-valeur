// Passe en revue les suggestions et écrit les validées dans data/alias.json.
// Usage : node scripts/review-aliases.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ALIAS_PATH = join(SKILL_DIR, 'data', 'alias.json');
const SUGGEST_PATH = join(SKILL_DIR, 'data', 'alias.suggestions.json');

async function main() {
  const suggestions = JSON.parse(readFileSync(SUGGEST_PATH, 'utf8'));
  const existing = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
  const entries = Object.entries(suggestions);

  console.log(`${entries.length} suggestions à valider.`);
  console.log('  y = ajouter à alias.json     n = ignore     q = quitter');
  console.log('');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  for (const [slug, { suggest, score }] of entries) {
    if (existing[slug]) continue; // déjà dans alias.json

    const answer = await rl.question(
      `[${score.toFixed(3)}] ${slug} → ${suggest}\n  y/n/q? `
    );

    if (answer === 'q') break;
    if (answer === 'y') existing[slug] = suggest;
  }

  rl.close();
  writeFileSync(ALIAS_PATH, JSON.stringify(existing, null, 2) + '\n');
  console.log(`\n${Object.keys(existing).length} alias dans ${ALIAS_PATH}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });