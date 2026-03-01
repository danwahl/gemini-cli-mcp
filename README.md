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

**User install** (available across all projects):

```sh
claude mcp add gemini-cli -s user -- npx -y @danwahl/gemini-cli-mcp
```

**Project install** (shared with your team via `.mcp.json`):

```sh
claude mcp add gemini-cli -s project -- npx -y @danwahl/gemini-cli-mcp
```

Or from source, replace `npx -y @danwahl/gemini-cli-mcp` with `node /absolute/path/to/gemini-cli-mcp/dist/index.js`.

Verify with `claude mcp list`.

## Tool: `cli`

| Parameter   | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `prompt`    | string | yes      | Task or question to send to Gemini |
| `cwd`       | string | yes      | Absolute path to working directory |
| `model`     | string | no       | Model name or alias (see below). Omit to use Gemini CLI's default (`auto`). |
| `sessionId` | string | no       | Resume a previous session. The session ID is returned in the structured output of each call. |

### Structured output

Each call returns structured content alongside the text response:

```json
{
  "sessionId": "e80096bd-...",
  "response": "Gemini's answer...",
  "models": {
    "gemini-2.5-flash-lite": 1399,
    "gemini-3-flash-preview": 18635
  },
  "tools": {
    "list_directory": 2
  }
}
```

`models` maps model name → total tokens used. `tools` maps tool name → call count (only present when Gemini used tools).

### Model aliases

These are passed directly to the CLI, which resolves them:

| Alias        | Description |
|--------------|-------------|
| `auto`       | Default routing (pro or preview depending on settings) |
| `pro`        | Complex reasoning tasks |
| `flash`      | Fast, balanced — good for most tasks |
| `flash-lite` | Fastest, for simple tasks |

Or pass any concrete model name like `"gemini-2.5-pro"`.

### What Gemini can do

Gemini runs with `--approval-mode yolo`, giving it full tool access: read/write files, run shell commands, web search, and more. It operates in the `cwd` you specify.

## Development

```sh
npm run build   # compile with tsc
npm test        # run unit tests
```

### Smoke test

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

## Design

One tool, no prompt wrappers. Claude Code is the orchestrator — it decides what to ask Gemini and how to phrase it. This server is a thin, reliable pipe between MCP and `gemini -p`.

See [CLAUDE.md](./CLAUDE.md) for project conventions.
