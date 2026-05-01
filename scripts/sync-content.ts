#!/usr/bin/env tsx
/**
 * Sync content from the ProsodyAI monorepo into this MCP server's bundled
 * `content/` folder.
 *
 * Resolution order for the monorepo root:
 * 1. PROSODYAI_REPO_ROOT environment variable.
 * 2. <thisDir>/.. (sibling layout, /Users/.../Developer/prosodyai)
 * 3. <thisDir>/../prosodyai
 * 4. <thisDir>/../../  (when this package is mounted as packages/mcp-docs in the monorepo)
 *
 * What gets synced:
 *   docs/*.md                                  -> content/docs/
 *   api/README.md                              -> content/sdks/api-fastapi.md
 *   packages/sdk/README.md                     -> content/sdks/typescript.md
 *   packages/langchain/README.md               -> content/sdks/langchain.md
 *   packages/livekit/README.md (if present)    -> content/sdks/livekit.md
 *   prosody_ssm/README.md (if present)         -> content/sdks/python-core.md
 *   <generated openapi.json>                   -> content/api/openapi.json (if available)
 *
 * Recipes are author-managed in content/recipes/ and are never overwritten by
 * this script.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HERE = resolve(__dirname, "..");
const CONTENT = resolve(HERE, "content");

function findRepoRoot(): string | null {
  const candidates = [
    process.env.PROSODYAI_REPO_ROOT,
    resolve(HERE, "..", "prosodyai"),
    resolve(HERE, ".."),
    resolve(HERE, "..", ".."),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(join(c, "docs")) && existsSync(join(c, "api"))) return c;
  }
  return null;
}

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

function copyIfExists(src: string, dest: string): boolean {
  if (!existsSync(src)) return false;
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  return true;
}

function copyDocsTree(srcDir: string, destDir: string) {
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  for (const name of readdirSync(srcDir)) {
    if (name.startsWith(".")) continue;
    const src = join(srcDir, name);
    const dest = join(destDir, name);
    const st = statSync(src);
    if (st.isDirectory()) {
      ensureDir(dest);
      count += copyDocsTree(src, dest);
    } else if (name.endsWith(".md")) {
      ensureDir(dirname(dest));
      copyFileSync(src, dest);
      count += 1;
    }
  }
  return count;
}

async function tryGenerateOpenApi(repoRoot: string): Promise<string | null> {
  // 1. Pre-generated file in known locations.
  const candidates = [
    join(repoRoot, "api", "openapi.json"),
    join(repoRoot, "docs", "openapi.json"),
    join(repoRoot, "openapi.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // 2. Try to generate from the FastAPI app. Best-effort — silently skip if
  //    Python or the deps are unavailable.
  const apiDir = join(repoRoot, "api");
  if (!existsSync(join(apiDir, "main.py"))) return null;
  const tmp = join(apiDir, "openapi.json");
  const py = process.env.PYTHON ?? "python";
  const result = spawnSync(
    py,
    [
      "-c",
      "import sys; sys.path.insert(0, '.'); from main import app; import json; print(json.dumps(app.openapi(), indent=2))",
    ],
    { cwd: apiDir, encoding: "utf8" },
  );
  if (result.status === 0 && result.stdout) {
    writeFileSync(tmp, result.stdout);
    return tmp;
  }
  return null;
}

async function main() {
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    console.warn(
      "[sync-content] Could not locate ProsodyAI monorepo. Set PROSODYAI_REPO_ROOT to the repo root. Skipping sync (existing content/ left as-is).",
    );
    ensureDir(join(CONTENT, "docs"));
    ensureDir(join(CONTENT, "sdks"));
    ensureDir(join(CONTENT, "recipes"));
    ensureDir(join(CONTENT, "api"));
    return;
  }
  console.log(`[sync-content] repo root: ${repoRoot}`);

  ensureDir(join(CONTENT, "docs"));
  ensureDir(join(CONTENT, "sdks"));
  ensureDir(join(CONTENT, "recipes"));
  ensureDir(join(CONTENT, "api"));

  // Top-level README -> docs/README.md (overview)
  copyIfExists(join(repoRoot, "README.md"), join(CONTENT, "docs", "README.md"));

  // Markdown docs
  const docsCount = copyDocsTree(join(repoRoot, "docs"), join(CONTENT, "docs"));
  console.log(`[sync-content] copied ${docsCount} doc files`);

  // SDK READMEs
  const sdkSources: Array<[string, string]> = [
    [join(repoRoot, "api", "README.md"), join(CONTENT, "sdks", "api-fastapi.md")],
    [join(repoRoot, "packages", "sdk", "README.md"), join(CONTENT, "sdks", "typescript.md")],
    [join(repoRoot, "packages", "langchain", "README.md"), join(CONTENT, "sdks", "langchain.md")],
    [join(repoRoot, "packages", "livekit", "README.md"), join(CONTENT, "sdks", "livekit.md")],
    [join(repoRoot, "prosody_ssm", "README.md"), join(CONTENT, "sdks", "python-core.md")],
  ];
  let sdkCount = 0;
  for (const [src, dest] of sdkSources) {
    if (copyIfExists(src, dest)) {
      sdkCount += 1;
      console.log(`[sync-content] sdk: ${src} -> ${dest}`);
    }
  }
  console.log(`[sync-content] copied ${sdkCount} SDK READMEs`);

  // OpenAPI
  const openapi = await tryGenerateOpenApi(repoRoot);
  if (openapi) {
    copyFileSync(openapi, join(CONTENT, "api", "openapi.json"));
    console.log(`[sync-content] copied openapi from ${openapi}`);
  } else {
    // Write a status marker so the server can give a useful error.
    writeFileSync(
      join(CONTENT, "api", "openapi-status.md"),
      [
        "# OpenAPI status",
        "",
        "No `openapi.json` was found at sync time. To bundle one, run from the monorepo root:",
        "",
        "```bash",
        "cd api && python -c \"from main import app; import json; print(json.dumps(app.openapi()))\" > openapi.json",
        "```",
        "",
        "Then re-run `npm run build:content` in this package.",
      ].join("\n"),
    );
    console.log("[sync-content] no openapi.json found — wrote status marker");
  }

  console.log("[sync-content] done");
}

main().catch((err) => {
  console.error("[sync-content] failed:", err);
  process.exit(1);
});
