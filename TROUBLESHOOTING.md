# Qresp Troubleshooting

Known issues and fixes encountered while stabilizing the summer baseline. Each
entry lists the **symptom** (with the exact error text, for searchability), the
**cause**, and the **fix / workaround**.

---

## 1. MongoEngine `mongomock://` URI removed → backend tests error

**Symptom** — all `nose2` tests error in `setUp`:
```
Exception: Use of mongomock:// URI or 'is_mock' were removed in favor of
'mongo_client_class=mongomock.MongoClient'. Check the CHANGELOG for more info
```
**Cause** — `project/tests/test_paperDAO.py` connects with `mongomock://localhost`,
but **MongoEngine ≥ 0.27 removed that URI**. With MongoEngine unpinned, pip
resolved a newer version.
**Fix (baseline)** — pinned `mongoengine<0.27` in `requirements.txt`/`setup.py`.
Future maintainers may instead migrate the test `setUp` to
`mongo_client_class=mongomock.MongoClient` and unpin MongoEngine
(see `modernization_report.md` → Future migration roadmap).

## 2. MongoEngine 0.26 vs PyMongo 4 → import fails

**Symptom**:
```
ImportError: cannot import name '_check_name' from 'pymongo.database'
```
**Cause** — `mongoengine==0.26` imports `pymongo.database._check_name`, which was
**removed in PyMongo 4.0**. PyMongo was unpinned and resolved to 4.x.
**Fix (baseline)** — pinned `pymongo<4` (resolves to 3.13.0). The legacy stack is
`mongoengine==0.26.0` + `pymongo==3.13.0` + `mongomock==4.3.0`.

## 3. WTForms 3 / connexion 3 break import (why the caps exist)

**Symptom** — `ImportError` on `wtforms.fields.html5` or `connexion.jsonifier`
after an unpinned install.
**Cause** — `project/views.py` imports `wtforms.fields.html5` (removed in
**WTForms 3.0**); `project/api.py` imports `connexion.jsonifier` (removed in
**connexion 3.0**); `Flask-WTF ≥ 1.0` requires WTForms ≥ 3.
**Fix (baseline)** — `WTForms<3.0`, `Flask-WTF<1.0`, `connexion[swagger-ui]<3.0`,
plus `Flask<2.3`/`Werkzeug<2.3` (flask-mongoengine 1.0 breaks on Flask ≥ 2.3).
Use `requirements.lock.txt` for the exact verified set.

## 4. Windows MAX_PATH (long path) install failure

**Symptom**:
```
ERROR: Could not install packages due to an OSError: [Errno 2] No such file or
directory: '...\\site-packages\\nose2\\tests\\functional\\support\\scenario\\...'
HINT: ... enable Windows Long Path support ...
```
**Cause** — packages with deeply nested files (e.g. `nose2`) exceed the Windows
260-character path limit when the venv lives under a long directory.
**Fix** — create the venv at a short path (e.g. `C:\qv`), or enable long paths:
`Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' LongPathsEnabled 1`
(admin; then restart), or use WSL/Linux.

## 5. MSYS2 / UCRT Python — no matching wheels (Rust build errors)

**Symptom** (installing the backend on the MSYS2/UCRT `python.exe`):
```
Python reports SOABI: cpython-310
Unsupported platform: 310
Rust not found, installing into a temporary directory
ERROR: Failed to build 'rpds-py' ...
```
**Cause** — MSYS2/UCRT Python is not a standard CPython, so PyPI ships **no
matching wheels**. Native packages (`rpds-py` via `jsonschema`, `lxml`,
`cryptography`, `cffi`) then build from source and need toolchains (Rust,
libxml2) that aren't installed.
**Fix** — use a **standard CPython** build from python.org (3.10 or 3.11), not the
MSYS2 interpreter. (Installing Rust + libxml2 to force source builds is not
recommended.)

## 6. MongoDB connection failures (live app)

**Symptom** — `ServerSelectionTimeoutError` / connection refused to
`localhost:27017` when running the live app (not the tests).
**Cause** — the live app needs a real MongoDB; the test suite does not (it uses
in-memory mongomock).
**Fix** — start MongoDB (e.g. a local `mongo:4.4` container) before serving
(`python -m uvicorn project:connexionapp ...`). Check
`backend/project/config.ini` for host/port/db settings.

## 7. Missing Node / npm / Yarn (frontend)

**Symptom**:
```
node : The term 'node' is not recognized ...
npm  : NOT FOUND
yarn : NOT FOUND
```
**Cause** — this error appears only when no Node.js toolchain is installed. The
frontend itself is **verified** (see below); this entry remains for anyone who
hits the missing-toolchain error.

**Verified toolchain** (Windows): **Node v14.21.3**, **npm 6.14.18**,
**Yarn 1.22.22**. From `frontend/`, `yarn install`, `yarn build`, and `yarn test`
all **passed** (jest: 2 suites, 7 tests passed). The committed `yarn.lock`
(lockfile **v1**; no `package-lock.json`) installed **with no changes**, so it is
reproducible as-is. `package.json` has no `engines` field; match the Dockerfile's
`node:14.5-alpine3.12` (i.e. Node 14).

**Reproducible path once Node 14 + Yarn are available**:
```bash
cd frontend
yarn install          # uses the committed yarn.lock (reproducible)
yarn build            # next build  (production)
yarn dev              # http://localhost:3000 (development)
yarn test             # jest
```
**Caveats**
- Use **Node 14** to match the Dockerfile. **Node 18/20 will likely fail to build
  Next.js 9.4** — bumping Node requires upgrading Next first (see roadmap).
- Prefer `yarn install` (honors `yarn.lock`) over a fresh `npm install`, which
  can hit the Material-UI peer-dependency conflict in §8.

## 8. Frontend dependency conflicts (Material-UI mix)

**Symptom** — `npm install` peer-dependency errors around `@material-ui/*`.
**Cause** — `package.json` mixes `@material-ui/core@5.0.0-alpha` with
`@material-ui/icons@4` and `@material-ui/lab@4-alpha` (inconsistent generation).
**Fix (baseline)** — left unchanged (a clean fix is the MUI v5 `@mui/*`
migration, which is architectural). As a stopgap, `yarn install` (which respects
`yarn.lock`) is more likely to succeed than a fresh `npm install`; or use
`npm install --legacy-peer-deps`.

## 9. Docker / `docker compose up`

**Verified environment:** Docker **29.6.1**, Docker Compose **v5.1.4**, context
`desktop-linux` (Docker Desktop / WSL2). `docker run --rm hello-world` passes.

> **Current status: ✅ the default stack builds and runs with DB-backed runtime**
> (backend + `mongodb` + gui + nginx; `/api/*` reads/writes Mongo). The history
> below is kept for reference: "before repairs" → "build repairs" → "DB runtime".

**Tested results (before repairs):**

| Step | Result |
| --- | --- |
| `docker compose config` (default) | ✅ passes (services: `gui`, `backend`, `nginx`; warns `version` is obsolete) |
| `docker compose -f docker-compose.yml.services config` | ✅ passes (services: `mongodb`, `web`, `nginx`) — but see legacy note below |
| `docker compose build backend` | ✅ passes → `qresp-backend:latest` (on `python:3.6-alpine`; installs `requirements.txt`, **not** `requirements.lock.txt`, so versions differ from the verified 3.11 baseline) |
| `docker compose build gui` | ❌ fails at `RUN yarn global add pm2` — `pidusage@4.0.1: engine "node" incompatible … Expected ">=18". Got "14.5.0"` (unpinned pm2 pulls a Node ≥18 transitive dep on a Node 14 base) |
| `docker compose build nginx` | ❌ fails at `COPY localhost.crt /etc/certs` — `/localhost.crt: not found` (and `localhost.key`); TLS certs absent from the repo |
| `docker compose -f docker-compose.dev.yml config` | ❌ fails YAML parsing — duplicate `environment` key in the `backend` service (lines ~23 & ~28) |
| full `docker compose up --build` | ⛔ blocked by the `gui` + `nginx` build failures above |

> **`docker-compose.yml.services` is legacy.** It builds from `./web` (a directory
> that no longer exists — the repo split into `backend/` + `frontend/`) and uses
> the removed `mongod --smallfiles` flag. `config` passes (it doesn't check build
> contexts) but it will not build. Treat it as historical reference / future work,
> not a working stack. It does, however, contain the `mongodb` service the default
> compose lacks.

**Blockers, classified:**

| # | Class | Detail |
| --- | --- | --- |
| 1 | obsolete base image | `backend/Dockerfile*` use `FROM python:3.6-alpine` (EOL). |
| 2 | dependency build failure | The pinned backend deps need **Python ≥3.7** (e.g. `cryptography==49` + Rust); they will not build on the 3.6 image. |
| 3 | MongoDB service missing | `docker-compose.yml` (prod) has **no `db` service** — assumes an external MongoDB. |
| 4 | hard-coded host path | `docker-compose.dev.yml` references `~/Repositories/MongoDB/.env`, `.../init-mongo.js`, `.../QrespData` — absent on a clean checkout; `up` fails on the missing `env_file`. |
| 5 | missing build-context files | `nginx/Dockerfile` COPYs `localhost.crt`/`localhost.key`; `nginx/Dockerfile.dev` COPYs `nginx.crt`/`nginx.key` — **none exist** in `nginx/` (only `default.conf`, `family_recipes.conf`, `nginx.conf`). Both nginx images fail to build. |
| 6 | EOL service image | `mongo:3.6.18-xenial` is EOL. |
| 7 | obsolete compose schema | `docker-compose.yml` uses `version: "2"` (the `version` key is deprecated under the Compose v2 CLI). |
| 8 | Windows/WSL path issue | The `~/Repositories/MongoDB/...` `env_file`/bind mounts also break under Docker Desktop on Windows (home/path translation). |

**Minimal repairs applied** (Docker-only; no app/dependency migration):
- **Frontend (gui):** base `node:14.5-alpine3.12` → `node:14.21.3-alpine`; pin
  `pm2@5.4.3` (was unpinned → pulled `pidusage@4` needing Node ≥18). App deps
  unchanged. → `docker compose build gui` now **passes** (`next build` OK).
- **nginx certs:** added `nginx/generate-local-certs.sh` to create **git-ignored**
  self-signed dev certs (no keys committed). Run it before building nginx:
  ```bash
  sh nginx/generate-local-certs.sh
  ```
- **nginx cert-name mismatch (runtime):** the prod `nginx/Dockerfile` copied
  `localhost.*` but `default.conf` requires `/etc/certs/nginx.crt` → nginx
  crash-looped (`[emerg] cannot load certificate "/etc/certs/nginx.crt"`).
  Aligned the Dockerfile to copy `nginx.crt`/`nginx.key`. → nginx now **stays up**.
- **dev compose:** merged the duplicate `environment` key in `backend`
  → `docker compose -f docker-compose.dev.yml config --services` now parses.

**After build repairs:** `docker compose up --build` brings up all three
services; `http://localhost`→301, `https://localhost/`→200, `/api/*` reaches the
backend.

### Now resolved — DB-backed runtime (branch `fix/docker-db-runtime`)
The remaining blockers above were then fixed; **the full stack now runs with
MongoDB** (details in `modernization_report.md` §14):
- Added a `mongodb` service (`mongo:4.4`) + named volume `qresp_mongo_data` to the
  default compose; backend connects via `QRESP_MONGODB_HOST=mongodb` (env override
  added to `project/config.py`).
- Backend base `python:3.6-alpine` → `python:3.11-slim`, installing
  `requirements.lock.txt` (Docker now matches the verified local baseline).
- Dev compose host paths replaced with a named volume; dev backend wired to `db`.
- Verified: `/api/search` returns `200 []` on an empty DB and returns an inserted
  paper after a DAO insert; `/api/collections` → `["MICCOM"]`.

### Gotcha — running `nose2` inside Docker
If you run `docker compose run backend python -m nose2` while
`QRESP_MONGODB_HOST` is set, the boot-time MongoEngine connection conflicts with
the tests' in-memory `mongomock://` setup and **all 17 tests error**. Clear the
env for the test run (app runtime is unaffected):
```bash
docker compose run --rm --no-deps \
  -e QRESP_MONGODB_HOST= -e QRESP_MONGODB_PORT= -e QRESP_MONGODB_DB_NAME= \
  backend python -m nose2          # -> Ran 17 tests ... OK
```

### Still deferred (not blocking local Docker runtime)
- The dev Mongo runs **without auth** (dev only); production must enable auth.
- `mongo:4.4` is paired with the pinned `pymongo 3.13`; move to `mongo:6.0` only
  with the PyMongo 4 / MongoEngine migration (modernization report §12).
- TLS certs are still self-signed/local (git-ignored); production needs real ones.
