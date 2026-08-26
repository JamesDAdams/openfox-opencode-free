# openfox-opencode-free

Plugin OpenFox pour le fournisseur OpenCode orienté **modèles gratuits uniquement** (`https://opencode.ai/zen/v1`), avec système de mise à jour automatique horaire (1x par heure).

## Fonctionnalités

- **Provider OpenCode (Free Models)** intégré à OpenFox.
- **Filtre automatique** : Seuls les modèles OpenCode gratuits (se terminant par `-free`) sont récupérés.
- **Mise à jour horaire (1x/heure)** :
  - Ajout automatique des nouveaux modèles gratuits dès leur apparition.
  - Suppression automatique des modèles retirés.
- **Authentification API Key** : Connexion avec votre clé API OpenCode (ou via la variable `OPENCODE_API_KEY`).
- **Support complet des fonctionnalités OpenFox** : Streaming SSE, tool calls, thinking/reasoning.

## Installation

Dans le répertoire des plugins d'OpenFox (`~/.openfox/plugins/` ou via le registre) :

```bash
npm install openfox-opencode-free
```

## Utilisation

1. Activez le provider **OpenCode (Free Models)** dans OpenFox.
2. Définissez la variable d'environnement `OPENCODE_API_KEY` ou connectez votre compte.
3. Profitez des modèles gratuits d'OpenCode mis à jour toutes les heures.

## Licence

MIT
