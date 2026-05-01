import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { SERVER_NAME, SERVER_VERSION } from "./lib/version.js";

const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? "0.0.0.0";
const PATH = process.env.MCP_PATH ?? "/mcp";

async function main() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      transport: "streamable-http",
      mcp_endpoint: PATH,
      docs: "https://github.com/ProsodyAI/mcp-docs",
    });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });
  });

  // Map of session id -> transport. Sessions live for the duration of an MCP
  // client connection (initialize -> ... -> session terminated).
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post(PATH, async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id") ?? undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = await createServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: no valid session id and not an initialize request.",
        },
        id: null,
      });
      return;
    }

    await transport!.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session id");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };

  app.get(PATH, handleSessionRequest);
  app.delete(PATH, handleSessionRequest);

  app.listen(PORT, HOST, () => {
    console.log(
      `[${SERVER_NAME}@${SERVER_VERSION}] listening on http://${HOST}:${PORT}${PATH}`,
    );
  });
}

main().catch((err) => {
  console.error("[prosodyai-mcp-docs] fatal http error:", err);
  process.exit(1);
});
