# pi-web-search

A [pi](https://github.com/badlogic/pi-mono) extension that adds a `web_search` tool backed by [Exa](https://exa.ai) and [Tavily](https://tavily.com). Pure Node, no native dependencies, works on Termux/Android.

## What it does

Registers one model-callable tool:

- **`web_search(query, max_results?, backend?)`** — search the public web and return a numbered markdown list of results. The agent calls this autonomously when it needs current information; you do not invoke it explicitly.

## Install

```sh
pi install npm:pi-web-search
```

Or try without installing:

```sh
pi -e /path/to/pi-web-search
```

## Configuration

The tool needs at least one of `EXA_API_KEY` or `TAVILY_API_KEY`. Keys are resolved in this order (first non-empty wins per provider):

1. `process.env` (your shell or how you launched pi)
2. `${cwd}/.env` — a `.env` file in the project directory
3. `~/.pi/agent/.env` — a global fallback in your home directory

`.env` files are parsed by a small built-in parser; they support comments, `export` prefix, and quoted values. They are **not** merged into `process.env` — they're only consulted for missing keys.

### Examples

Set a key just for the current shell:

```sh
export EXA_API_KEY=...
pi
```

Set a project-local key (only used when pi is launched from that directory):

```sh
echo 'EXA_API_KEY=...' > ~/code/my-project/.env
cd ~/code/my-project && pi
```

Set a global key (used everywhere):

```sh
mkdir -p ~/.pi/agent
echo 'EXA_API_KEY=...' > ~/.pi/agent/.env
```

> Keys are **never** logged or included in error messages. The `/websearch` status command shows them masked (e.g. `tvly****yz`).

## Usage

The model sees a single tool with a clean schema:

```ts
web_search({
  query: "latest Anthropic model release notes",
  max_results: 5,                    // optional, default 5, clamped to 1-10
  backend: "auto",                   // optional: "auto" | "exa" | "tavily"
})
```

`auto` (the default) prefers Exa if its key is present, else falls back to Tavily. On a transient error (network, 5xx, 429) in `auto` mode, the tool falls back once to the other provider when its key exists. Auth errors (401/403) are reported directly so the user knows to fix their key rather than burning the other provider's quota.

The result is a numbered markdown list:

```
1. [Title](https://example.com)
   short snippet — 2024-09-12

2. [Another](https://example.org)
   another snippet

Served by: exa.
```

Plus a `structuredContent` payload for [codemode](https://github.com/badlogic/pi-mono) scripts: `{ query, backend, fallbackUsed, resultCount, results: [{ title, url, snippet, publishedDate?, score? }] }`.

## Development

```sh
npm install          # no native build, ~10s
npm test             # 46 unit tests, ~1s
npm run typecheck    # tsc --noEmit
npm run lint         # biome check
```

The test runner is Node's built-in `node:test` with `--experimental-strip-types` — no vitest, no jest, no native deps. (vitest's rolldown and esbuild's native bindings can't load on Termux due to Android's linker namespace restrictions; this avoids that whole class of problem.)

> **Note:** `biome`'s CLI does not ship prebuilt binaries for Android ARM64 either. `npm run lint` will fail on Termux; run it from a normal platform or in CI. The `prepublishOnly` script intentionally skips lint so local Android development is unblocked.

### Layout

```
src/
├── index.ts              # extension entry: registerTool + registerCommand
├── config.ts             # key resolution (env → cwd .env → global .env)
├── dotenv.ts             # zero-dep .env parser
├── format.ts             # markdown output + 8KB cap
├── types.ts              # SearchResult, ToolDetails
└── providers/
    ├── provider.ts       # SearchProvider interface, error classification
    ├── exa.ts            # POST api.exa.ai/search
    └── tavily.ts         # POST api.tavily.com/search
test/
├── dotenv.test.ts
├── config.test.ts
├── providers.test.ts
└── format.test.ts
```

## License

MIT
