# Auto-Curation Lite (Phase 1) — DOI Lookup & Manuscript Source Import

The curator's **Import Manuscript Source** action proposes draft metadata
from either a pasted **DOI** or an uploaded **manuscript source** (a `.tex`
file or a `.zip` exported from Overleaf). It is a *proposal* tool: every
value goes through a review dialog, the user picks which fields to apply,
and nothing is ever published or overwritten automatically. The existing
**Upload Metadata** (JSON) workflow is unchanged and unrelated.

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
- From the DOI registry (Crossref, short timeout): title, authors, journal,
  year, volume, issue, pages, abstract, DOI, URL, and subject keywords.
  Missing optional metadata never fails the lookup.
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

## Not supported yet (future phases)

- PDF import / OCR.
- Dataset ZIP inventory (auto-listing charts/datasets from an archive).
- LLM-assisted extraction, workflow generation, and any auto-publication —
  explicitly out of scope.
