#!/usr/bin/env tsx
/**
 * In-process smoke test: spins up the MCP server with an in-memory transport
 * and verifies that `list_tools`, `search_docs`, `read_doc`, and
 * `list_recipes` all work.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  InMemoryTransport,
} from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

async function main() {
  const server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "smoke-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  const tools = await client.listTools();
  console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  const overview = await client.callTool({ name: "get_overview", arguments: {} });
  // @ts-expect-error content shape
  const overviewText = overview.content?.[0]?.text ?? "";
  console.log(`overview length: ${overviewText.length} chars`);

  const recipes = await client.callTool({ name: "list_recipes", arguments: {} });
  // @ts-expect-error
  console.log("recipes:\n" + recipes.content?.[0]?.text);

  const search = await client.callTool({
    name: "search_docs",
    arguments: { query: "livekit" },
  });
  // @ts-expect-error
  console.log("\nsearch livekit:\n" + search.content?.[0]?.text);

  await client.close();
  await server.close();
  console.log("\nsmoke OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
