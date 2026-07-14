# Auto-Curation Lite (Phase 1) — DOI Lookup & Manuscript Source Import

The **Import information for this paper** area inside the curator's
**Add info about your paper** section proposes metadata for the PRIMARY
paper being curated, from either a pasted **DOI** ("Fetch DOI") or an
uploaded **manuscript source** ("Import manuscript source": a `.tex` file or
a `.zip` exported from Overleaf). It is a *proposal* tool: every value goes
through a review dialog, the user picks which fields to apply, and nothing
is ever published or overwritten automatically. The import writes through
the primary-paper adapter (`frontend/Utils/primaryPaper.js`) — the separate
**Add Reference to your paper** form is never its destination, and the
existing **Upload Metadata** (JSON) workflow is unchanged and unrelated.

## Data flow (final)

- **`publicationInfo`** (curator state) = the PRIMARY paper's bibliography
  (kind/title/authors/doi/publication/year/url/abstract), edited inside
  "Add info about your paper" and the only import destination. On
  publish/update it serializes into the legacy **`reference`** block — the
  field search, paper details, publish validation and dedup already read —
  so nothing downstream changes and no records are migrated.
- **`referenceInfo`** (curator state) = the separate CITED work behind
  "Add Reference to your paper". It persists as the optional
  **`citedReference`** block (omitted when empty; the publish schema allows
  additional properties), and is NEVER touched by primary-paper import.
- **Loading**: `reference` → `publicationInfo` (every legacy record reads
  correctly); `citedReference` → `referenceInfo` (empty on legacy records,
  which never had a separate citation). Legacy DRAFTS/metadata exports
  (which stored the primary bibliography in `referenceInfo`) are migrated on
  load: their data moves to `publicationInfo` and the cited-work slot starts
  empty.
- PIs, PaperStack/collections, keywords/tags, and the notebook file remain
  manual Paper-Information fields: import appends tags only when explicitly
  selected, copies authors into PIs only via the explicit
  "Use imported authors as Principal Investigators" opt-in (default
  unchecked), and can never write collections/notebook/file-server/sections/
  workflow/license/documentation/curator identity.

## Supported inputs

- A DOI (bare `10.…`, `doi:` prefix, or `https://doi.org/…` URL).
- A single `.tex` file (UTF-8; up to 10 MB upload, 2 MB of TeX inspected).
- An Overleaf project `.zip` export. The likely main file is chosen by
  scoring `\documentclass` / `\begin{document}`; in-archive
  `\input`/`\include` files are read (bounded depth/count); `.bib` files are
  scanned for DOI **candidates** (these are references, not necessarily this
  work's DOI, so they are listed for the user rather than auto-used).

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

## Not supported yet (future phases)

- PDF import / OCR.
- Dataset ZIP inventory (auto-listing charts/datasets from an archive).
- LLM-assisted extraction, workflow generation, and any auto-publication —
  explicitly out of scope.
