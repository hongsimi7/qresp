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

## Publication Information (manual entry + DOI Fetch)

- [ ] Signed in, /curator → "Publication Information for This Paper" shows ONE
      canonical DOI field with its Fetch button and nothing else automated:
      no "Import Manuscript Source" card, no file picker, no
      "Selected source"/Clear controls, no `.pdf`/`.tex`/`.zip` anywhere
- [ ] The section offers NO AI action: no "Suggest missing publication
      details with AI", no AI dialog, no mention of Gemini
- [ ] "Qresp Curation Information" holds PIs / PaperStack / Keywords /
      notebook. "Suggest Keywords with AI" sits under the Keywords field —
      and NOT in Publication Information
- [ ] The keyword dialog names what it sends before anything leaves: the
      paper's own fields and the artifacts already added. It states that no
      file, notebook, image, path or RCC URL is sent. No manuscript-consent
      checkbox and no full-source option anywhere
- [ ] Suggestions arrive all unticked, tagged "Existing Qresp keyword" or
      "New suggestion"; Apply Selected Keywords APPENDS to what you typed
      (a keyword you already have is not duplicated, and your spelling wins)
- [ ] Applying keywords does not save or collapse Qresp Curation Information
- [ ] With the provider unconfigured the button explains that, without
      calling out; over quota it says so distinctly
- [ ] Fetch a DOI, do NOT press the section Save, press Save Draft, then
      Resume the draft: every fetched field comes back
- [ ] Apply AI keywords, do NOT press the section Save, press Save Draft,
      then Resume: the keywords come back
- [ ] Paste a real DOI → Fetch → Kind, Title, Authors, Journal Name, Volume,
      Page, Year, Abstract and URL fill in from the registry
- [ ] Fetch a DOI whose registry record lacks a journal or page → those
      inputs stay BLANK for manual entry; nothing is guessed
- [ ] A DOI whose registry record has no URL → the URL field shows exactly
      `https://doi.org/<normalized-doi>`
- [ ] Paste `doi:10.…` and `https://doi.org/10.…` → both normalize to the
      bare DOI in the field before fetching
- [ ] Fetch does NOT close, collapse or save the section — the edit form
      stays open with its values, and the Save button is still there
- [ ] Only the section "Save" button commits and switches to display mode
- [ ] Clearing Journal Name, Page, Abstract, Volume or Year and pressing Save
      shows "Required" and does not save (every asterisked field is required
      for Preprint, Journal and Dissertation alike)
- [ ] DOI and URL may be left empty and Save still succeeds
- [ ] Upload Metadata (JSON) import/export still works unchanged
- [ ] Drafts, edit mode and publish are unaffected


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

Folder picker layout (check at 1440×900, 900×800 and 390×844 — resize the
window or use the browser's device toolbar):

- [ ] With the picker open, **USE** and **CANCEL** sit in a fixed row at the
      BOTTOM of the dialog; the title and the **Current selection** line sit
      in a fixed area at the top. Only the folder tree scrolls, and there is
      exactly ONE scrollbar in the dialog
- [ ] USE is visible and disabled before anything is ticked
- [ ] Tick a folder → USE enables, and **nothing moves**: the dialog does not
      change size, the tree does not jump, and USE/CANCEL stay put. Untick →
      USE disables again
- [ ] Tick a different folder → the Current selection line shows only the new
      path; the previous one is gone
- [ ] Expand several levels and scroll to the bottom of a long tree → the
      action row stays visible the whole time
- [ ] A long folder name wraps onto the next line; its checkbox and expand
      chevron stay on the first line and never overlap the name, and the
      dialog never scrolls sideways
- [ ] The long selected path is truncated with `…` on ONE line (hover shows
      the full path) and never pushes USE/CANCEL out of the dialog
- [ ] Scroll the wheel over the dialog past the end of the tree → the page
      behind it does not move
- [ ] USE fills **Selected folder** in the form and closes only the picker:
      the "Where is the paper" section stays open and nothing is saved.
      CANCEL leaves the previous selection untouched
- [ ] Use a Dataset/Script "files" picker first (multi-select), then Search
      from File Server → the folder picker is back to ONE folder: the Current
      selection line is shown and ticking a second folder replaces the first

Deterministic results on the fixture folder:

Only directly evidenced values may be filled in. Everything else must be
blank and flagged — a generated-looking value is worse than an empty field.

- [ ] Charts tab lists `figures/*.png` with the exact image path filled in
- [ ] **Figure number is BLANK** on every chart — not 1, 2, 3 — and flagged
      as needing input. Switch tabs / re-run: it is still blank
- [ ] **Figure Caption is BLANK** on every chart, and its helper text says to
      use the paper's caption (or a concise description when the figure has
      none) — it is never labelled a generic "Description"
- [ ] **Keywords is BLANK.** Open Details: filename tokens appear there as
      `Filename hints (not metadata): …` and NOWHERE in a field
- [ ] The chart fields read **Figure Image, Figure Number, Figure Caption,
      Keywords, Input / Supporting Files, Reproduction Notebook** — the same
      labels the Add/Edit Chart form uses. Dataset and Script labels are
      unchanged
- [ ] Reproduction Notebook is filled only for a `.ipynb` in the SAME folder
      with the same basename, and Details says so; no chart has Extra Fields
- [ ] Datasets tab groups by directory — `data/short_traj` holds both `.xyz`
      files exactly, the **description is BLANK** (no "Files from …"), and
      there is NO invented URL
- [ ] Scripts tab: the **description is BLANK** even for a `.py` that has a
      module docstring; the docstring appears under Details as evidence
- [ ] Tools tab: entries appear ONLY for pinned manifest lines
      (`numpy==1.26.4`); an unpinned `scipy>=1.10` produces no Tool; imports
      appear only as the "possible dependencies … not added as tools" note.
      `Tools (0)` is a correct result for a folder with no manifest
- [ ] A `module load pkg/1.2.3` line in a run script, or a README stating
      "… v7.2", DOES produce a Tool with that exact version; prose with no
      version marker produces none
- [ ] Existing manually curated Tools records elsewhere in the form are
      untouched by an analysis
- [ ] Open **Edit Proposal**: each field carries its own evidence chip —
      `High evidence` on the detected image path, `Medium evidence` on a
      same-folder notebook, `Needs input` on figure number and caption. No
      field shows `High evidence` for something Qresp did not read
- [ ] Details lists **Filename hints — not verified metadata**; the tokens
      and any name-similar file in another folder appear ONLY there

Folder organization guide (Qresp Folder Standard v1):

- [ ] A **How to organize an RCC folder** button sits beside the File Server
      actions and opens a dialog; nothing is shown until you click it
- [ ] The example is a live icon tree (selectable text, scales with the
      window, scrolls rather than overflowing at phone width) — not an image.
      It shows `charts/figure-id/{preview.png, notebook.ipynb, data/}`
- [ ] The opening text says Qresp can inspect any folder inside the allowed
      file server roots, that proposals are deterministic for the standard and
      recognized legacy names, and that an unsupported structure is left as
      Needs reorganization / Unclassified rather than guessed at. It does NOT
      claim any folder is analyzed perfectly
- [ ] It says the five role folders are optional, that existing folders are
      never renamed or modified, and never asks for a YAML/JSON/Qresp-specific
      file
- [ ] It states the standard's Chart unit: **one `charts/<figure-id>/` folder
      is one Chart**, `preview.png` is the Figure Image, `notebook.ipynb` the
      Reproduction Notebook, the chart's `data/` its Input / Supporting Files,
      and each independent figure gets its own folder
- [ ] The several-images-in-one-folder guidance is in its OWN section, marked
      as compatibility review for folders that already exist — not as a second
      way to lay out a new paper
- [ ] It warns against storing secrets in an inspected folder
- [ ] Analyze a folder that follows NONE of the advice → it behaves exactly
      as before; the guide never validates, scores, or blocks anything
- [ ] No Experiment record is proposed anywhere
- [ ] `README.md` (or anything unmatched) appears under Unclassified

Record boundaries and grouping:

- [ ] The review dialog reports how the folder was read (`Qresp Standard`,
      `Legacy-compatible`, `Needs reorganization`) and names each recognized
      role root (`figures_tables` → charts, `data` → datasets, `doc` → docs);
      nothing on the file server is renamed
- [ ] `doc/` produces no Charts, Datasets, Scripts or Tools, and its files do
      NOT reappear as Unclassified noise
- [ ] A legacy tree offers **Choose record boundaries** for its dataset/script
      roots; **Rebuild proposals** re-runs the analysis and changes proposals
      only — nothing is added to the form, saved or published
- [ ] A figure folder named after one of its images (e.g.
      `figure_2/figure_2.png` beside `homo.png`, `lumo.png`) proposes **ONE**
      Chart by default, with `figure_2.png` as the Figure Image. The other
      images are NOT silently attached: they are listed in the Charts section
      of Record boundaries, marked `Review`, and create nothing until given a
      role
- [ ] In that Charts section, set `homo.png` to **Create Chart** → after
      Rebuild there are two independent Chart candidates, each with one Figure
      Image; set it to **Supporting File** instead → one Chart, with
      `homo.png` in its Input / Supporting Files; **Ignore** → nothing
- [ ] That folder's `figure_2.ipynb` is the Chart's Reproduction Notebook, NOT
      a separate Script, and it is attached only to the image whose basename
      matches
- [ ] `.sh` / `.py` / `.ipynb` under a Datasets role produce no Scripts;
      `.csv` / `.json` under a Scripts role produce no Datasets
- [ ] A logo/icon/TOC graphic is never a Chart
- [ ] The card chip reads `Medium evidence` (likely) rather than
      `High evidence` for an artifact — only FIELD chips say High

Unclassified readability:

- [ ] Unclassified is grouped by folder with a name and count per group;
      names appear as chips only after expanding a group
- [ ] The filter box narrows the groups and clearing it restores them
- [ ] No screen shows hundreds of paths as one continuous paragraph

Chart images:

- [ ] Apply a Chart from folder analysis with the folder SAVED → the PNG
      renders; the URL is `fileServerPath/figures/....png` with no double
      slash
- [ ] Apply one BEFORE saving the File Server path → the alert warns, and the
      chart shows "No file server path is saved yet…" instead of a blank box
- [ ] A chart whose file was moved/deleted shows "could not be loaded from
      `<url>`" rather than an empty frame
- [ ] A manually curated chart (picked through the file tree) renders exactly
      as before
- [ ] A folder or file name containing a space still renders

Candidate visibility (the DOI folder has ~2000 files):

- [ ] Every tab count matches the real total; nothing is silently dropped
- [ ] A tab with more than 25 candidates shows the first 25, strongest
      evidence first, plus **Show all N candidates** and a line saying how
      many are collapsed *and not discarded*
- [ ] Click Show all → the full list renders and the button disappears
- [ ] Select a candidate near the end of a long list, then re-collapse →
      your selection is still visible

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

- [ ] **Enhance selected with AI** is DISABLED until at least one candidate is
      selected, and says "Select the candidates you want described first."
- [ ] Clicking it opens a CONSENT DIALOG that sends nothing: it names the
      count, lists what travels (relative paths, file/folder names, README /
      docstring / manifest excerpts) and what does not (raw datasets, image
      bytes, notebook contents, credentials, account data)
- [ ] The consent checkbox is UNCHECKED and "Send and get suggestions" is
      disabled until it is ticked; Cancel makes no request (check the Network
      tab — only the analyze call appears)
- [ ] Run it once, then click Enhance again → consent is asked AFRESH, the
      box is unchecked again (no remembered blanket consent)
- [ ] Select an item Qresp classified with MEDIUM confidence → if the AI
      disagrees about the kind it says so as a NOTE ("reads this more like a
      dataset … nothing has been moved"); the candidate stays in its original
      tab and the tab counts do not change
- [ ] A HIGH-confidence candidate never gets a kind second-opinion
- [ ] Type your own description first, then run the AI → your text is still
      there; the proposal sits beside it marked "not applied" until you click
      to accept it
- [ ] Factual fields (image file, figure number, files, package name,
      version, executable, patches) are unchanged before and after the AI run
- [ ] After consent → suggestions appear in their own **AI suggestion** area
      with a `medium`/`low` label and a "Based on: …" reason. NO field is
      filled in, nothing is added, nothing is saved
- [ ] The AI label never reads `high`, and no numeric percentage (e.g. "92%")
      appears anywhere
- [ ] "Use as …" applies exactly one field; the candidate is NOT added to
      Curator by accepting
- [ ] Type your own text in a field first → the matching "Use as …" is
      DISABLED with "your text is kept — clear the field to use this instead"
- [ ] Factual fields are unchanged before and after: image file, figure
      number (still blank), files, notebook file, package name, version,
      executable, patches
- [ ] Network: the request body carries only `id/kind/name/paths/context`;
      no file contents, no image bytes, no email/account fields, and every
      path is relative
- [ ] Then "Add selected items to Curator" still adds the reviewed records
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
