# Full-Stack Modernization Report

Branch: `chore/full-stack-modernization` · Completed: **2026-07-02** · Local-only (no deploy)

Companion docs: [FULL_STACK_MODERNIZATION_CHECKLIST.md](FULL_STACK_MODERNIZATION_CHECKLIST.md)
(plan + audit), [modernization_report.md](modernization_report.md) (earlier
dev-environment baseline this phase builds on).

Scope: lift backend dependencies to the latest **compatible and verified**
versions, keep the app runnable/testable, change no behavior/schema/UI/auth.
Everything below is separated into **upgraded**, **verified-unchanged**, and
**blocked**.

## 1. Summary

| Component | Before | After | Status |
| --- | --- | --- | --- |
| WTForms | 2.3.3 | **3.2.2** | Upgraded + verified (1 import fix) |
| Flask-WTF | 0.15.1 (`<1.0` pin) | **1.3.0** | Upgraded + verified (pin dropped) |
| MongoEngine | 0.26.0 | **0.29.3** | Upgraded + verified (test connect fix) |
| PyMongo | 3.13.0 | **4.17.0** | Upgraded + verified |
| Flask / Werkzeug | 2.2.5 / 2.2.3 | unchanged (capped `<2.3`) | Verified-unchanged — blocked (§4) |
| Connexion | 2.14.2 | unchanged (capped `<3.0`) | Verified-unchanged — blocked (§4) |
| MongoDB (Docker) | mongo:4.4 | default unchanged; **mongo:6.0 verified** | See §5 |
| Frontend (Next 9 / React 16) | — | unchanged | Blocked: Node 14 toolchain (§6) |

Code changes required by the upgrades (already in commit `b57a8ea`):
- `backend/project/views.py` — `wtforms.fields.html5` → `wtforms.fields` (WTForms 3 moved the HTML5 fields).
- `backend/project/tests/test_paperDAO.py` — mongomock connected via
  `mongoengine.connect(..., mongo_client_class=mongomock.MongoClient)` (the
  `mongomock://` URI was removed in MongoEngine ≥ 0.27).
- `backend/requirements.txt` / `backend/setup.py` — pins lifted accordingly.

This session (2026-07-02) completed the interrupted tail of that work:
regenerated `backend/requirements.lock.txt` from a clean venv, rebuilt the
backend Docker image from the new lock, re-ran the DB-backed smoke, verified
mongo:6.0, and wrote this report.

## 2. Verification matrix (all on 2026-07-02)

**Local venv — clean CPython 3.11.5 (win_amd64), fresh `python -m venv`:**

| Check | Result |
| --- | --- |
| `pip install -r backend/requirements.txt` | OK (WTForms 3.2.2, Flask-WTF 1.3.0, mongoengine 0.29.3, pymongo 4.17.0) |
| `python -m pip check` | No broken requirements |
| `import project` + test client `GET /` | **200** |
| `python -m nose2` (mongomock) | **17 tests, OK** |

**Docker — Docker Desktop 29.6.1, Compose v5.1.4, local daemon only:**

| Check | Result |
| --- | --- |
| `docker compose build backend` (installs new `requirements.lock.txt`) | Image builds OK |
| `docker compose up -d mongodb backend` (mongo:4.4) | Both up |
| In-container `GET /` and `GET /api/search` via gunicorn :5000 | **200 / 200** |
| In-container DAO round-trip vs real mongod 4.4 (insert sample paper → search by tag) | Insert returned id; search read it back |
| In-container `python -m nose2` (QRESP_ env unset → mongomock) | **17 tests, OK** |
| Same smoke vs **mongo:6.0.28** (fresh throwaway volume, compose override) | All pass: 200/200, insert→read OK |

The gui/nginx images were not rebuilt: they are untouched by this phase, and the
full 4-service `up --build` (https → 200) was already verified on 2026-06-30
(commit `79872fc`) with identical Dockerfiles.

## 3. Upgraded (verified)

- **WTForms 3.2.2** — only consumer was `views.py`'s HTML5 field import; fixed.
  Form behavior otherwise API-compatible for this codebase.
- **Flask-WTF 1.3.0** — not imported anywhere in the code; the old `<1.0` pin
  existed only because Flask-WTF ≥ 1.0 requires WTForms ≥ 3. Both now modern.
- **MongoEngine 0.29.3** — app code unchanged; only the test harness needed the
  new mongomock connection API.
- **PyMongo 4.17.0** — no direct `pymongo` API usage in the app beyond what
  MongoEngine wraps; verified against real mongod 4.4 and 6.0 (insert + query).

`backend/requirements.lock.txt` is regenerated from the clean venv and is the
exact set the Docker image installs. Incidental floats picked up in the
regeneration: coverage 7.14.3→7.15.0, rpds-py 2026.5.1→2026.6.3,
typing_extensions 4.15.0→4.16.0 (all dev/transitive; covered by the test runs).

## 4. Verified-unchanged — hard blockers (do not bump blindly)

- **Flask < 2.3 / Werkzeug < 2.3** (at 2.2.5 / 2.2.3):
  - Connexion 2.14 declares `flask<2.3`.
  - `flask-mongoengine` 1.0 (unmaintained) breaks on Flask ≥ 2.3 (removed
    `flask.json.JSONEncoder` APIs).
- **Connexion < 3.0** (at 2.14.2): Connexion 3 is an ASGI rewrite — the app
  uses `connexion.FlaskApp`, `add_api(swagger.yml)` and
  `from connexion import request, jsonifier`; `jsonifier` is gone in 3.x and the
  App/middleware model is different. This is a migration project, not a pin bump.

Escape path (future phase): replace flask-mongoengine with direct
`mongoengine.connect()` at app init, then migrate Connexion 2 → 3 (or drop
Connexion for plain Flask blueprints + spec validation), then Flask 3.

## 5. MongoDB server: 4.4 default kept, 6.0 verified

- mongo:6.0.28 runs this backend cleanly (PyMongo 4.17 wire-compatible; smoke
  in §2). Compose default stays **mongo:4.4** on purpose:
  - the existing `qresp_mongo_data` volume holds 4.4-format data files — mongod
    6.0 will refuse to start on them directly;
  - upgrade path for real data is stepped binary+FCV bumps (4.4 → 5.0 → 6.0)
    or `mongodump`/`mongorestore` into a fresh 6.0 volume;
  - mongo ≥ 5.0 requires an AVX-capable CPU on the Docker host.
- A comment in `docker-compose.yml` records this; flip the image tag only
  together with a planned data migration on the target host.

## 6. Blocked: frontend (documented, no changes)

Toolchain on this machine is Node **14.21.3** / Yarn 1.22.22; modern Next needs
Node ≥ 18.17, so a modernized frontend cannot be installed, built, or verified
here — and unverifiable dependency changes are out of policy for this branch.

Staged plan when Node 20 LTS is available: Next 9 → 14 (codemods, app or pages
router decision), React 16 → 18, the mixed `@material-ui` v4/v5-alpha packages →
`@mui/material` v5, enzyme (dead, no React 17/18 adapter) → React Testing
Library. Current frontend still builds and runs on Node 14 (verified 2026-06-29,
commit `ffe4026`).

## 7. Readiness for the Account/User + Google-login phase

The backend baseline is ready:
- Forms layer on current WTForms 3 / Flask-WTF 1 — the versions any new
  auth/account forms should be written against.
- `requests_oauthlib` installed and current (2.0.0) for the Google OAuth flow.
- Storage layer on MongoEngine 0.29 / PyMongo 4 — new `User` documents get the
  modern API from day one.
- Known debt to carry into that phase: Flask 2.2 is EOL upstream (blocked, §4);
  plan the flask-mongoengine removal early if the auth work grows.

## 8. Reproduce

```bash
# backend, clean CPython 3.11 venv (use a SHORT venv path on Windows: MAX_PATH)
pip install -r backend/requirements.lock.txt   # or requirements.txt for loose
python -m pip check
cd backend && python -c "import project; print(project.app.test_client().get('/').status_code)"
python -m nose2                                 # 17 tests, mongomock

# docker (local daemon)
docker compose build backend
docker compose up -d mongodb backend
docker compose exec backend python -c "import urllib.request as u; print(u.urlopen('http://localhost:5000/api/search').status)"
docker compose down                             # never `down -v`: keeps qresp_mongo_data
```

Regenerate the lock after editing `requirements.txt` (clean venv):
`pip freeze | grep -v "^pip==" > requirements.lock.txt`, then re-run the whole
matrix in §2 before committing.
