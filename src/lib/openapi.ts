import { getEntry } from "./content.js";

interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  security?: unknown[];
  operationId?: string;
}

interface OpenApiSpec {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown> };
}

let cached: OpenApiSpec | null = null;

export async function loadOpenApi(): Promise<OpenApiSpec | null> {
  if (cached) return cached;
  const entry = await getEntry("api/openapi");
  if (!entry) return null;
  try {
    cached = JSON.parse(entry.body) as OpenApiSpec;
    return cached;
  } catch {
    return null;
  }
}

export interface EndpointSummary {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
}

export async function listEndpoints(filter?: {
  tag?: string;
  pathContains?: string;
}): Promise<EndpointSummary[]> {
  const spec = await loadOpenApi();
  if (!spec?.paths) return [];
  const out: EndpointSummary[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) continue;
      const summary: EndpointSummary = {
        method: method.toUpperCase(),
        path,
        operationId: op.operationId,
        summary: op.summary,
        tags: op.tags,
      };
      if (filter?.tag && !(op.tags ?? []).includes(filter.tag)) continue;
      if (filter?.pathContains && !path.toLowerCase().includes(filter.pathContains.toLowerCase())) continue;
      out.push(summary);
    }
  }
  return out.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

export async function getEndpoint(method: string, path: string): Promise<{
  method: string;
  path: string;
  operation: OpenApiOperation;
} | null> {
  const spec = await loadOpenApi();
  const op = spec?.paths?.[path]?.[method.toLowerCase()];
  if (!op) return null;
  return { method: method.toUpperCase(), path, operation: op };
}
