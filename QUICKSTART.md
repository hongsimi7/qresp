# Qresp Quickstart & Handoff Guide

This guide gets a new user to a **running, verified baseline** as fast as
possible. It is written for handoff: this was a short (two-month) effort and the
project may go unmaintained for a while, so the goal is a **stable, reproducible
baseline**, not the newest framework versions.

> **Why we stabilize instead of upgrading to latest.** The backend code is
> coupled to a specific generation of its stack (it imports
> `wtforms.fields.html5`, `connexion.jsonifier`, and the `mongomock://` URI that
> newer majors removed). Jumping to Flask 3 / connexion 3 / WTForms 3 / newer
> MongoEngine would require source rewrites and risks breaking a working app with
> no one to fix it. Instead we **pin** the known-good versions so a future user
> can reproduce a working Qresp from a clean checkout. The migration paths are
> documented (not performed) in [`modernization_report.md`](modernization_report.md).

---

## A. Current stable baseline

| Item | Status |
| --- | --- |
| **Backend Python** | **Verified on CPython 3.11.5** (win_amd64). Use standard CPython **3.10–3.11**. |
| **Backend deps** | **Pinned** (`backend/requirements.txt`) + **locked** (`backend/requirements.lock.txt`). Install / `pip check` / import / boot / tests all **verified green**. |
| **Backend tests** | **29 tests pass** via `nose2` using **mongomock** — no real MongoDB needed. |
| **MongoDB (tests)** | **Not required** (in-memory mongomock). |
| **MongoDB (real runs)** | Required for the live app. Compose defaults to `mongo:4.4` (prod + dev); `mongo:6.0` verified on a fresh volume — see FULL_STACK_MODERNIZATION_REPORT.md. |
| **Node / npm / Yarn** | **Not verified** — no Node toolchain was available. Current frontend is Next.js 9 (needs Node ~14); target Node 20 LTS only after the frontend upgrade. |
| **Frontend** | **Unverified**; manifests left unchanged (upgrades are architectural). |
| **Docker** | **Works** — `python:3.14-slim` images, verified build + DB-backed runtime 2026-07-02 (see FULL_STACK_MODERNIZATION_REPORT.md). |
| **Curation assistant prototype** | **Verified green** (130 tests) on Python 3.11; standalone. |

### Exact commands that were verified (CPython 3.11.5, clean venv)
```bash
# backend
pip install -r backend/requirements.txt          # exit 0
python -m pip check                                # "No broken requirements found."
python -c "import project; print(project.app.test_client().get('/').status_code)"  # 200
python -m nose2                                    # Ran 29 tests ... OK

# prototype
pip install -e "prototypes/curation_assistant[pdf,schema,test]"
python -m pytest prototypes/curation_assistant     # 130 passed
```

### Known unverified items
- Frontend `yarn install` / `yarn build` / `yarn test` (no Node toolchain present).
- Docker / `docker compose up` (Docker not installed; known blockers documented).
- Real MongoDB-backed flows (publish, search, paper details).
- Python versions other than 3.11 (3.10 expected to work; 3.6/3.7 are EOL).

---

## B. Run the backend locally

```bash
cd backend

# 1. clean environment (use standard CPython 3.10 or 3.11)
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate

# 2. install dependencies
pip install -r requirements.txt      # human-maintained, pinned
# or, for an exact reproducible set:
# pip install -r requirements.lock.txt

# 3. sanity check
python -m pip check

# 4. boot smoke test (no MongoDB needed for GET /)
python -c "import project; print(project.app.test_client().get('/').status_code)"   # -> 200

# 5. run the test suite (uses in-memory mongomock; no MongoDB needed)
python -m nose2 -v                   # -> Ran 29 tests ... OK
```

**Running the live app** (needs a real MongoDB):
```bash
# start MongoDB yourself (e.g. a local mongo:4.4 container), then:
python -m uvicorn project:connexionapp --host 0.0.0.0 --port 5000 --reload
# production-style: gunicorn -k uvicorn_worker.UvicornWorker -w 4 -b :5000 project:connexionapp
# (Connexion 3 is ASGI -- `flask run` / serving bare `project:app` would bypass
#  the API validation & swagger-ui middleware.)
```
Connection settings live in `backend/project/config.ini` / `config.py`.

---

## C. Run the curation assistant prototype

Standalone, deterministic, fully tested. See
[`prototypes/curation_assistant/README.md`](prototypes/curation_assistant/README.md).

```bash
cd prototypes/curation_assistant

# install (Python 3.11 recommended)
python -m pip install -e ".[pdf,schema,test]"

# tests
python -m pytest                     # -> 130 passed

# demo run on the bundled fixtures
python -m qresp_curate.cli analyze \
    --paper tests/fixtures/sample_paper.pdf \
    --research tests/fixtures/sample_research \
    --output demo_output \
    --llm none
```

**Expected output files** (in `demo_output/`):
- `aligned_file_structure.json`
- `paper_figures.json`
- `candidate_workflow_chains.json`
- `qresp_metadata_draft.json`
- `analysis_summary.md` (human-readable rollup)

---

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for known issues and
[`modernization_report.md`](modernization_report.md) for the full dependency
audit, verification results, and the future migration roadmap.
