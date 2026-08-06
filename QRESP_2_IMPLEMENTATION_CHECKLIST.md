# Qresp 2.0 Implementation Checklist

Baseline: **`chore/frontend-modernization` @ `f226f78`** (backend Flask 3/Connexion 3/py3.14 +
frontend Next 16/React 19/MUI 9, all verified locally + staging: `PAPERSTACK_STAGING_NOTES.md`).
Direction change 2026-07-03: curation-assistant/AI-workflow-automation work is **paused**;
`prototypes/` and the validation-sample branches stay untouched and unmerged.

Direction change 2026-08-03 (supervisor): **AI is limited to RCC candidate descriptions.**

| Area | Source of values | AI |
| --- | --- | --- |
| Publication metadata | Manual entry + Crossref via DOI Fetch | **None, by design** |
| Qresp keywords | Curator entry, plus optional Gemini suggestion from the record's OWN metadata | Optional, consent-gated |
| RCC artifacts | Deterministic Folder Standard v1 discovery | Optional Gemini description enrichment |

Bibliography is factual data with an authoritative registry, so it is not a
task for a language model: a fluent wrong journal name or year is worse than
a blank field a curator fills in. Keywords are a curator judgement about their
own work. Both AI endpoints were removed accordingly, along with the
manuscript upload that fed them. RCC candidate descriptions are the one place
a model is asked anything, and even there no output is auto-applied,
auto-saved or auto-published.

## Goals → why / MVP / defer

### 1. Dependency + code modernization — ✅ essentially done
- Why: EOL stack (Flask 2.2/Next 9/Node 14) blocked all new work.
- Done: waves 1–3 (commits `59e874e`…`f226f78`); local venv + Docker + nose2 29 / RTL 5 tests green; staging run verified.
- [ ] Remaining: none blocking. Deferred: prod MongoDB 4.4→6.0 migration (ops task, report §6).

### 2. UI/UX regression repair (no redesign)
- Why: ~90 frontend files migrated (JSS→emotion, RHF 6→7, Link/lightbox/vis rewrites) with only 5 unit tests — visual/behavioral drift is likely and unquantified.
- MVP: click-through matrix on staging (pages below), fix what's broken, keep existing layout/behavior; document anything not restorable in `FULL_STACK_MODERNIZATION_REPORT.md` §8.
- Defer: theming polish, accessibility overhaul, e2e suite (add 1 Playwright smoke only if cheap).

### 3. Google authentication (identity ONLY)
- Why: ownership (goal 4) needs a verified identity; passwords are out of scope by design.
- Build on: legacy Google OAuth already half-exists (`routes.py:616` GoogleAuth, config keys `GOOGLE_CLIENT_ID`/`REDIRECT_URI`/`GOOGLE_API.*`, `requests_oauthlib` installed, Flask-Session sessions).
- MVP: OAuth 2.0 code flow (scopes: `openid email profile` — **no Drive/Gmail**) → server-side session cookie; endpoints `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/auth/me`; frontend: login/logout in header + an AuthContext consuming `/api/auth/me`.
- Defer: roles UI, account page, token refresh, linking multiple emails.
- Guardrails: client id/secret via `config.ini`/`QRESP_*` env only — **never committed**; `OAUTHLIB_INSECURE_TRANSPORT` dev-only.

### 4. Ownership + edit/delete permission system — ✅ MVP done (2026-07-08)
- Why: submitters cannot fix or retract published records today (top user request; `REVISION_DESIGN.md` analyzed this pre-auth — Google identity now supersedes its email-token scheme, keep its threat model + soft-delete stance).
- Ownership anchor: verified session email stamped as `Paper.owner_email` at publish (distinct from curator-declared `info.insertedBy.emailId`). Admin = `QRESP_ADMIN_EMAILS` allowlist.
- Done — edit: `GET /api/paper/{id}/raw` + `PUT /api/paper/{id}` (owner/admin, existing validation path); paperdetails permission notice + "Edit in Curator" (curator edit mode).
- Done — soft-deactivate: `Paper.is_active` (absent ⇒ active, legacy-safe) + `PUT /api/paper/{id}/active` (owner/admin, atomic write, **no hard delete**); deactivated records hidden from search/explorer/filter dropdowns and 404 on the public detail for non-owners; owner/admin retain access + Deactivate/Reactivate controls with confirmation; account list flags deactivated.
- Done — account server drafts: `CuratorDraft` + `GET/POST /api/account/drafts`, `GET/PUT/DELETE /api/account/drafts/{id}` (owner-scoped, never publish-validated so incomplete drafts save; cross-user ⇒ 404). Curator "Save Draft", `?draft=<id>` resume, active-draft tracking, three-button Start-From-Scratch, nav guard; `/account` My drafts with Resume/Rename/Delete (confirmed) + multiple drafts; local browser copy kept only as recovery.
- Done — admin ownerless management: `/account` admin-only section over `GET /api/admin/ownerless-papers` + `PUT /api/paper/{id}/owner`.
- Done — editor role + audit (2026-07-09): legacy-safe `Paper.editor_emails` (edit-only: no deactivation/owner/editor management — `auth.can_manage_paper` vs broadened `can_edit_paper`; `paper_role` = admin/owner/editor/none, exposed in `/permissions` with `can_manage`); `PUT /api/paper/{id}/editors` (owner/admin, normalized+validated emails); owner reassignment semantics tested (old owner loses edit unless kept as editor); minimal audit on every mutation (`updated_at`, `updated_by_email`, `edit_history` {email, action, timestamp} for edit/assign_owner/update_editors/deactivate/reactivate, unforgeable via payload); `/account` shows editor records with role chip + owner Editors dialog; edit-mode unsaved-changes guard (Leave Without Saving / Stay, flusher-aware, no draft saving in edit mode).
- Done — publish/verify hardening: idempotent verify links (re-click lands on the paper, no duplicate), specific verify error messages, staging skip-email vs SMTP paths, publish success offers to delete the source account draft (only after the user verifies).
- Defer: revision history, ownership transfer, re-publish workflow, hard deletion.

### 4b. Curation assistant — scope reduced by supervisor (2026-08-03)
- **Kept:** DOI lookup (`POST /api/import/doi`, Crossref, mocked-network
  tests). Publication Information is manual entry plus DOI Fetch: the registry
  fills kind, title, authors, journal, volume, page, year, abstract and URL,
  and a value Crossref does not return is left blank for the curator to type.
  When the registry supplies no URL, `https://doi.org/<normalized-doi>` is
  computed from the DOI.
- **Removed:** manuscript-source upload (`POST /api/import/manuscript`, .pdf /
  .tex / Overleaf .zip, with its parsers, review dialog and `pypdf`
  dependency) and AI proposal of publication metadata
  (`POST /api/assist/publication-metadata`). `MANUSCRIPT_IMPORT.md` was
  deleted with the feature it documented.
- **Keyword AI restored 2026-08-03, without the manuscript:**
  `POST /api/assist/keywords` reads only the record's own metadata -- the
  bibliographic fields, and the caption/properties/description/keywords/
  packageName/facility/measurement of artifacts already accepted into the
  record. No file, path, RCC URL, unclassified file, unaccepted candidate or
  account detail is accepted. One provider call per request, the existing
  quota, and suggestions ranked against the site's existing keyword
  vocabulary and labelled "Existing Qresp keyword" or "New suggestion".
- **Why:** publication metadata is factual data with an authoritative
  registry, and Qresp keywords are a curator judgement. Neither is a task for
  a language model, and neither needs a manuscript upload.
- Validation was restored with the scope: every field the form marks with an
  asterisk (Kind, Authors, Title, Journal Name, Page, Abstract, Volume, Year)
  is required again for every kind; DOI and URL stay optional in the form.

### 4c. RCC folder analysis — ✅ done (2026-07-27)
- `POST /api/curation/analyze-folder` (authenticated, CSRF-protected,
  read-only) inventories the file-server folder the curator already saved and
  proposes Charts/Datasets/Scripts/Tools candidates; the review dialog in
  "Where is the paper" applies selected, edited candidates to Curator state
  only — never a save or publish. Host/root allowlist with traversal and
  scheme/credential/query rejection, bounded crawl with explicit truncation,
  TLS verified by default plus an environment-only, default-off, per-host
  opt-in for the expired RCC certificate. Tools come only from pinned
  manifests; Python imports are a hint; no Experiment is ever inferred.
  Optional consented Gemini descriptions reuse the existing provider config
  and quota. Docs: `RCC_FOLDER_ANALYSIS.md`. Out of scope: Zenodo folders,
  file sizes/mtimes, notebook content parsing.

### 5. Agentic literature explorer — 🧪 Related Literature Explorer prototype implemented; domain relevance QA pending
- `GET /api/paper/{id}/related` (public, read-only) plus a **Related Research**
  section at the bottom of Paper Details, split into **Related Qresp Records**
  and **Related External Papers**, five each, never padded, every result
  carrying up to three grounded "Why related" reasons.
- **No LLM.** Not agentic in the AI sense: candidates come from the free
  Semantic Scholar Recommendations API, and every threshold, ordering and
  reason sentence is computed deterministically by Qresp from the two records'
  own published scientific metadata (`project/relatedness.py`, pure and
  unit-tested). Specificity is measured against this server's own corpus, so
  no vocabulary, material or method is hardcoded.
- Quality gate: one STRONG, or two MEDIUM from independent families. Same
  journal, adjacent years, one broad field, generic words, and the provider's
  own ranking are never evidence.
- Off by default (`QRESP_RELATED_RESEARCH_ENABLED`); external results cached
  outside the Paper document (`RelatedResearchCache`, 7-day TTL, stale
  fallback); internal results recomputed per request so publish/deactivate are
  instant. A provider timeout/404/429/malformed answer degrades the external
  section only. Own nginx rate-limit zone (`api_related`).
- Docs: `RELATED_RESEARCH.md`, including the 10–20 record
  관련 있음 / 부분 관련 / 관련 없음 QA table.
- **Pending:** domain-expert relevance QA on real records; thresholds are
  reasoned starting values, not yet validated by a physicist. Out of scope:
  citations *to* this paper, cross-server federation, memoized corpus stats.

## Implementation order
1. **UI regression repair** (goal 2) — everything else demos on top of this.
2. **Google auth MVP** (goal 3) — thin, independent of UI polish.
3. **Ownership/edit/delete** (goal 4) — hard-depends on 3.
4. **Literature explorer** (goal 5) — least coupled; after 3 so it can be rate-limited/gated per user.
(Goal 1 is done; do not reopen except as regressions surface.)

## Likely files/modules to change
- Backend boot/session: `backend/project/__init__.py`, `config.py` (+`config.ini` keys, not committed).
- Routes/API: `backend/project/swagger.yml` + `api.py` (new auth/edit/related endpoints), `routes.py` (legacy GoogleAuth cleanup), `paperdao.py` (update/deactivate DAO), `models.py` (only if an owner field beyond `insertedBy` is needed), `controllers/publish.py` (stamp owner on publish).
- Tests: `backend/project/tests/test_api_endpoints.py` (+auth/permission tests with a fake session).
- Frontend: `pages/_app.js` (AuthProvider), `components/header.js` (login button — a commented-out LogIn button already exists), new `Context/Auth/*`, `pages/paperdetails/[id].js` (owner buttons + Related section), `Context/axios.js` (send credentials), `pages/curator.js` (edit-mode prefill).

## Frontend pages/components most at risk of modernization regressions
- `/qrespcurator` (curator): 13 RHF-v7-rewired forms, field arrays, file-tree dialog (react-checkbox-tree 2), TopActions upload/download dialogs.
- `/paperdetails/[id]`: chart **lightbox** (library replaced), vis-network 10 **workflow graph**, tables/pagination, styled-jsx link colors.
- `/search` + explorer: MUI Autocomplete (lab→core), table sort/filter/fade animation (nodeRef rewrite), Pagination.
- Shell: header responsive menu (Hidden→sx), drawer accordions (slotProps.transition), Snackbar/Alert, sitemap-driven nav links, mobile breakpoints.
- Forms: Radio groups (register rewiring), Select (Controller render), tooltips-on-focus behavior.

## Highest-risk items
1. Curator form data integrity under RHF 7 (register rewiring + defaultValue capture) — a silent field-drop corrupts published metadata. Mitigate: staging round-trip test (fill → download JSON → diff against pre-modernization output).
2. Session cookies across nginx/CORS/ASGI (SameSite, secure, `withCredentials`) for auth — test through the real nginx proxy early.
3. Permission bypass: `PUT/DELETE` must be enforced server-side in the API layer (never trust UI hiding); Connexion security handler or explicit check in handlers.
4. Legacy `routes.py` server-rendered flows sharing the same session — don't break `/admin` passcode gate while adding user sessions.
5. External API/LLM quotas + latency in the explorer — cache and fail soft (page must render without it).

## Branch / commit structure
- Integration base: `chore/frontend-modernization` (current tip; do NOT branch from `feat/real-sample-validation` or other prototype branches).
- One branch per goal, merged back into the base in order:
  `fix/ui-regressions` → `feat/google-auth` → `feat/record-ownership` → `feat/literature-explorer`.
- Small commits per concern; every commit keeps `nose2` + `yarn build` + `yarn test` green; no secrets/keys ever committed (config.ini values or `QRESP_*` env only); no push until review.

## Pre-production blockers (auth/edit MVP — status 2026-07-04)
- [x] `OAUTHLIB_INSECURE_TRANSPORT` no longer hardcoded on — explicit
  `QRESP_OAUTHLIB_INSECURE_TRANSPORT` opt-in only (commit `chore(auth)` hardening).
- [x] CSRF: session-authenticated mutations (logout, publish, PUT paper) require
  the `X-CSRF-Token` issued by `/api/auth/me`; frontend attaches it to
  same-origin requests only. dev-login exempt (establishes the session; Google
  flow protected by OAuth state).
- [x] Google post-login open-redirect prevented (`next` restricted to same-origin paths).
- [ ] Google id_token signature/nonce verification (currently server-side userinfo fetch over HTTPS).
- [ ] Session cookie flags (Secure/HttpOnly/SameSite) verified through nginx on staging.
- [ ] Rate limiting/lockout on auth + publish endpoints.
- [ ] Ensure `QRESP_ENABLE_DEV_LOGIN` is unset in production config.
- [x] CILogon institutional login — **REMOVED 2026-07-27** before it was ever
      registered or verified. Microsoft Entra and Google are the two supported
      public providers. Code, routes, Swagger entries, setup guide and tests
      are gone; the shared OIDC/JWKS helper Microsoft uses was kept, and
      ExternalIdentity stays (Google + Microsoft use it). No migration was
      run: any legacy `provider: "cilogon"` rows simply sit unused. On
      staging, `QRESP_CILOGON_*` env vars and any CILogon-only `env_file`
      reference can be deleted by hand once this is deployed.
- [ ] Microsoft Entra sign-in (code complete 2026-07-13, `MICROSOFT_ENTRA_LOGIN_SETUP.md`):
      create the multitenant app registration ("Accounts in any
      organizational directory", Web redirect
      /api/auth/microsoft/callback), set `QRESP_MICROSOFT_*` env vars, and
      run the staging E2E QA — NOT yet verified against a real Entra tenant;
      some campuses may require tenant-admin consent.
- [ ] `verify=False` TLS skips in `util.py` registry/schema fetches (pre-existing).
- [ ] Staging QA pass per `STAGING_QA_CHECKLIST.md`.

## Smallest end-to-end demo of the new direction
Login with Google → publish (or open an owned record) → an **Edit** button appears only for the owner → edit a field, save, see it live → open the record's **Related** panel showing 2–3 external papers + 1 internal record with one-line explanations. (Runs on local docker compose; no Drive/Gmail scopes anywhere.)
