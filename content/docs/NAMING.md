# Naming: ProsodyAI vs prosodyai-api

Single source of truth so we don’t confuse repos, packages, and the product.

| Term | Meaning | Where it appears |
|------|--------|-------------------|
| **ProsodyAI** | Product/company; the **monorepo** (this repo). | GitHub: ProsodyAI/prosodyai. Root of this repo. |
| **ProsodyAI/api** or **api repo** | The **API Git repository**. The FastAPI service code. | GitHub: ProsodyAI/api. In the monorepo: `api/` (submodule). |
| **prosodyai-api** | The **Python package name** for the API. Used for `pip install` and Python packaging only. | `api/pyproject.toml`: `name = "prosodyai-api"`. Not a repo name. |
| **@prosodyai/api** | Handle for the API (e.g. in docs or npm-style naming). Refers to the API as a product surface. | README table, docs. |

Rules of thumb:

- **Repos**: ProsodyAI/prosodyai (monorepo), ProsodyAI/api (API), ProsodyAI/website, ProsodyAI/model, etc. Repo names are lowercase; org is ProsodyAI.
- **API in this repo**: The `api/` directory is the API repo as a submodule. Deploy from that directory (or from a clone of ProsodyAI/api).
- **prosodyai-api**: Only the PyPI/pip package name. When we say “the API” we mean the service and the ProsodyAI/api repo, not the string “prosodyai-api” unless we’re talking about the Python package.

Env vars and URLs:

- **PROSODYAI_*** = env vars for the product (API, dashboard, etc.). No “prosodyai-api” in env var names.
- **api.prosodyai.app** = hostname for the API (ProsodyAI product, API surface).
