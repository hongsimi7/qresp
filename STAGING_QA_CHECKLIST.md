# Staging QA Checklist — auth/edit MVP (Qresp 2.0)

Target: **`qresp_staging` ONLY** (never `/home/sushant/qresp`, never the live
compose project). Access via the SSH tunnel: `https://localhost:8443`.
No secrets in this file or in compose files — inject everything via
environment variables on the staging backend container.

## Backend environment (staging only)

- [ ] `QRESP_ENABLE_DEV_LOGIN=1` (dev-login stays OFF everywhere it is unset)
- [ ] `QRESP_ADMIN_EMAILS=admin@example.com` (optional, comma-separated allowlist)
- [ ] `QRESP_GOOGLE_CLIENT_ID=...`
- [ ] `QRESP_GOOGLE_CLIENT_SECRET=...`
- [ ] `QRESP_GOOGLE_REDIRECT_URI=https://localhost:8443/api/auth/google/callback`
      (must match an authorized redirect URI on the Google OAuth client; use
      the public staging hostname instead if testing without the tunnel)
- [ ] `QRESP_PUBLISH_SKIP_EMAIL=1` (staging QA only: show the publish verify
      link in the browser instead of sending SMTP email; never in production)
- [ ] `QRESP_OAUTHLIB_INSECURE_TRANSPORT=1` **only if** the callback is served
      over plain HTTP (not needed for the HTTPS tunnel; never in production)
- [ ] Institutional login (after registering a staging client — see
      CILOGON_INSTITUTIONAL_LOGIN_SETUP.md): `QRESP_CILOGON_CLIENT_ID`,
      `QRESP_CILOGON_CLIENT_SECRET`, `QRESP_CILOGON_REDIRECT_URI`
      (= the registered staging callback, exactly)

## Microsoft Entra sign-in — pending app registration

- [ ] Env on staging backend (see MICROSOFT_ENTRA_LOGIN_SETUP.md):
      `QRESP_MICROSOFT_CLIENT_ID`, `QRESP_MICROSOFT_CLIENT_SECRET`,
      `QRESP_MICROSOFT_REDIRECT_URI`
      (= `https://localhost:8443/api/auth/microsoft/callback`, exactly as
      registered); optional `QRESP_MICROSOFT_TENANT` (default organizations)
- [ ] Unconfigured: "Sign in with Microsoft" → JSON 503; CILogon, Google and
      dev-login unaffected
- [ ] Configured: button → Microsoft account picker → work/school sign-in →
      returns to the ORIGINATING page; header shows the name; `/account`
      shows "Signed in with Microsoft"
- [ ] Publish → verify → edit → drafts → (allowlisted email) admin surfaces
      all work through the Microsoft session
- [ ] Sign out, then sign in again → the account PICKER appears
      (select_account), allowing a different Microsoft account
- [ ] Personal (consumer) Microsoft accounts are rejected by the
      organizations authority
- [ ] Campus requiring admin consent shows Entra's approval screen (expected;
      use CILogon for that campus until consent is granted)

## Institutional login (CILogon) — pending client registration

- [ ] Unconfigured: "Sign in with your institution" → JSON 503 "not
      configured"; Google + dev-login unaffected
- [ ] Configured: button → CILogon IdP selector → University of Chicago SSO
      → returns to the ORIGINATING page; header shows the name
- [ ] `/account` shows "Signed in with your institution (CILogon)"
- [ ] A second IdP (another campus, or CILogon's ORCID/GitHub options)
      creates a SEPARATE external identity (distinct issuer+subject)
- [ ] Publish → verify → edit → drafts → (allowlisted email) admin surfaces
      all work through the CILogon session
- [ ] `QRESP_ADMIN_EMAILS` matching the asserted institutional email grants
      the admin badge/surfaces
- [ ] Sign out ends only the Qresp session (campus SSO remains signed in)
- [ ] Legacy note: records owned by a DIFFERENT email (e.g. Gmail) are not
      visible to the institutional identity until an admin reassigns
      ownership or adds the new email as an editor (expected behavior)

## API smoke (curl -k through the tunnel)

- [ ] `curl -k https://localhost:8443/api/auth/me` → 200, `authenticated:false`, a `csrf_token`
- [ ] `curl -k https://localhost:8443/api/search` → 200 (unchanged)
- [ ] dev-login round trip:
      `curl -k -c c.txt -X POST https://localhost:8443/api/auth/dev-login -H "Content-Type: application/json" -d '{"email":"owner@example.com"}'` → 200
      then `curl -k -b c.txt https://localhost:8443/api/auth/me` → `authenticated:true`
- [ ] mutation without `X-CSRF-Token` while logged in → 403 (e.g. logout)

## Browser (https://localhost:8443)

- [ ] Home/header/footer render like https://paperstack.uchicago.edu (commit `4af350f` repairs)
- [ ] Mobile-width header drawer opens and shows nav + auth controls (manual)
- [ ] "Dev sign in" logs in; header shows name and Sign out
- [ ] "Sign in with Google" → consent → returns to the ORIGINATING page; header shows Google name
- [ ] paperdetails shows the permission notice (anonymous: "Sign in to edit …")
- [ ] Owner (or admin): "Edit metadata" visible → edit tags on a **staging/test record only** → saves and reloads with new tags
- [ ] Non-owner signed in: no edit button; direct `PUT /api/paper/{id}` with their cookie+token → 403
- [ ] Anonymous `PUT /api/paper/{id}` → 401
- [ ] `/api/ui/` swagger page loads

## Publish → verify → account round trip

- [ ] Signed in, publish a staging test record → success dialog says
      "Queued for verification…" with the verification link and an
      "Open verification link" button (QRESP_PUBLISH_SKIP_EMAIL=1 mode)
- [ ] Open the link → verify page succeeds through the tunnel
      (`https://localhost:8443/verify/PUBLISH_<id>?server=https://localhost:8443`
      — SSR reaches the backend via QRESP_INTERNAL_API_URL, not localhost)
- [ ] "Go to Paper" shows the new record; the permission notice says you can
      edit it (owner)
- [ ] Header name → `/account`: profile shows name/email/provider (+admin
      badge if allowlisted); the new record appears under "My published
      records" with working View / Edit in Curator links
- [ ] "Local recovery draft" lists an in-progress curator draft with
      Resume/Clear (start typing in /curator create mode first)

## Account server drafts (signed in)

- [ ] In `/curator` create mode, fill a few fields (even incomplete, no
      charts/datasets) → "Save Draft" → name it → success dialog
- [ ] `/account` → "My drafts" lists it with an "Updated …" time
- [ ] Save a second draft → both appear (multiple drafts supported)
- [ ] Resume a draft → `/curator?draft=<id>` reloads exactly that draft's state
- [ ] Edit and Save Draft again → the SAME draft updates (no duplicate in the list)
- [ ] "Rename" a draft → title updates in the list
- [ ] "Delete" a draft → confirmation dialog first → confirm removes it
- [ ] "Start from Scratch" with unsaved work → dialog offers Cancel /
      Save Draft and Start Fresh / Discard and Start Fresh (no duplicate
      Dismiss); "Discard" truly blanks the form
- [ ] Navigating away with unsaved changes prompts Save Draft and Leave /
      Leave Without Saving / Stay
- [ ] Publishing from a resumed draft → success dialog offers "Delete the
      saved draft"; the account draft is only removed when you click it
- [ ] Export/Import Metadata (Upload Metadata / Export Metadata) still work and
      are independent of account drafts
- [ ] Anonymous: "Save Draft" prompts to sign in (no server draft is created)

## Manuscript import (Auto-Curation Lite phase 1)

- [ ] Signed in, /curator → "Publication Information for This Paper" shows
      ONE canonical DOI field (with Fetch) plus the "Import Manuscript
      Source" card — no second DOI input anywhere (anonymous users see a
      sign-in hint; the GLOBAL toolbar has no import button);
      "Qresp Curation Information" holds ONLY PIs / PaperStack / Keywords /
      notebook and the gated "Suggest Keywords with AI" action
- [ ] Paste a real DOI → Fetch DOI → proposed fields with provenance (kind
      mapped from the registry); Apply fills only empty fields; a pre-filled
      title stays unless its checkbox is checked (both values shown); the
      values land in Publication Information (the record's reference block)
- [ ] A .tex without DOI proposes kind=Preprint chipped "suggested"
- [ ] The per-author "Add selected paper authors as Principal Investigators"
      picker starts all-unchecked; ticking one APPENDS that author to PIs
- [ ] Post-apply checklist marks PaperStack / notebook as "(manual)"

## AI keyword suggestions (Gemini) — pending provider configuration

Provider: Google Gemini, native `generateContent` REST with structured JSON
output. The API host
`https://generativelanguage.googleapis.com/v1beta/models` is fixed in code;
only the variables below are configurable, and only through the environment
(never config.ini). The retired `QRESP_KIMI_*` / `QRESP_QWEN_*` variables
have no effect.

**The credential is NOT the Google sign-in secret.** Create a separate
**Google AI Studio / Gemini API key** for this. `QRESP_GOOGLE_CLIENT_ID` and
`QRESP_GOOGLE_CLIENT_SECRET` (the OAuth login client) are never read by this
feature and must not be reused here — mixing them would hand a login
credential to a content API.

**Staging secret handling — do this, nothing looser:**

- Put the key in the EXISTING private, git-ignored backend env file on the
  staging host (the same mechanism the other `QRESP_*` secrets already use),
  then `chmod 600` it and keep it owned by the deploying user.
- **Do NOT add a second `env_file:` key to a compose service** — YAML keeps
  only the last duplicate key, which silently drops every previously
  referenced env file. Add the variables to the env file that service
  already references.
- Never put the key in `config.ini`, a committed compose file, a Dockerfile,
  a shell history line, or this checklist.
- Restart the backend container after editing the env file (bind-mounted
  code, so restart — not rebuild).

**Budget / rate-limit before enabling (paid API):**

- In Google AI Studio / Cloud console, put this key on its own project with
  a **hard billing budget alert at a small monthly cap** and, if available,
  a per-minute request quota — the key should be able to do nothing except
  cheap `generateContent` calls.
- Keep `QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY` low (start at 5–10 while
  testing) and leave `QRESP_GEMINI_MAX_OUTPUT_TOKENS` at 256. Qresp never
  retries a failed call, so one user action costs at most one provider call
  per manuscript chunk.
- Rotate/revoke the staging key when testing is finished.

Env template (placeholders only — never commit real values):

```ini
QRESP_GEMINI_ENABLED=1
QRESP_GEMINI_API_KEY=<paste-ai-studio-key-here>
QRESP_GEMINI_MODEL=gemini-3.6-flash
QRESP_GEMINI_TIMEOUT_SECONDS=15
QRESP_GEMINI_MAX_MANUSCRIPT_CHARS=60000
QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY=10
QRESP_GEMINI_MAX_OUTPUT_TOKENS=256
```

- [ ] Without a title/abstract the "Suggest Keywords with AI" button is
      DISABLED with the local "Add a title or abstract, fetch a DOI, or
      import a manuscript source" reason (no request is made); after typing
      a title it enables immediately (no section Save needed)
- [ ] Unconfigured: an ELIGIBLE click shows "not configured on this server";
      import-review AI fetch says the same; nothing else breaks
- [ ] **First configured test uses PUBLIC data only** — a published paper's
      title/abstract, never unpublished manuscript content — to confirm the
      round trip before any manuscript excerpt is ever sent
- [ ] Configured: metadata-only suggestions return ≤8 deduplicated keywords,
      all unchecked; Apply appends only the selected ones to Keywords
- [ ] The dialog names Gemini as the destination before anything is sent
- [ ] Manuscript import review (only after the public-data test passes):
      consent checkbox defaults OFF and the fetch button stays disabled
      until ticked; after fetching, "AI suggestions (Gemini)" appear as a
      separate unchecked group
- [ ] Per-user daily limit returns a clear message once exceeded (429)
- [ ] Upstream rate limiting (429) surfaces a generic "rate limited" message
      with no quota/project details

What the four distinct AI error messages mean (all safe to show a curator;
none of them ever contains model output, prompt, manuscript text, headers or
the key):

| Message | Meaning | Where to look |
| --- | --- | --- |
| "…could not be reached." / "…returned an error." / "…is rate limited…" | Upstream HTTP failure (network, non-200, 429) | Backend log line `AI assist provider …` with the HTTP status |
| "…declined this request. Try again with different text." | The provider blocked the prompt (`promptFeedback.blockReason`) or terminated the candidate on a safety/policy rule (`finishReason` SAFETY/BLOCKLIST/PROHIBITED_CONTENT/SPII/RECITATION) | `AI assist response: … finish=… block=…` |
| "…did not return suggestions." | A 200 with no usable answer: no candidate, or a candidate whose only parts were reasoning/thought parts (e.g. `finishReason=MAX_TOKENS` spent the budget before the answer) | Same line, `answer_part=False` |
| "…returned an unreadable answer." | Answer text existed but was not the agreed `{"keywords": [...]}` payload (prose, or a schema mismatch) | `AI assist response unparseable payload: …` |

- [ ] Suggestions still work when the model emits reasoning before the
      answer (thinking parts are skipped, not concatenated) — this was the
      staging "unreadable answer" failure
- [ ] Server logs show only sanitized diagnostics (status, candidate count,
      finish reason, block reason, whether an answer part existed) — never
      response text, prompt, or manuscript content
- [ ] Backend logs contain no API key, x-goog-api-key header, provider error
      body, block reason, prompt, or manuscript text after these runs
- [ ] Upload a .tex with \title/\author/abstract → proposals appear;
      Apply → forms show the values; missing-for-publish checklist lists
      charts/datasets/license etc.; Save Draft still works while incomplete
- [ ] Upload an Overleaf .zip (main + \input + .bib) → main file named,
      included files listed, bib DOIs shown as reference candidates only
- [ ] A zip with a traversal path / >200 files → clear error, nothing applied
- [ ] "Upload Metadata" (JSON) still works exactly as before

## Soft-deactivate published records (owner/admin)

Chosen design (documented): deactivated records are hidden from the PUBLIC
detail route for everyone, including the owner. Next SSR fetches
`/api/paper/{id}` server-side WITHOUT the browser session cookie, so an
owner's request is anonymous and correctly 404s. Therefore all owner/admin
management of deactivated records happens on `/account` (client-side,
authenticated), NOT on the public detail page. `is_active` is toggled only via
`PUT /api/paper/{id}/active`; metadata edits never change it.

- [ ] `/account` "My published records": an ACTIVE owned record shows
      View + Edit in Curator + **Deactivate**
- [ ] Click "Deactivate" → confirm dialog says it hides but does NOT delete
      (preserved, reversible) → confirm
- [ ] The record disappears from `/search`, `/explorer` and their filter
      dropdowns; its detail page 404s for anonymous/other users
- [ ] Back on `/account`, that record now shows a "deactivated" chip,
      **no View button** (it would 404), Edit in Curator, and **Reactivate**
- [ ] "Edit in Curator" on the deactivated record loads, Save Changes
      succeeds, and returns to `/account` (not a 404 detail page); the record
      stays deactivated (search still hides it)
- [ ] "Reactivate" → confirm dialog → record is public again in search/detail
- [ ] (Active record only) paperdetails still offers owner/admin Deactivate in
      the permission notice; after deactivating there, reloading the detail
      404s by design — manage it from `/account` thereafter

## Editors (edit-only co-authors) and audit

Roles: admin manages everything; owner edits + manages their record;
editor_emails edit ONLY (no deactivate/reactivate, no owner assignment, no
editor-list changes). `is_active`/editors/audit fields can never be changed
through the metadata PUT payload.

- [ ] As the owner on `/account`: "Editors" → add a second staging account's
      email (comma-separated) → Save
- [ ] As that editor: the record appears on `/account` with an "editor" chip,
      View + Edit in Curator only (no Deactivate, no Editors button)
- [ ] Editor edits via Edit in Curator → Save Changes succeeds
- [ ] Editor direct API checks: `PUT /api/paper/{id}/active` → 403;
      `PUT /api/paper/{id}/editors` → 403
- [ ] paperdetails as editor: notice says "you can edit this record (editor)",
      no Deactivate button
- [ ] Admin reassigns the owner (`PUT /api/paper/{id}/owner`, force) → the old
      owner loses edit unless first added to editors
- [ ] After an edit/deactivate/editors change, the stored record carries
      updated_at / updated_by_email and an appended edit_history entry
      (check via mongo shell or /raw as owner)

## Edit-mode unsaved changes guard

- [ ] In `/curator?edit=<id>`, change a field (or just TYPE in an open section
      form without pressing its save) and click a nav link → dialog offers
      Leave Without Saving / Stay only (no draft-save option, no Dismiss)
- [ ] "Stay" keeps you on the curator; "Leave Without Saving" navigates
- [ ] With no changes, navigation is not intercepted
- [ ] Save Changes then navigate → no prompt

## Admin: all records management

Two admin drawers on /account by design: "Ownerless records" is a short
migration helper (shows the curator-declared owner suggestion); "All records"
is the complete management surface over every stored record.

- [ ] As an allowlisted admin, `/account` shows "All records (admin)" listing
      every record — including deactivated, ownerless, and other users'
      records — with owner, editor list, status chips and last-updated info
- [ ] Active row: View / Edit in Curator / Editors / Reassign Owner /
      Deactivate; deactivated row: no View, Reactivate instead
- [ ] "Reassign Owner" → dialog explains the old owner loses edit unless kept
      as editor → confirm → row shows the new owner; the new owner can edit,
      the old owner cannot
- [ ] "Editors" / "Deactivate" / "Reactivate" work from this list and update
      the row in place
- [ ] Non-admin: section absent; `GET /api/admin/papers` with a non-admin
      cookie → 403, anonymous → 401

## Admin: ownerless records

- [ ] Signed in as an allowlisted admin, `/account` shows an
      "Ownerless records (admin)" section listing legacy records with no owner
- [ ] Each row shows the (unverified) suggested email; "Assign" sets the owner
      and the row disappears; a bad email shows the backend error inline
- [ ] Non-admins do not see the section; `GET /api/admin/ownerless-papers`
      with a non-admin cookie → 403

## Verify link edge cases

- [ ] Re-click a verification link after publishing → still lands on the paper
      (idempotent), NOT an error, and no duplicate record is created
- [ ] A tampered/unknown `/verify/PUBLISH_bogus?server=…` → "couldn't finish
      publishing" page with a specific message and a Browse link (not a blank
      "contact the administrators")

Identity/verification model (documented, not configurable in UI): Google
(or staging dev-login) provides the verified identity and owner_email;
publishing still queues the record for a final verification step before DB
insertion; production sends the verification email over SMTP, staging can
set QRESP_PUBLISH_SKIP_EMAIL=1 to show the link instead. No Google
Drive/Gmail scopes anywhere.

## After QA

- [ ] Note any UI deltas vs production in FULL_STACK_MODERNIZATION_REPORT.md §8
- [ ] Do NOT leave `QRESP_ENABLE_DEV_LOGIN` set on anything production-facing
