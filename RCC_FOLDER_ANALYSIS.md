# RCC Folder Analysis — assisted curation from a file-server folder

A curator who has selected and saved a File Server folder can analyze it and
get **reviewable candidates** for Charts, Datasets, Scripts and Tools. It is a
proposal step, not an import: nothing is auto-published, auto-saved, or
silently written.

## Where it lives

**Analyze RCC Folder** appears in both states of the File Server section, and
only one of them is mounted at a time, so there is never a duplicate button:

- while editing (`Where is the paper`), it analyzes the folder currently
  **selected** in the form — even before that selection is committed;
- on the saved **File Server Information** card, it analyzes the saved
  `fileServerPath`, so analysing an already-saved folder never requires
  clicking the pencil first.

Selecting and saving are deliberately separate steps. Confirming a folder in
the file tree ("Use Folder") only records the choice — it does not
write Curator state and does not close the section. **Save File Server** is
the only action that calls `setFileServerPath`. A search that is cancelled or
fails leaves an existing saved path and the current selection untouched.

There is deliberately **no second URL input** in either state: the browser
never supplies a fetchable location, and the backend validates whatever is
sent against its own allowed roots regardless.

## Data flow

```
selected (or saved) file server folder
  → POST /api/curation/analyze-folder   (authenticated, CSRF-protected)
      → path validated against the server's OWN allowed roots
      → bounded recursive autoindex listing
      → bounded evidence reads (manifests + script headers only)
      → deterministic classification
  → review dialog: Charts | Datasets | Scripts | Tools | Unclassified
  → curator selects / edits / removes
  → "Add selected items to Curator" → Curator state only
```

Optional, separate, consented:

```
selected candidates (max 10)
  → POST /api/curation/describe-candidates
      → allowlisted names/paths/local text → Gemini
  → proposals shown per candidate, NOT applied
  → curator accepts one into an editable field, or ignores it
```

## Endpoints

Both are authenticated (401 when anonymous) and CSRF-protected (403 without
`X-CSRF-Token`), and neither writes MongoDB, drafts, disk files, or published
metadata. `describe-candidates` touches persistence only through the existing
shared per-user AI usage counter (email/day/count — never request content).

| Route | Purpose |
| --- | --- |
| `POST /api/curation/analyze-folder` | `{path}` → deterministic candidates |
| `POST /api/curation/describe-candidates` | `{consent, items[]}` → AI descriptions/keywords |

### Candidate schema

```json
{
  "id": "chart-0",
  "kind": "chart",
  "confidence": "high | medium",
  "evidence": ["figures/figure1.png is a .png image"],
  "needs_input": ["caption", "number"],
  "paths": ["figures/figure1.png"],
  "proposal": { "...": "the fields of the matching Add form" }
}
```

`paths` and every path inside `proposal` are **normalized relative posix
paths** (no leading `/`, no scheme, no backslash) — the same convention
`Utils/Scraper.js`'s `node()` produces, so they are FileTree- and
form-compatible. Applied records match the manual Add forms' stored shape
exactly and stay fully editable.

## Deterministic vs. AI

**Everything below is deterministic. AI is never required.**

| Kind | Deterministic | Proposal the curator must confirm |
| --- | --- | --- |
| Chart | `imageFile` (`.png/.jpg/.jpeg/.gif`); `files` only from conservative basename/token matches, each shown as evidence; `notebookFile` only when a `.ipynb` with the same basename exists | `number` (a **sequence proposal**, not the paper's figure number), `caption` (blank, flagged), `properties` (filename tokens) |
| Dataset | `files` (exact, grouped by directory) | `readme` — a generic `"Files from data/short_traj"`; `URLs` stay empty (never invented) |
| Script | `files` (`.py/.ipynb/.sh/.bash/.R/.r/.jl/.m`); `readme` from the file's **own** module docstring or leading comment block when present | `readme` when no docstring exists (a plain `"Script plot_vdos.py"` placeholder, flagged) |
| Tool | `packageName` + `version` **only from a pinned manifest entry**; `patches` only from real `.patch`/`.diff` files | `description`; `executableName` and `urls` stay empty unless a manifest states them |

- `extraFields` are **never** auto-created for any kind.
- Manifests read: `requirements.txt`, `requirements.lock.txt`,
  `environment.yml(.yaml)`, `pyproject.toml`, `setup.py`, `package.json`,
  `package-lock.json`, `yarn.lock`, `qresp.ini`. An unpinned requirement
  (`scipy>=1.10`) is **not** a Tool.
- **Python imports are a hint, never a Tool.** An import name does not
  identify a distribution package, let alone a version, so imports surface
  only as a low-confidence "possible dependencies" note in the Tools tab.
- **No Experiment records are inferred** from folder names, titles, or AI.
- Files that match nothing land in **Unclassified** for manual handling.

### What the optional AI may and may not propose

The AI action runs only over candidates the curator has **selected**, and it
proposes **descriptive text only** — it never creates candidates, never
changes paths, and never fills a field by itself. Each proposal is shown on
its candidate card marked "not applied"; a field changes only when the curator
clicks to accept it, so nothing they typed is ever overwritten behind their
back.

| Kind | AI may propose | Accepted into |
| --- | --- | --- |
| Chart | description, keywords | `caption`, `properties` |
| Dataset | description, keywords | `readme` (keywords are informational — a dataset record has no keyword field) |
| Script | description, keywords | `readme` (same) |
| Tool | description only | `description` (keywords are dropped server-side) |

It may also offer a **second opinion on the classification**, constrained to
the four record types by the response schema. This is shown as a note on the
card, and only when the deterministic pass was itself unsure (confidence
below `high`) and the AI actually disagrees. Qresp never moves a candidate
between groups on its own — that would change a record the curator has not
reviewed — so acting on the note means removing the candidate and adding it
under the other tab by hand.

**Never touched by AI**, on any kind: `imageFile`, chart `number`, `files`,
`notebookFile`, `packageName`, `version`, `executableName`, `patches`, `urls`,
and any experiment facility or measurement. These are factual and the schema
sent back has no room for them. When the evidence is too thin the model is
instructed to return an empty description, and the candidate keeps its
`needs_input` flag rather than receiving a guess.

## Security limits

Path validation (all rejections happen **before** any request):

- The path must resolve inside a root configured on the server
  (`QRESP_FILESERVER_ROOTS`, comma-separated; default
  `https://notebook.rcc.uchicago.edu/files`). A relative path resolves against
  the first root; an absolute URL must match a root **including a `/`
  boundary**, so `…/filesXYZ` cannot pass as `…/files`.
- Rejected: another host, a lookalike host suffix, a scheme change (including
  `file:`/`ftp:`), credentials in the URL, a query string or fragment, `..`,
  percent-encoded traversal (`%2e%2e`), backslashes, and a nested scheme in a
  decoded path.

Bounded discovery (`truncated: true` plus a plain-language warning whenever a
cap is hit — the result is never silently partial):

| Cap | Value |
| --- | --- |
| Directory depth | 4 |
| Directory listings | 120 |
| Files inventoried | 2000 |
| Files read for evidence | 30 (manifests and scripts only) |
| Bytes per evidence read | 200 000 |
| Request timeout | 15 s |

Only manifests and non-notebook scripts are ever read. Datasets, images,
`.xyz`/`.h5`/`.cube`/`.dat` files and notebooks are classified **by name
only** — their bytes are never fetched.

A failing subfolder is skipped with a warning rather than failing the whole
analysis. Directory contents and source text are never logged: the analysis
log line carries counts only.

### RCC certificate behavior

The RCC host's certificate is currently expired, and the legacy `Dtree`
scraper (`project/util.py`) passes `verify=False` unconditionally. **That is
not inherited here.**

- TLS verification is **on by default** for every request this endpoint makes.
- A narrow opt-in exists for exactly that situation:
  `QRESP_FILESERVER_INSECURE_TLS_HOSTS` — a comma-separated **host** list.
- It is **environment only** (never `config.ini`, never a compose file),
  **default off**, **host-restricted** (a listed host does not relax any
  other), and **never browser-controllable**.
- Treat it as a temporary compatibility measure. The right fix is a valid
  certificate on the file server; when that lands, unset the variable.

### What can leave the server (AI action only)

Sent, per selected candidate, after an explicit consent checkbox that is
unchecked every time the dialog opens:

- `id`, `kind`, display `name`
- relative `paths` (absolute paths and anything with a scheme are dropped)
- `context`: text Qresp already extracted locally — docstrings/leading
  comments, manifest lines, README text, and the candidate's own evidence
  strings — clipped to 4000 characters

Never sent: binary datasets, raw `.xyz`/`.h5`/`.csv` contents, image bytes,
credentials/`.env`/keys, user profile, email or ownership data, and anything
outside the selected folder. At most 10 items per request, and only
candidates the curator has SELECTED.

The response is schema-constrained (`{"items":[{"id","description",
"keywords"}]}`), re-clipped server-side, and ids that were never sent are
discarded.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `QRESP_FILESERVER_ROOTS` | `https://notebook.rcc.uchicago.edu/files` | Roots the analyzer may read |
| `QRESP_FILESERVER_INSECURE_TLS_HOSTS` | *(empty — TLS verified)* | Hosts allowed to skip TLS verification |

The AI action adds **no new configuration**: it reuses `QRESP_GEMINI_ENABLED`,
`QRESP_GEMINI_API_KEY`, the model/timeout/quota variables and the shared
per-user daily limit documented in `MANUSCRIPT_IMPORT.md`. With Gemini
unconfigured the folder analysis still succeeds in full; only the AI action
reports `503 AI descriptions are not configured on this server.`

## Known limitations

- Listing relies on Apache-style autoindex markup (the same shape `Dtree`
  scrapes). A file server that renders a different index will list nothing,
  and the analysis reports an empty folder rather than guessing.
- File **size** and modification time are not read, so "big file" heuristics
  and change detection are not available.
- Chart↔data association is basename/token matching only. It is intentionally
  conservative: it will miss real relationships rather than assert wrong ones,
  and every match it does make is shown as evidence to verify.
- `number` is a sequence over discovered images sorted by path. It is not the
  figure number in the paper and is flagged as needing input.
- Datasets are grouped strictly by directory; a directory holding two
  unrelated data products becomes one candidate to split by hand.
- Notebook (`.ipynb`) contents are not parsed for descriptions — a notebook is
  classified as a script, and attached to a chart only on an exact basename
  match.
- Only pinned manifest entries become Tools, so a project that declares
  dependencies loosely yields no Tools at all (by design).
- Zenodo sources are out of scope; this path is for `http` file servers.
