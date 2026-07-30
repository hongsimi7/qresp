# Auto-Curation Lite (Phase 1) — DOI Lookup & Manuscript Source Import

The **Publication Information for This Paper** section owns the ONE
canonical DOI field (with its Fetch button) and the **Import Manuscript
Source** card (a `.tex` file or a `.zip` exported from Overleaf) for the one
primary paper being curated — there is deliberately no second DOI entry
point. Manuscript import is a *proposal* tool: every value goes through a
review dialog, the user picks which fields to apply, and nothing is ever
published or overwritten automatically. The existing **Upload Metadata**
(JSON) workflow is unchanged and unrelated.

## Which parts use AI, and which never do

Qresp splits these three deliberately. The split is the design, not an
implementation detail:

| Area | How values are produced | AI? |
| --- | --- | --- |
| **Publication metadata** (kind, title, authors, abstract, journal, volume, page, year, DOI, URL) | Crossref via the DOI registry, plus deterministic extraction from the printed `.tex`/`.pdf` front matter | **Never.** This is factual data with an authoritative source |
| **Keywords** | Curator's own entry, plus optional Gemini suggestion in *Qresp Curation Information* | Optional, consent-gated, human-approved |
| **RCC artifacts** (datasets, charts, scripts, tools, docs) | Deterministic folder discovery under Folder Standard v1 | Optional Gemini *enrichment* of descriptions only |

No AI result is ever auto-applied, auto-saved or auto-published. Every
suggestion arrives unchecked, is applied field by field by the curator, and
still needs an explicit section **Save**.

A language model is not used for bibliography because bibliography has a
registry. Asking a model to fill a journal name or a year invites a fluent,
plausible, wrong answer into a field that looks curated — and Crossref
already answers the same question exactly. Where the registry and the
manuscript are both silent, the field is **left blank** for the curator to
type, never inferred.

## Data flow (final)

- A Qresp record represents ONE primary paper. Its bibliography is the
  curator state's **`referenceInfo`** slice — the single canonical source,
  edited in "Publication Information for This Paper" and the only import
  destination (via `frontend/Utils/primaryPaper.js`). It publishes as the
  record's existing **`reference`** block, which search, paper details,
  publish validation and dedup already read — no schema change, no record
  migration, no duplicated title/DOI data, and no separate cited-works model
  (none ever existed in the schema).
- **Loading**: `reference` → `referenceInfo` for every legacy record.
  Legacy drafts/metadata JSON load unchanged; drafts saved by a short-lived
  intermediate branch shape (which used a `publicationInfo` key) are
  absorbed back into `referenceInfo` automatically.
- **"Qresp Curation Information"** (formerly "Add info about your paper")
  owns only the curation metadata: Principal Investigators, PaperStack /
  collections, Keywords, and the Main Notebook File. Import can never write
  collections/notebook/file-server/sections/workflow/license/documentation/
  curator identity; tags are appended only when explicitly selected; and
  authors join the PIs only through the per-author
  "Add selected paper authors as Principal Investigators" picker (every
  author unchecked by default, selected names appended — never replacing
  existing PIs). PaperStack and the notebook file are explicitly marked
  "(manual)" in the post-apply checklist.

## Supported inputs

- A DOI (bare `10.…`, `doi:` prefix, or `https://doi.org/…` URL).
- A single `.tex` file (UTF-8; up to 10 MB upload, 2 MB of TeX inspected).
- An Overleaf project `.zip` export. The likely main file is chosen by
  scoring `\documentclass` / `\begin{document}`; in-archive
  `\input`/`\include` files are read (bounded depth/count); `.bib` files are
  scanned for DOI **candidates** (these are references, not necessarily this
  work's DOI, so they are listed for the user rather than auto-used).
- A `.pdf` of the manuscript, **text layer only** (same 10 MB upload cap; at
  most 100 pages and 1 M characters of extracted text). It is parsed in
  memory with pypdf — encrypted PDFs are refused, a single unreadable page
  degrades rather than failing the import, and a scan with no text layer is
  rejected with a message saying so. **There is no OCR**, and Qresp never
  downloads a PDF for you: nothing is fetched from a DOI link, a publisher
  page, `referenceInfo.url`, `fileServerPath`, `downloadPath`, or any other
  URL. The curator selects a local file.

## What is extracted / proposed

- From TeX (conservatively, common patterns only — nothing is guessed):
  `\title{}`, `\author{}` (including multiple/`\and`), the `abstract`
  environment, `\keywords{}`/`\keyword{}`, a `\doi{}` command or in-text
  DOI/doi.org pattern. Ordinary markup (`\textbf`, `\emph`, `\thanks`,
  comments, math wrappers) is cleaned, not interpreted.
- From the DOI registry (Crossref, short timeout): kind (work type mapped to
  preprint/journal/dissertation; unmapped types propose nothing), title,
  authors, journal, year, volume, issue, pages, abstract, DOI, URL, and
  subject keywords. Missing optional metadata never fails the lookup.
- From a `.pdf`, only what is **actually printed in the front matter**: a
  DOI, the title, the author line, the abstract under its own heading (kept
  verbatim, never summarized), and a year — but a year only from an
  unambiguous copyright, citation or publication-date context. Received,
  revised, accepted and submitted dates are excluded: none of them states
  when the work was published. A PDF's text layer has no markup, so each of
  these is a layout reading and is labelled as such in the review dialog for
  the curator to check. Journal, volume and page are **not** read from a PDF
  — fetch the DOI for those, or type them.
- **URL** is computed, never proposed: when a DOI is known and the registry
  supplied no URL of its own, it becomes `https://doi.org/<normalized-doi>`.
  Nothing else ever writes this field.
- For a `.tex`/Overleaf source WITHOUT a DOI, kind defaults to
  **preprint as a suggestion only** (client-side, clearly chipped
  "suggested"); DOI, year, venue and authors are never invented.
- If the manuscript itself contains a DOI, the registry is queried and
  results are merged: **manuscript title/authors/abstract win**, registry
  fills the bibliographic gaps, and disagreements are shown as per-field
  alternatives with provenance — the user decides.
- Tag suggestions come only from TeX keywords and registry subjects
  (deterministic; **no LLM**), and are appended to existing tags, never
  replacing them.

## Applying to the draft

- The review dialog shows proposed vs. current values. Fields that already
  have a value default to **unchecked**; nothing populated is overwritten
  unless explicitly checked.
- After applying, a readable checklist lists what is still missing for
  publication (title, authors, publication/year, curator info, collections,
  license, at least one chart and one dataset). **Drafts stay saveable while
  incomplete** — publish validation remains the only completeness gate.

## Privacy & safety behavior

- Uploads are read client-side and processed **in memory only** on the
  backend: manuscript content is never persisted to MongoDB/disk/Git, never
  logged, never echoed back in responses, and never sent to any external
  service. The only outbound call is the DOI registry lookup (the DOI
  string itself).
- **No TeX compilation or execution of any kind** — parsing is regex/brace
  scanning only. Archive members are never extracted to the filesystem.
- ZIP hardening: path traversal, absolute paths, symlinks, deep nesting
  (>10 levels), >200 entries, >50 MB uncompressed total, and oversized
  member files are all rejected with clear errors; the raw upload is capped
  at 10 MB.
- Both endpoints (`POST /api/import/doi`, `POST /api/import/manuscript`)
  require an authenticated session and the standard CSRF token.
- **No AI/LLM processing anywhere in this feature.**

## Deployment note: nginx 15M vs importer 10M

The importer's RAW file cap is 10 MB (backend `MAX_UPLOAD_BYTES`), but the
frontend transports the file base64-encoded inside a JSON body, which
inflates the HTTP request to ~13.4 MB (10 MB × 4/3 plus the JSON envelope).
`nginx/default.conf` therefore sets `client_max_body_size 15M`: large enough
that every backend-legal upload reaches the backend's own validation (clear
"too large"/safety errors instead of an opaque nginx 413), while still
bounding requests. The effective end-user file limit remains 10 MB —
enforced in the backend both on the encoded length and the decoded bytes;
nothing else about extraction, persistence, or limits changed.

## Optional AI keyword suggestions (Gemini, opt-in)

Google Gemini is the single selected provider — deliberately not a
multi-provider framework. The API host
`https://generativelanguage.googleapis.com/v1beta/models` is fixed in code
so no environment mistake can redirect the prompt elsewhere; only the model
name is configurable, and it is sanitized (plain model tokens only) before
it enters the request path. Calls use the native
`POST {host}/{model}:generateContent` endpoint with structured JSON output
(`responseMimeType: application/json` plus a narrow `responseSchema`), never
the OpenAI-compatibility mode, and never Files, Google Search, Grounding,
URL Context, or Code Execution.

- **Disabled by default.** Enabled only when the server sets BOTH
  `QRESP_GEMINI_ENABLED=1` and `QRESP_GEMINI_API_KEY`. Optional tuning:
  `QRESP_GEMINI_MODEL` (default `gemini-3.6-flash`),
  `QRESP_GEMINI_TIMEOUT_SECONDS` (default 15, hard ceiling 60),
  `QRESP_GEMINI_MAX_MANUSCRIPT_CHARS` (default 60000),
  `QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY` (default 20; a persistent
  per-user daily counter enforces it, counted per PROVIDER CALL so a
  chunked manuscript cannot bypass the limit),
  `QRESP_GEMINI_MAX_OUTPUT_TOKENS` (default and ceiling 256). Environment
  variables only — never config.ini; the retired `QRESP_KIMI_*` (and older
  `QRESP_QWEN_*`) variables have no effect and no aliases.
- **The key is a dedicated Google AI Studio / Gemini API key — NOT the
  Google OAuth client secret** used by "Sign in with Google". The assist
  module never reads `QRESP_GOOGLE_*`, and no user OAuth token, Drive or
  Gmail scope is ever involved. The key travels only in the
  `x-goog-api-key` request header (never a `?key=` query string, which would
  leak into proxy logs).
- Only the backend ever contacts Gemini: no key, endpoint, or provider
  configuration exists in frontend code. Failed calls are **never retried** —
  a retried paid request is accidental spend.
- **Two entry points, both suggestion-only:** "Suggest Keywords with AI" in
  Qresp Curation Information sends only the paper's title/abstract/venue/DOI;
  manuscript imports additionally offer a default-OFF consent checkbox
  ("Analyze extracted manuscript text with AI to suggest keywords.") in the
  review dialog — only after ticking it AND clicking the fetch button is the
  uploaded file re-sent to the backend, re-extracted in memory, stripped of
  its bibliography (so cited works don't dominate), bounded, chunked (max 3
  chunks) and sent to the provider.
- **Manuscript source lifecycle.** A selected `.tex`/`.zip`/`.pdf` is held as
  a runtime-only `File` handle in the page session (`sourceFile` in Curator
  state). It is deliberately outside the serialized draft: it never reaches
  localStorage, an account draft, MongoDB, or disk, and it is dropped on
  reset or when the tab closes. Each consented request re-reads the file and
  re-extracts it in memory on the backend; neither the bytes nor the
  extracted text are persisted or logged anywhere. Consent is per request —
  the box is unchecked every time the dialog opens, and "Get suggestions from
  metadata" stays available without it.
- **What can leave the server:** at most the clipped
  title/abstract/venue/DOI and bounded manuscript-body excerpts, inside a
  fixed prompt that marks them as untrusted data and requests JSON keyword
  candidates only (no tools, no instruction-following). Datasets, scripts,
  credentials, file paths, emails, workflow data and profiles are never sent.
- **Results:** strictly parsed, normalized, deduplicated, capped at 8, shown
  as a separate "AI suggestions (Gemini)" group with every suggestion
  unchecked; selected ones are appended to Keywords on Apply — nothing is
  ever auto-written, and manuscript text is never stored or logged anywhere.

## Not supported yet (future phases)

- OCR for scanned PDFs (a PDF without a text layer is refused, not imaged).
- Dataset ZIP inventory (auto-listing charts/datasets from an archive).
  Folder-based inventory over a file server is covered separately in
  `RCC_FOLDER_ANALYSIS.md`.
- LLM-assisted extraction, workflow generation, and any auto-publication —
  explicitly out of scope.
