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
- [ ] **Cleanup after this deploy:** CILogon was removed from the code.
      Delete `QRESP_CILOGON_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` /
      `_DISCOVERY_URL` and any CILogon-only `env_file` reference from the
      staging backend by hand. Nothing reads them any more; leaving them set
      is harmless but misleading. Do NOT delete `ExternalIdentity` rows —
      legacy `provider: "cilogon"` documents stay in place, unused.

## Microsoft Entra sign-in — pending app registration

- [ ] Env on staging backend (see MICROSOFT_ENTRA_LOGIN_SETUP.md):
      `QRESP_MICROSOFT_CLIENT_ID`, `QRESP_MICROSOFT_CLIENT_SECRET`,
      `QRESP_MICROSOFT_REDIRECT_URI`
      (= `https://localhost:8443/api/auth/microsoft/callback`, exactly as
      registered); optional `QRESP_MICROSOFT_TENANT` (default organizations)
- [ ] Unconfigured: "Continue with Microsoft" → JSON 503; Google and
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
      that campus can use Google until consent is granted)

## Sign-in entry points (Microsoft + Google only)

- [ ] Header, signed out: exactly ONE **Sign in** control — no per-provider
      buttons, no "Dev sign in", no institution/CILogon wording anywhere
- [ ] It links to `/login?next=<the page you were on>` and returns you there
      after signing in
- [ ] Narrow the window to phone width: **Sign in** stays visible in the
      header bar, on one line, NOT hidden behind the hamburger; navigation
      links still collapse into the drawer
- [ ] Opening the drawer does not duplicate or relocate the Sign in control
- [ ] `/login` shows exactly two choices — "Continue with Microsoft" and
      "Continue with Google" — with no provider errors, config, API keys,
      Drive/Gmail permissions, dev-login, or CILogon
- [ ] `/login?next=https://evil.example.com/x` → the provider links fall back
      to `next=%2F` (never an external redirect)
- [ ] Visiting `/login` while already signed in redirects to `next`, or to
      `/account` when no `next` was given — it does not ask again
- [ ] Signed in: header shows the name (linking to `/account`), the admin
      label where applicable, and **Sign out**
- [ ] `/curator` while signed out: the gate shows a primary **Sign in to
      curate** button linking to `/login?next=/curator`, and returns to the
      curator afterwards
- [ ] `QRESP_ADMIN_EMAILS` matching the signed-in email grants the admin
      badge/surfaces
- [ ] `GET /api/auth/cilogon` and `/api/auth/cilogon/callback` → 404;
      `/api/ui/` lists only google/microsoft/me/logout/dev-login auth routes
- [ ] Legacy note: records owned by a DIFFERENT email are not visible to a
      new identity until an admin reassigns ownership or adds the new email
      as an editor (expected behavior)

### Google sign-in diagnosis (2026-07-28)

The OAuth flow itself was verified working on staging (`/api/auth/google`
302 → callback 302 → `/api/auth/me` 200). What failed afterwards was nginx:
a single server-wide `limit_req` throttled every request, so one page load's
`/_next/static` burst came back **503** and it looked like a login failure.

- [ ] Deploy the nginx config, then run `./nginx/ratelimit-check.sh
      https://localhost:8443` → **RESULT: PASS** (no 503/429 anywhere)
- [ ] Manually: sign out, click **Sign in** → Continue with Google → Google
      shows the **account chooser** (not a silent re-login), pick an account
      → land back on the page you started from, fully rendered, no 503
- [ ] Sign out and in again with a DIFFERENT Google account — possible now
      that `prompt=select_account` is sent
- [ ] Hard-reload `/`, `/login`, `/account`, `/curator` several times in a
      row → every asset 200/304, never 503
- [ ] Expensive endpoints still protected: fire ~30 rapid
      `POST /api/curation/analyze-folder` → later ones get **429**
      (not 503) and the app keeps working
- [ ] `docker compose -p qresp_staging logs nginx | grep auth/google/callback`
      → shows `/api/auth/google/callback?[redacted]`, never `code=`/`state=`
- [ ] Backend log for the same request → also redacted; a cancelled sign-in
      shows a generic "did not complete" message to the user with the
      provider's error string only in the log
- [ ] No secret, token, provider response body, or stack trace appears in any
      user-visible error

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

## PDF manuscript source

- [ ] The Import Manuscript Source picker accepts `.tex,.zip,.pdf`
- [ ] Select a normal text-layer PDF → import succeeds; the review dialog
      proposes ONLY a printed DOI (if any) and states plainly that Qresp does
      not guess title/authors/abstract from a PDF
- [ ] A scanned/image-only PDF → refused with a message naming the missing
      text layer (NOT a generic parse error); no OCR is attempted
- [ ] An encrypted/password-protected PDF → refused cleanly
- [ ] A >100-page or >10 MB PDF → refused with a size/page message (nginx is
      at 15M, the importer at 10M — the app-level message must win)
- [ ] After selecting a source: "Selected source: `<name>` — kept in this
      browser tab only, never saved to a draft." with a working Clear button
- [ ] Save Draft, then reload and resume it → the source is GONE (runtime
      only) while all typed metadata survives
- [ ] DevTools → Application → Local Storage: the `state` entry contains no
      file name, no `sourceFile` key, and no PDF bytes
- [ ] Qresp never downloads a PDF by itself: no request is made to the DOI
      link, publisher page, `referenceInfo.url`, `fileServerPath`, or
      `downloadPath` at any point

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

## RCC folder analysis (assisted curation)

Fixture folder (read-only, the design reference):
`https://notebook.rcc.uchicago.edu/files/10.1021.acs.jpcc.5c01077/` —
`data/{SE-RSH,VDOS,dipoles,short_traj/*.xyz,vlocal}`, `figures/*.png`,
`scripts/*.py`. See `RCC_FOLDER_ANALYSIS.md`.

Staging environment for this section:

```sh
QRESP_FILESERVER_ROOTS=https://notebook.rcc.uchicago.edu/files
# ONLY while the RCC certificate is expired; unset once it is renewed:
QRESP_FILESERVER_INSECURE_TLS_HOSTS=notebook.rcc.uchicago.edu
```

Selection vs. saving (these are separate steps on purpose):

- [ ] Signed in, /curator → "Where is the paper": **Analyze RCC Folder** is
      DISABLED with the "pick a file server folder first" hint, and
      "Selected folder" reads "None yet"
- [ ] Choose the RCC root → Search → the file tree opens; its confirmation
      button reads **Use Folder**
- [ ] Pick the DOI folder and confirm → the dialog closes, the form STAYS
      OPEN, "Selected folder" shows the full path, and nothing was committed
      (the section did NOT collapse to the display card)
- [ ] Analyze RCC Folder is now enabled and analyzes that UNSAVED folder
- [ ] Search again / cancel the tree → the previous selection is still shown
- [ ] With a folder already saved, click the pencil → the form opens with the
      saved path already in "Selected folder" (not empty); a search that
      fails (bad URL → error alert) does NOT erase it
- [ ] **Save File Server** is the only thing that commits: after clicking it
      the section switches to the display card with the saved path
- [ ] The saved display card itself offers **Analyze RCC Folder** — no pencil
      click needed — and exactly one such button is visible in either state
- [ ] There is NO second URL box in either state (DevTools → Network: the
      POST body is `{"path": "<the selected or saved path>"}`)
- [ ] Chart / dataset / script / tool / notebook pickers are unchanged: their
      file tree confirmation still reads **Save** and still fills their field

Deterministic results on the fixture folder:

- [ ] Charts tab lists `figures/*.png`; each shows confidence, evidence, and
      a "Needs your input: caption, number" chip; caption is blank
- [ ] The proposed `number` is a 1..N sequence and is flagged as needing
      input (it is NOT claimed to be the paper's figure number)
- [ ] No chart has Extra Fields, and `notebookFile` is empty (no `.ipynb`)
- [ ] Datasets tab groups by directory — `data/short_traj` holds both
      `.xyz` files with the generic "Files from data/short_traj" description
      and NO invented URL
- [ ] Scripts tab: a `.py` with a module docstring uses that docstring; one
      without falls back to "Script `<filename>`" flagged as needing input
- [ ] Tools tab: entries appear ONLY for pinned manifest lines
      (`numpy==1.26.4`); an unpinned `scipy>=1.10` produces no Tool; imports
      appear only as the "possible dependencies … not added as tools" note
- [ ] No Experiment record is proposed anywhere
- [ ] `README.md` (or anything unmatched) appears under Unclassified

Review, apply, and non-destructiveness:

- [ ] Everything starts UNCHECKED and "Add selected items to Curator" is
      disabled until something is selected
- [ ] Edit a caption/description in the dialog → the edited value is what
      gets added
- [ ] Remove a candidate → its tab count drops and it cannot be added
- [ ] Add a chart by hand FIRST, then apply two analyzed charts → the manual
      chart is untouched and the ids are distinct (`c0`, `c1`, `c2` — no
      duplicate `c1`)
- [ ] Applied items appear in the normal Charts/Datasets/Scripts/Tools lists
      and are still editable with the existing Edit forms
- [ ] Applying makes NO save/publish request (Network shows only the
      analyze call) and the record is not published
- [ ] Manual FileTree selection, Add and Edit forms all still work unchanged
- [ ] Cancel applies nothing

Path safety (expect a clear 400 and NO outbound request):

- [ ] Temporarily point the saved path at another host / a parent path
      (`…/files/…/../../etc`) / an encoded traversal (`%2e%2e`) / an
      `http://` downgrade → "outside the file server roots" or the matching
      refusal, and the server log shows no listing attempt
- [ ] A very large or deep folder → the dialog shows "Only part of the
      folder was inspected" plus the specific cap warning (never a silent
      partial result)
- [ ] Server log for a successful run contains counts only — no file names,
      no directory contents, no manifest text

Responsive layout and partial results:

- [ ] At a normal desktop width a candidate card is one line: checkbox, label,
      chips, then **Details / Edit Proposal / Remove** on the right
- [ ] Narrow the dialog: the actions wrap to their own line as a group —
      "Edit Proposal" never breaks word by word, and nothing overflows
      horizontally
- [ ] Long relative paths in **Details** wrap instead of forcing a sideways
      scrollbar
- [ ] **Edit Proposal** opens the fields with clear vertical separation from
      the header/evidence (a divider), two columns on desktop and one column
      on narrow widths
- [ ] The DOI fixture folder reports `truncated` → an **info** (not error)
      notice says it is a partial view, how many files/folders were scanned,
      and which limits stopped it; the specific reason is listed below it
- [ ] Backend log shows ONE `TLS VERIFICATION DISABLED for
      notebook.rcc.uchicago.edu ...` line per analysis instead of hundreds of
      urllib3 `InsecureRequestWarning` lines; any OTHER host still warns
- [ ] `/login` renders as a fixed centered card — no accordion to expand
      before the provider buttons are usable

Optional AI descriptions (only with Gemini configured):

- [ ] The consent box is UNCHECKED on every open; the AI button is disabled
      without both consent and a selection
- [ ] With consent + selection → descriptions fill the editable fields;
      nothing is applied to the form and nothing is saved
- [ ] Network: the request body carries only `id/kind/name/paths/context`;
      no file contents, no image bytes, no email/account fields, and every
      path is relative
- [ ] With Gemini NOT configured → the folder analysis still completes in
      full and only the AI action reports "not configured on this server"

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
