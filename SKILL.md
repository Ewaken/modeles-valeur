---
name: modeles-valeur
description: Liste les modèles IA au meilleur rapport qualité/prix en croisant l'Intelligence Index d'artificialanalysis.ai avec les prix réels (dont discounts/overrides) d'OpenRouter. À utiliser quand l'utilisateur demande le meilleur modèle qualité/prix, un classement de modèles, ou comparer des modèles sur le coût.
---

# Modèles au meilleur rapport qualité/prix

Croise la qualité mesurée par artificialanalysis.ai (Intelligence Index et indices Coding/Agentic) avec les prix réels d'OpenRouter (y compris les discounts et overrides temporels) pour classer les modèles par valeur (qualité ÷ coût par tâche).

## Prérequis

- Node ≥ 18, zéro dépendance.
- Une clé API artificialanalysis.ai (gratuite, sur <https://artificialanalysis.ai/data-api>, limite ~100 requêtes/jour). OpenRouter n'exige pas de clé pour la liste des modèles.

## Installation de la clé

Soit la variable d'environnement :

```bash
export ARTIFICIALANALYSIS_API_KEY="votre-clé"
```

Soit `data/config.json` (gitignoré), copié depuis `data/config.example.json` :

```json
{ "artificialanalysis_api_key": "votre-clé" }
```

## Utilisation

```bash
node scripts/rank.mjs                          # classement par défaut
node scripts/rank.mjs --workload chat --scenario current --top 25
node scripts/rank.mjs --scenario min --workload agent --json
node scripts/rank.mjs --index coding --csv
node scripts/rank.mjs --min-speed 100 --top 10  # modèle texte seulement
```

Drapeaux : `--workload chat|agent|reasoning` (défaut `chat`), `--scenario current|min|peak` (défaut `current`), `--index intelligence|coding|agentic` (défaut `intelligence` ; `math` indisponible en tier gratuit), `--min-speed <tok/s>` (0 = aucun), `--top <N>` (25), `--json`, `--csv`, `--force` (ignore le cache disque). Sorties : tableau aligné (défaut), JSON (`--json`), CSV (`--csv`). Chaque sortie mentionne le scénario de prix utilisé.

### Scénarios de prix

- `current` — prix actuel en fonction du jour et de l'heure (overrides OpenRouter appliqués).
- `min` — le prix le plus bas observé (overrides compris).
- `peak` — le prix le plus élevé observé (overrides compris).

### Profils de charge

- `chat` — conversation courte (1 000 tokens en entrée, 500 en sortie).
- `agent` — agent avec contexte long (20 000 en entrée, 8 000 en sortie, 100 000 de cache).
- `reasoning` — tâche de raisonnement verbeuse (1 500 en entrée, 12 000 en sortie).

## Prix temporels

Les prix OpenRouter varient dans le temps (`pricing.overrides` : plages horaires/journées avec tarifs différents, week-ends, pics). Un classement Figé est donc faux aux heures de pointe : **toujours indiquer le scénario utilisé** avec le résultat.

## Données

- `data/alias.json` — associations manuelles slug AA → id OpenRouter pour les modèles dont les noms diffèrent (à compléter si un modèle reste « non associé »).
- `data/workloads.json` — les trois profils de charge.
- `data/.cache/` — cache disque des réponses API (TTL : AA 6 h, OpenRouter 1 h) ; régénéré, à ne pas versionner.

### Indices de qualité

Les indices AA sont récupérés via le tier gratuit (`/api/v2/language/models/free`). L'indice `math` n'est pas disponible dans ce tier ; il est remplacé par `agentic` (indice agentique, qualifie la capacité à utiliser des outils et suivre des instructions complexes). Les indices accessibles : `intelligence`, `coding`, `agentic`.