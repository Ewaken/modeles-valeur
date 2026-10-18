import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiKey, fetchAAModels, fetchOpenRouterModels } from './api.mjs';
import { matchModels, loadAliases } from './normalize.mjs';
import { buildPoints, rank, dedupByOrId } from './score.mjs';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// Sur les prix temporels d'OpenRouter, l'exécutable a besoin d'injecter un
// fichier d'alias de test : même pattern que MODELES_VALEUR_CACHE_DIR.
function aliasesPath() {
  return process.env.MODELES_VALEUR_ALIASES || join(SKILL_DIR, 'data', 'alias.json');
}

function parseArgs(argv) {
  const opts = {
    workload: 'chat',
    scenario: 'current',
    index: 'intelligence',
    minSpeed: 0,
    top: 25,
    json: false,
    csv: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--json':
        opts.json = true;
        break;
      case '--csv':
        opts.csv = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--workload':
        opts.workload = argv[++i];
        break;
      case '--scenario':
        opts.scenario = argv[++i];
        break;
      case '--index':
        opts.index = argv[++i];
        break;
      case '--min-speed':
        opts.minSpeed = Number(argv[++i]);
        break;
      case '--top':
        opts.top = Number(argv[++i]);
        break;
      default:
        throw new Error(`Drapeau inconnu : ${a}`);
    }
  }
  if (!['chat', 'agent', 'reasoning'].includes(opts.workload)) {
    throw new Error(`--workload invalide : ${opts.workload} (attendu chat|agent|reasoning)`);
  }
  if (!['current', 'min', 'peak'].includes(opts.scenario)) {
    throw new Error(`--scenario invalide : ${opts.scenario} (attendu current|min|peak)`);
  }
  if (!['intelligence', 'coding', 'agentic'].includes(opts.index)) {
    throw new Error(`--index invalide : ${opts.index} (attendu intelligence|coding|agentic)`);
  }
  return opts;
}

// Coût en µ$ (millionièmes de $). Pour changer d'unité, ne modifier que ce
// libellé et le facteur 1e6 dans la cellule « cout ».
const UNIT_LABEL = 'Coût (µ$)';
const MAX_WIDTH = { modele: 30, or: 34 };

export function formatTable(points, scenario, workload, index) {
  const rows = points.map((p, i) => ({
    '#': String(i + 1),
    modele: p.aa.slug,
    or: p.or.id,
    qualite: String(p.quality),
    cout: (p.costPerTask * 1e6).toFixed(1),
    valeur: p.value.toFixed(2),
    speed: p.speed == null ? '—' : String(p.speed),
    pareto: p.pareto ? 'oui' : 'non',
  }));

  const keys = ['#', 'modele', 'or', 'qualite', 'cout', 'valeur', 'speed', 'pareto'];
  const headers = ['#', 'Modèle (AA)', 'OpenRouter', 'Qualité', UNIT_LABEL, 'Valeur (pts/$)', 'tok/s', 'Pareto'];

  const widths = keys.map((k, i) => {
    let w = headers[i].length;
    for (const r of rows) w = Math.max(w, r[k].length);
    return Math.min(w, MAX_WIDTH[k] ?? w);
  });

  const cell = (s, w) => {
    const t = String(s);
    return t.length > w ? t.slice(0, w - 1) + '…' : t.padEnd(w);
  };

  const line = (r) => keys.map((k, i) => cell(r[k], widths[i])).join(' ').trimEnd();

  const header = line(Object.fromEntries(keys.map((k, i) => [k, headers[i]])));
  return [header, ...rows.map(line), '', `Scénario de prix : ${scenario} · Profil : ${workload} · Index : ${index}`].join('\n') + '\n';
}

export function toJson(points, meta) {
  return (
    JSON.stringify(
      {
        scenario: meta.scenario,
        profil: meta.workload,
        index: meta.index,
        non_associes: meta.nonAssocies,
        classement: points.map((p) => ({
          modele: p.aa.slug,
          openrouter: p.or.id,
          quality: p.quality,
          costPerTask: p.costPerTask,
          value: p.value,
          speed: p.speed,
          pareto: p.pareto,
        })),
      },
      null,
      2
    ) + '\n'
  );
}

export function toCsv(points) {
  const rows = points.map((p, i) =>
    [i + 1, p.aa.slug, p.or.id, p.quality, p.costPerTask, p.value, p.speed ?? '', p.pareto].join(',')
  );
  return ['rang,modele,openrouter,qualite,cout_tache,valeur,tokens_s,pareto', ...rows].join('\n');
}

export async function main(argv) {
  try {
    const opts = parseArgs(argv);
    const apiKey = loadApiKey();
    const [aaModels, orModels] = await Promise.all([
      fetchAAModels(apiKey, { force: opts.force }),
      fetchOpenRouterModels({ force: opts.force }),
    ]);
    const matches = matchModels(aaModels, orModels, loadAliases(aliasesPath()));
    const { matches: deduped, merged } = dedupByOrId(matches, opts.index);
    if (merged > 0) console.error(`${merged} variante(s) AA fusionnée(s) vers leur modèle OpenRouter de base`);
    let points = buildPoints(deduped, {
      workload: opts.workload,
      scenario: opts.scenario,
      index: opts.index,
    });
    if (opts.minSpeed > 0) {
      points = points.filter((p) => p.speed !== null && p.speed >= opts.minSpeed);
    }
    points = rank(points).slice(0, opts.top);
    const nonAssocies = matches.filter((m) => m.or === null).map((m) => m.aa.slug);

    if (opts.json) {
      process.stdout.write(
        toJson(points, { scenario: opts.scenario, workload: opts.workload, index: opts.index, nonAssocies })
      );
    } else if (opts.csv) {
      process.stdout.write(toCsv(points));
      process.stdout.write(`\n# scénario : ${opts.scenario} · profil : ${opts.workload}\n`);
    } else {
      process.stdout.write(formatTable(points, opts.scenario, opts.workload, opts.index));
    }
    return 0;
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

// Vrai quand le fichier est lancé directement (process.argv[1] = ce fichier).
// Comparaison exacte : une translation de slash casserait la détection sur
// POSIX (fileURLToPath y renvoie des '/', pas des '\').
export function isDirectRun(resolvedPath, argv1) {
  return !!argv1 && resolvedPath === resolve(argv1);
}

// Point d'entrée CLI (exécuté seulement quand le fichier est lancé directement).
if (isDirectRun(fileURLToPath(import.meta.url), process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}