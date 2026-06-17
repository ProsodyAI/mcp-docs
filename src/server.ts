import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getEntry,
  listEntries,
  loadContent,
  searchContent,
  type ContentSection,
} from "./lib/content.js";
import { getEndpoint, listEndpoints, loadOpenApi } from "./lib/openapi.js";
import { SERVER_NAME, SERVER_VERSION } from "./lib/version.js";

const sectionEnum = z.enum(["docs", "sdks", "recipes", "api"]);

function textResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function jsonResponse(value: unknown) {
  return textResponse(JSON.stringify(value, null, 2));
}

function mimeFor(relPath: string): string {
  if (relPath.endsWith(".json")) return "application/json";
  if (relPath.endsWith(".yaml") || relPath.endsWith(".yml")) return "application/yaml";
  return "text/markdown";
}

export async function createServer(): Promise<McpServer> {
  await loadContent();

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions: [
        "ProsodyAI documentation, SDK references, REST API reference, and curated implementation recipes.",
        "",
        "Use this server when implementing a ProsodyAI integration in any voice or agent app.",
        "",
        "Workflow:",
        "1. Start with `get_overview` for context on what ProsodyAI does and how the pieces fit together.",
        "2. Use `list_recipes` to discover end-to-end implementation guides.",
        "3. Use `search_docs` for any topic; everything (docs, SDKs, recipes, OpenAPI metadata) is indexed.",
        "4. Use `read_doc` with the returned `id` to fetch full content.",
        "5. For REST integration, use `list_endpoints` then `get_endpoint` (or `get_openapi` for the full spec).",
        "6. SDK READMEs live under section `sdks` (e.g. `sdks/typescript`, `sdks/langchain`, `sdks/livekit`, `sdks/python-core`).",
      ].join("\n"),
    },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search ProsodyAI docs",
      description:
        "Search ProsodyAI docs, SDK READMEs, recipes, and OpenAPI metadata. Returns a ranked list of matches with snippets and stable `id`s. Follow up with `read_doc` to fetch full content.",
      inputSchema: {
        query: z.string().min(1).describe("Free-text search query."),
        section: sectionEnum
          .optional()
          .describe("Restrict to a single section: docs | sdks | recipes | api."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
      },
    },
    async ({ query, section, limit }) => {
      const results = await searchContent(query, { section, limit });
      if (!results.length) {
        return textResponse(`No matches for "${query}".`);
      }
      const lines = results.map((r, i) =>
        [
          `${i + 1}. [${r.section}] ${r.title}  (id: ${r.id})`,
          `   ${r.description}`,
          `   snippet: ${r.snippet}`,
        ].join("\n"),
      );
      return textResponse(lines.join("\n\n"));
    },
  );

  server.registerTool(
    "list_docs",
    {
      title: "List all docs",
      description:
        "List every document in this server. Useful for browsing without a search query.",
      inputSchema: {
        section: sectionEnum.optional().describe("Filter to a single section."),
      },
    },
    async ({ section }) => {
      const entries = await listEntries(section);
      if (!entries.length) return textResponse("No documents available.");
      const grouped = new Map<string, typeof entries>();
      for (const e of entries) {
        const arr = grouped.get(e.section) ?? [];
        arr.push(e);
        grouped.set(e.section, arr);
      }
      const out: string[] = [];
      for (const [sec, items] of grouped) {
        out.push(`## ${sec}`);
        for (const item of items) {
          out.push(`- ${item.id}  —  ${item.title}`);
        }
        out.push("");
      }
      return textResponse(out.join("\n"));
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Read a doc",
      description:
        "Fetch the full content of a doc, SDK README, recipe, or other entry by `id` (as returned by `search_docs` or `list_docs`).",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            "Stable id returned by search/list, e.g. `docs/STRUCTURE`, `sdks/typescript`, `recipes/livekit-realtime-agent`.",
          ),
      },
    },
    async ({ id }) => {
      const entry = await getEntry(id);
      if (!entry) return textResponse(`No document with id "${id}".`);
      const header = `# ${entry.title}\n\n_Section: ${entry.section} • id: ${entry.id} • path: ${entry.relPath}_\n\n---\n\n`;
      return textResponse(header + entry.body);
    },
  );

  server.registerTool(
    "list_endpoints",
    {
      title: "List REST endpoints",
      description:
        "List ProsodyAI REST API endpoints from the bundled OpenAPI spec. Optional filters by tag or path substring.",
      inputSchema: {
        tag: z.string().optional().describe("Filter by OpenAPI tag (e.g. `Analysis`, `Sessions`)."),
        pathContains: z
          .string()
          .optional()
          .describe("Substring filter on the URL path (e.g. `analyze`)."),
      },
    },
    async ({ tag, pathContains }) => {
      const endpoints = await listEndpoints({ tag, pathContains });
      if (!endpoints.length) {
        return textResponse(
          "No endpoints found. The OpenAPI spec may not be bundled — read `api/openapi-status` for instructions.",
        );
      }
      const lines = endpoints.map(
        (e) =>
          `${e.method.padEnd(6)} ${e.path}${e.summary ? `  — ${e.summary}` : ""}${
            e.tags?.length ? `  [${e.tags.join(", ")}]` : ""
          }`,
      );
      return textResponse(lines.join("\n"));
    },
  );

  server.registerTool(
    "get_endpoint",
    {
      title: "Get a REST endpoint",
      description:
        "Get the full OpenAPI operation object (parameters, request body, responses, security) for a single REST endpoint.",
      inputSchema: {
        method: z.string().describe("HTTP method, e.g. `POST`."),
        path: z.string().describe("OpenAPI path template, e.g. `/v1/analyze/audio`."),
      },
    },
    async ({ method, path }) => {
      const result = await getEndpoint(method, path);
      if (!result) return textResponse(`No endpoint ${method.toUpperCase()} ${path}.`);
      return jsonResponse(result);
    },
  );

  server.registerTool(
    "get_openapi",
    {
      title: "Get the full OpenAPI spec",
      description:
        "Return the full bundled OpenAPI 3 spec for the ProsodyAI REST API. Use sparingly — prefer `list_endpoints` + `get_endpoint` for targeted lookups.",
      inputSchema: {},
    },
    async () => {
      const spec = await loadOpenApi();
      if (!spec) return textResponse("OpenAPI spec is not bundled in this build.");
      return jsonResponse(spec);
    },
  );

  server.registerTool(
    "list_recipes",
    {
      title: "List implementation recipes",
      description:
        "List curated end-to-end implementation recipes for common ProsodyAI integration tasks (e.g. add prosody to a LiveKit agent, stream from a browser, wire the LangChain tool, define KPIs).",
      inputSchema: {},
    },
    async () => {
      const recipes = await listEntries("recipes");
      if (!recipes.length) return textResponse("No recipes bundled.");
      const lines = recipes.map((r) => `- ${r.id}  —  ${r.title}\n    ${r.description}`);
      return textResponse(lines.join("\n\n"));
    },
  );

  server.registerTool(
    "get_overview",
    {
      title: "Platform overview",
      description:
        "Return a single-page overview of the ProsodyAI platform: what it is, what to use, and how the SDKs/API/recipes relate. Read this first when starting an integration.",
      inputSchema: {},
    },
    async () => {
      const entry = (await getEntry("docs/OVERVIEW")) ?? (await getEntry("docs/README"));
      if (!entry) return textResponse("Overview not bundled.");
      return textResponse(entry.body);
    },
  );

  // Expose every content entry as a resource for clients that browse them
  // directly (vs. calling tools).
  const allEntries = await loadContent();
  for (const entry of allEntries) {
    const mime = mimeFor(entry.relPath);
    server.registerResource(
      entry.id,
      `prosodyai://${entry.id}`,
      {
        title: entry.title,
        description: entry.description,
        mimeType: mime,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: mime,
            text: entry.body,
          },
        ],
      }),
    );
  }

  return server;
}

export type { ContentSection };
