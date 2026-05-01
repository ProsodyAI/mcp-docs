import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgPath = resolve(__dirname, "..", "..", "package.json");
let version = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  version = pkg.version ?? version;
} catch {
  // ignore
}

export const SERVER_NAME = "prosodyai-docs";
export const SERVER_VERSION = version;
