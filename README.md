# gemini-cli-mcp

A minimal MCP server that exposes [Gemini CLI](https://github.com/google-gemini/gemini-cli) as a single tool callable from Claude Code (or any MCP client).

## How it works

Claude Code sends prompts to this server via MCP. The server spawns `gemini -p "..."` in headless mode and returns the response. Gemini inherits your Google OAuth session — no API key required.

```
Claude Code ──MCP/stdio──▶ gemini-cli-mcp ──spawn──▶ gemini -p "..." --output-format json
```

## Prerequisites

- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated:
  ```sh
  npm install -g @google/gemini-cli
  gemini  # complete the OAuth login flow
  ```

## Installation

### From source

```sh
git clone https://github.com/danwahl/gemini-cli-mcp
cd gemini-cli-mcp
npm install
npm run build
```

## Configuration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/absolute/path/to/gemini-cli-mcp/cli.js"]
    }
  }
}
```

## Tool: `gemini_task`

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `prompt`  | string | yes      | Task or question to send to Gemini |
| `cwd`     | string | yes      | Absolute path to working directory |
| `model`   | string | no       | Model alias or concrete name (default: `"auto"`) |

### Model aliases

| Alias        | Resolves to              |
|--------------|--------------------------|
| `auto`       | `gemini-2.5-pro`         |
| `pro`        | `gemini-2.5-pro`         |
| `flash`      | `gemini-2.0-flash`       |
| `flash-lite` | `gemini-2.0-flash-lite`  |

You can also pass a concrete model name like `"gemini-2.5-flash-preview-05-20"`.

### What Gemini can do

Gemini runs with `--approval-mode yolo`, giving it full tool access: read/write files, run shell commands, web search, and more. It operates in the `cwd` you specify.

## Development

```sh
npm run build   # compile with tsdown
npm test        # run unit tests
```

### Smoke test

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node cli.js
```

## Design

One tool, no prompt wrappers. Claude Code is the orchestrator — it decides what to ask Gemini and how to phrase it. This server is a thin, reliable pipe between MCP and `gemini -p`.

See [CLAUDE.md](./CLAUDE.md) for project conventions.
