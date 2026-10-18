# modeles-valeur

Classe les modèles d'IA (LLM) au meilleur **rapport qualité/prix** en croisant :

- la qualité mesurée par [artificialanalysis.ai](https://artificialanalysis.ai) — Intelligence Index et indices Coding/Agentic,
- les prix réels d'[OpenRouter](https://openrouter.ai), **overrides temporels compris** (plages horaires, week-ends, pics).

La valeur d'un modèle = `qualité ÷ coût par tâche`. Le classement met en tête la frontière de Pareto (aucun autre modèle n'est à la fois moins cher et de meilleure qualité), puis trie par valeur décroissante.

## Prérequis

- Node ≥ 18 — zéro dépendance npm.
- Une clé API artificialanalysis.ai (gratuite, ~100 requêtes/jour) : <https://artificialanalysis.ai/data-api>. OpenRouter n'exige pas de clé pour la liste des modèles.

## Configuration de la clé

Variable d'environnement :

```bash
export ARTIFICIALANALYSIS_API_KEY="votre-clé"
```

ou fichier `data/config.json` (gitignoré), copié depuis `data/config.example.json` :

```json
{ "artificialanalysis_api_key": "votre-clé" }
```

## Utilisation

```bash
node scripts/rank.mjs                          # classement par défaut
node scripts/rank.mjs --workload chat --scenario current --top 25
node scripts/rank.mjs --scenario min --workload agent --json
node scripts/rank.mjs --index coding --csv
node scripts/rank.mjs --min-speed 100 --top 10 # modèles rapides seulement
```

| Drapeau | Valeurs (défaut) | Rôle |
|---|---|---|
| `--workload` | `chat`, `agent`, `reasoning` (`chat`) | profil de charge |
| `--scenario` | `current`, `min`, `peak` (`current`) | scénario de prix |
| `--index` | `intelligence`, `coding`, `agentic` (`intelligence`) | indice de qualité |
| `--min-speed` | tokens/s (`0`) | filtre vitesse de sortie |
| `--top` | N (`25`) | nombre de lignes |
| `--json` / `--csv` | — | sortie machine |
| `--force` | — | ignore le cache disque |

Chaque sortie mentionne le scénario de prix utilisé — les prix OpenRouter variant dans le temps, un classement sans scénario est ambigu.

### Scénarios de prix

- `current` — prix actuel selon le jour et l'heure (overrides OpenRouter appliqués).
- `min` — le prix le plus bas observé.
- `peak` — le prix le plus élevé observé.

### Profils de charge (`data/workloads.json`)

- `chat` — conversation courte : 1 000 tokens en entrée, 500 en sortie.
- `agent` — agent à contexte long : 20 000 en entrée, 8 000 en sortie, 100 000 de cache.
- `reasoning` — raisonnement verbeux : 1 500 en entrée, 12 000 en sortie.

### Indices de qualité

Les indices AA proviennent du tier gratuit (`/api/v2/language/models/free`). L'indice `math` n'y est pas disponible ; les indices accessibles sont `intelligence`, `coding` et `agentic`.

## Association des modèles (matching)

Chaque modèle artificialanalysis.ai est associé à un modèle OpenRouter en trois passes :

1. correspondance exacte sur l'id ;
2. correspondance sur le nom normalisé (provider, casse, ponctuation, suffixes d'effort et tokens de date retirés) ;
3. similarité par trigrammes (Jaccard) au-dessus d'un seuil — les candidats ambigus sont laissés « non associés ».

`data/alias.json` contient les associations manuelles pour les noms divergents. Deux utilitaires l'alimentent :

```bash
node scripts/build-aliases.mjs    # génère des suggestions dans data/alias.suggestions.json
node scripts/review-aliases.mjs   # passe en revue les suggestions, écrit les validées
```

Les modèles sans tarif OpenRouter (coût non calculable) sont exclus du classement.

## Tests

```bash
node --test
```

## Structure

```
scripts/
  api.mjs                  # appels AA (tier gratuit) + OpenRouter, cache disque (AA 6 h / OR 1 h)
  normalize.mjs            # normalisation des noms, alias, similarité trigrammes
  cost.mjs                 # coût par tâche, scénarios de prix, workloads
  score.mjs                # points, frontière de Pareto, classement
  rank.mjs                 # CLI, formats tableau / JSON / CSV
  build-aliases.mjs        # suggestions d'alias
  review-aliases.mjs       # revue interactive des suggestions
data/
  workloads.json           # les trois profils de charge
  alias.json               # associations manuelles slug AA → id OpenRouter
  config.example.json      # modèle de configuration de la clé
tests/                     # tests Node (node:test)
```
