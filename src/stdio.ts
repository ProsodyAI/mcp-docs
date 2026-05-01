#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep process alive until stdin closes.
  process.stdin.on("close", () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[prosodyai-mcp-docs] fatal:", err);
  process.exit(1);
});
