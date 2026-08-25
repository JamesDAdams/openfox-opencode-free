# openfox-openrouter-free

Plugin OpenFox pour le fournisseur OpenRouter orienté **modèles gratuits uniquement**, avec système de mise à jour automatique horaire (1x par heure).

## Fonctionnalités

- **Provider OpenRouter (Free Models)** intégré à OpenFox.
- **Filtre automatique** : Seuls les modèles OpenRouter gratuits (`pricing.prompt == "0"` et `pricing.completion == "0"`) sont récupérés.
- **Mise à jour horaire (1x/heure)** :
  - Ajout automatique des nouveaux modèles gratuits dès leur apparition.
  - Suppression automatique des modèles retirés ou devenus payants.
- **Authentification 1-Click OAuth / API Key** : Connexion rapide avec votre compte OpenRouter (ou via la variable `OPENROUTER_API_KEY`) pour la gestion des rate limits et requêtes.
- **Support complet des fonctionnalités OpenFox** : Streaming, tool calls, thinking/reasoning.

## Installation

Dans le répertoire des plugins d'OpenFox (`~/.openfox/plugins/` ou via le registre) :

```bash
npm install openfox-openrouter-free
```

## Utilisation

1. Activez le provider **OpenRouter (Free Models)** dans OpenFox.
2. Cliquez sur **Connect OpenRouter** pour vous authentifier avec votre compte OpenRouter en un clic (ou définissez la variable d'environnement `OPENROUTER_API_KEY`).
3. Profitez des modèles gratuits d'OpenRouter mis à jour toutes les heures.

## Licence

MIT
