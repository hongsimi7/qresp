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

```text
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

```text
curator selects candidates (nothing is selected by default)
  → "Enhance selected with AI"  (disabled until something is selected)
  → CONSENT DIALOG: states the count and the exact scope; the checkbox is
    unchecked, and is asked again for every request — never remembered
  → POST /api/curation/describe-candidates   (max 10 selected candidates)
      → allowlisted names/paths/local text → Gemini
  → proposals shown per candidate, labelled "AI suggestion", NOT applied
  → curator accepts a single field, or ignores it
  → "Add selected items to Curator" remains a separate, final action
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

A field is filled in **only when a file on the server proves it**. Everything
else is left blank, flagged in `needs_input`, and the reason is reported as
evidence. Generated-looking text is worse than an empty field: a curator
cannot tell "Qresp wrote this for you" from "someone checked this".

| Kind | Filled in (directly evidenced) | Left blank for the curator |
| --- | --- | --- |
| Chart | `imageFile`; `files` only from **same folder + exact basename**; `notebookFile` only when a `.ipynb` sits in the **same folder with the same basename** | `number`, `caption`, `properties` |
| Dataset | `files` (exact, grouped by directory) | `readme`; `URLs` stay empty (never invented) |
| Script | `files` | `readme` — a module docstring is shown as **evidence**, never copied into the description |
| Tool | `packageName` + `version` from a pinned manifest entry, a `module load pkg/version` line, or a README that states a version outright; `patches` only from real `.patch`/`.diff` files | `description`; `executableName` and `urls` unless a manifest states them |

### Evidence strength, per field

A single badge for a whole candidate would put an exact detected path and an
unguessable figure number on the same footing. Each candidate therefore
carries `field_evidence`:

| Label | Means |
| --- | --- |
| **High evidence** | A file directly states it — a detected path, a pinned manifest line |
| **Medium evidence** | A structural relationship a curator can verify at a glance — same folder, same basename |
| **Low evidence** | A filename-only hint. Never a field value |
| **Needs input** | Qresp cannot know it; the field is untouched |

`High evidence` is **deterministic-only**. AI suggestions carry their own
`AI suggestion: medium | low` label and can never reach it.

Filename material that does not meet the bar is reported under `Details` as
`filename_hints`, prefixed `Detected from filename (not verified metadata)`
or `Name-similar file, relationship not verified`. It is never written into
a field.

Specifically **never guessed**:

- **Figure number.** Not from discovery order, tab order, or filename order.
  Reordering the input cannot produce a number. A real figure number needs a
  manuscript mapping (`\includegraphics` → matching image path → nearby
  `\caption` → actual figure order); until that exists the field stays blank.
- **Chart caption.** Blank unless caption-like source text exists.
- **Chart properties.** Filename tokens (`embedded`, `Pb`, `dens`, `coord`,
  `figure`) appear as `Filename hints (not metadata): …` in Details and
  nowhere else. A token is a fact about a filename, not a property of a
  figure.
- **Dataset description.** No `"Files from <path>"`: it reads like a sentence
  a person wrote while saying nothing the file list did not already say.
- **Script description.** A docstring is written for a reader of the code;
  promoting it into curated metadata would make an author's aside look like
  approved documentation.

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

Every suggestion carries **`AI suggestion: medium | low`** and a one-line
reason naming the evidence it used. That label is deliberately a different
shape from the deterministic evidence chip, and **`high` is unreachable for
AI**: a model asserting high confidence about a filename is clamped to
`medium` server-side, because only a detected file can be high. No numeric
percentage is ever shown — a "92%" invites trust the evidence does not carry.

Acceptance is per field and explicit. A suggestion never lands in a field on
its own, and the accept button is **disabled while the curator's own text is
in that field** — an AI suggestion cannot overwrite something a person wrote.
Accepting a suggestion does not add the candidate to Curator; "Add selected
items to Curator" stays a separate final action.

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

## Folder organization guide

A **How to organize an RCC folder** button sits beside the File Server
actions. It opens a live folder-tree example drawn with the app's own icons
(not a bitmap of text, so it scales and the names stay selectable) plus a
short list of tips.

It is advice and nothing else: **no API, no persistence, no validation, no
score, and no effect on the analysis.** A folder that ignores every word is
analyzed exactly as before. It deliberately introduces **no YAML, JSON, or
Qresp-specific metadata file** — researchers should not have to create files
for Qresp in order to be understood. The tips point at ordinary artifacts
(`README.md`, `requirements.txt`, `environment.yml`) that already improve
software/version detection, warn against keeping secrets anywhere Qresp may
read, and state plainly that better organization still does not let Qresp
infer figure numbers, captions, properties, or versions without evidence.

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
