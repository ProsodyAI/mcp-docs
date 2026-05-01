# @prosodyai/mcp-docs

MCP server that exposes ProsodyAI documentation, SDK references, REST API
reference (OpenAPI), and curated implementation recipes to AI coding agents.

Built so that an external coding agent (e.g. **AureliaStudio**) can implement
ProsodyAI integrations correctly the first time, without scraping the
website or guessing API shapes.

Ships with **two transports** in a single TypeScript codebase:

- **stdio** — for local agents (Cursor, Claude Code, Cline, etc.)
- **HTTP (Streamable HTTP)** — for remote/hosted agents

## Tools exposed

| Tool             | Purpose                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `search_docs`    | Search docs, SDK READMEs, recipes, and OpenAPI in one call               |
| `list_docs`      | Browse everything by section (`docs`, `sdks`, `recipes`, `api`)          |
| `read_doc`       | Fetch the full body of a doc / README / recipe by id                     |
| `list_recipes`   | List end-to-end implementation guides                                    |
| `list_endpoints` | List REST endpoints from the bundled OpenAPI spec, filterable by tag    |
| `get_endpoint`   | Full OpenAPI operation object for a single endpoint                      |
| `get_openapi`    | The entire bundled OpenAPI 3 spec                                        |
| `get_overview`   | One-page intro — read this first when starting an integration            |

Every entry is also exposed as an MCP **resource** at
`prosodyai://<section>/<id>` for clients that prefer resources over tools.

## Recipes that ship

- `recipes/sdk-typescript-quickstart` — Add ProsodyAI to a Node / Next.js / browser app
- `recipes/livekit-realtime-agent` — Real-time voice agent with prosody-driven adaptation
- `recipes/langchain-agent` — Use prosody as a LangChain tool
- `recipes/browser-streaming` — Stream mic audio from the browser
- `recipes/kpi-flow` — Define custom KPIs and close the feedback loop
- `recipes/rest-api-integration` — Direct REST integration without an SDK

## Running locally

```bash
npm install
npm run build         # syncs content/ from the monorepo, then compiles
npm run start:stdio   # for stdio MCP clients
npm run start:http    # http on localhost:3333/mcp
```

`npm run build:content` rebuilds `content/` from the parent monorepo. It
locates the monorepo via `PROSODYAI_REPO_ROOT` or by walking up from this
package's directory (works when mounted as `packages/mcp-docs` in the
parent monorepo).

## Use it from AureliaStudio (or any MCP client)

### Stdio (local)

Add to your client's `mcp.json`:

```json
{
  "mcpServers": {
    "prosodyai-docs": {
      "command": "npx",
      "args": ["-y", "@prosodyai/mcp-docs"]
    }
  }
}
```

Or run from a checkout:

```json
{
  "mcpServers": {
    "prosodyai-docs": {
      "command": "node",
      "args": ["/abs/path/to/mcp-docs/dist/stdio.js"]
    }
  }
}
```

### HTTP (remote)

Once deployed (see below), point your client at the public URL:

```json
{
  "mcpServers": {
    "prosodyai-docs": {
      "url": "https://prosodyai-docs.vercel.app/mcp"
    }
  }
}
```

## Deployment

The HTTP entrypoint is a plain `express` app that listens on `PORT` (default
`3333`) at path `/mcp`. It works on any Node host:

- **Vercel / Cloud Run / Fly / Railway**: deploy as a Node service with
  `npm run build` as the build step and `npm run start:http` as the start
  command.
- **Docker**: see `Dockerfile` (single-stage Node 20-slim image).

`/healthz` returns a JSON heartbeat for container orchestrators.

## Updating content

Whenever the parent monorepo's docs, SDK READMEs, or OpenAPI spec change:

```bash
cd packages/mcp-docs    # or wherever this is mounted
npm run build:content
git add content/ && git commit -m "Sync docs from monorepo"
```

The next deploy serves the new content. (CI on `ProsodyAI/prosodyai`'s `master`
branch should run this automatically — see `.github/workflows/sync.yml` if
present.)

## License

MIT
