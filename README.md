# openfox-opencode-free
OpenFox plugin for the OpenCode provider focused on **free models only** (`https://opencode.ai/zen/v1`), with an automatic hourly update system (1x per hour).

## Features
- **OpenCode (Free Models) Provider** integrated into OpenFox.
- **Automatic filtering**: Only free OpenCode models (ending in `-free`) are retrieved.
- **Hourly updates (1x/hour)**:
  - Automatic addition of new free models as soon as they appear.
  - Automatic removal of discontinued models.
- **API Key Authentication**: Connect with your OpenCode API key (or via the `OPENCODE_API_KEY` variable).
- **Full support for OpenFox features**: SSE streaming, tool calls, thinking/reasoning.

## Installation
In OpenFox's plugins directory (`~/.openfox/plugins/` or via the registry):
```bash
npm install openfox-opencode-free
```

## Usage
1. Enable the **OpenCode (Free Models)** provider in OpenFox.
2. Set the `OPENCODE_API_KEY` environment variable or connect your account.
3. Enjoy OpenCode's free models, updated every hour.

## License
MIT
