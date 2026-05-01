import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import Fuse from "fuse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In dist/lib/content.js the content folder is two levels up at <pkg>/content
// In src/lib/content.ts the content folder is two levels up at <pkg>/content
export const CONTENT_ROOT = resolve(__dirname, "..", "..", "content");

export type ContentSection = "docs" | "sdks" | "recipes" | "api";

export interface ContentEntry {
  /** Stable slug used as identifier in tool calls, e.g. "docs/STRUCTURE" */
  id: string;
  section: ContentSection;
  /** Path relative to the content root */
  relPath: string;
  /** Absolute path on disk */
  absPath: string;
  /** Title pulled from first markdown heading (or filename) */
  title: string;
  /** Lightweight description (first paragraph) */
  description: string;
  /** Whole file contents in memory */
  body: string;
}

let cache: ContentEntry[] | null = null;
let fuse: Fuse<ContentEntry> | null = null;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (
      name.endsWith(".md") ||
      name.endsWith(".mdx") ||
      name.endsWith(".json") ||
      name.endsWith(".yaml") ||
      name.endsWith(".yml")
    ) {
      out.push(full);
    }
  }
  return out;
}

function extractTitle(body: string, fallback: string): string {
  const match = body.match(/^#\s+(.+?)\s*$/m);
  if (match) return match[1].trim();
  return fallback;
}

function extractDescription(body: string): string {
  const lines = body.split(/\r?\n/);
  const paras: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) {
      if (paras.length) break;
      continue;
    }
    if (line.trim() === "") {
      if (buf.length) {
        paras.push(buf.join(" ").trim());
        buf = [];
      }
      if (paras.length) break;
    } else {
      buf.push(line.trim());
    }
  }
  if (buf.length && !paras.length) paras.push(buf.join(" ").trim());
  const desc = paras[0] ?? "";
  return desc.length > 280 ? desc.slice(0, 277) + "..." : desc;
}

function inferSection(relPath: string): ContentSection {
  const top = relPath.split(/[\\/]/)[0];
  if (top === "docs" || top === "sdks" || top === "recipes" || top === "api") return top;
  return "docs";
}

function makeId(relPath: string): string {
  // strip extension; normalise slashes
  return relPath.replace(/\\/g, "/").replace(/\.(md|mdx|json|yaml|yml)$/i, "");
}

export async function loadContent(force = false): Promise<ContentEntry[]> {
  if (cache && !force) return cache;
  const files = await walk(CONTENT_ROOT);
  const entries: ContentEntry[] = [];
  for (const absPath of files) {
    const relPath = relative(CONTENT_ROOT, absPath);
    const body = await readFile(absPath, "utf8");
    const id = makeId(relPath);
    const filename = id.split("/").pop() || id;
    const isStructured = /\.(json|yaml|yml)$/i.test(absPath);
    entries.push({
      id,
      section: inferSection(relPath),
      relPath,
      absPath,
      title: isStructured ? filename : extractTitle(body, filename),
      description: isStructured ? `Structured data: ${filename}` : extractDescription(body),
      body,
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  cache = entries;
  fuse = new Fuse(entries, {
    keys: [
      { name: "title", weight: 0.5 },
      { name: "description", weight: 0.2 },
      { name: "id", weight: 0.2 },
      { name: "body", weight: 0.1 },
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.4,
    minMatchCharLength: 2,
  });
  return entries;
}

export async function getEntry(id: string): Promise<ContentEntry | undefined> {
  const all = await loadContent();
  const norm = makeId(id);
  return all.find((e) => e.id === norm);
}

export async function listEntries(section?: ContentSection): Promise<ContentEntry[]> {
  const all = await loadContent();
  return section ? all.filter((e) => e.section === section) : all;
}

export async function searchContent(
  query: string,
  options: { section?: ContentSection; limit?: number } = {},
): Promise<Array<ContentEntry & { score: number; snippet: string }>> {
  await loadContent();
  if (!fuse) return [];
  const limit = options.limit ?? 10;
  const results = fuse.search(query, { limit: limit * 3 });
  const filtered = options.section
    ? results.filter((r) => r.item.section === options.section)
    : results;
  return filtered.slice(0, limit).map((r) => ({
    ...r.item,
    score: r.score ?? 0,
    snippet: makeSnippet(r.item.body, query),
  }));
}

function makeSnippet(body: string, query: string): string {
  const lower = body.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase().split(/\s+/)[0] ?? "");
  if (idx === -1) {
    return body.slice(0, 240).trim();
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(body.length, idx + 200);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < body.length ? "..." : "";
  return prefix + body.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}
