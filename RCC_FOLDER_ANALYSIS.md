# RCC Folder Analysis — assisted curation from a file-server folder
> **This is the only place Qresp uses a language model.** Publication metadata
> comes from manual entry and the DOI registry; Qresp keywords are typed by the
> curator. Here, Gemini may propose a *description*, *keywords*, or a second
> opinion on an uncertain *kind* for candidates the curator explicitly selected
> — and nothing else. It never produces file paths, `imageFile`, `files`,
> `notebookFile`, figure numbers or package versions, and no AI output is ever
> saved or published without the curator accepting it item by item.


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

### Qresp Folder Standard v1

Classifying every file by extension is what produced hundreds of bogus
candidates. A paper folder already says where one record ends and the next
begins, so the analyzer reads its SHAPE instead.

```text
paper-folder/
  README.md
  main.ipynb
  datasets/
    dataset-id/
      ...
  charts/
    figure-id/
      preview.png
      notebook.ipynb
      data/
        ...
  scripts/
    script-id/
      ...
  tools/
    tool-id/
      ...
  docs/
    ...
```

- All five role folders are **optional**; use only what the paper needs.
- For new Qresp-managed folders the names are **exactly** `datasets`,
  `charts`, `scripts`, `tools`, `docs`, lowercase. The paper root name is
  unrestricted.
- **Each immediate child of `datasets/`, `scripts/` or `tools/` is ONE
  record**, and everything beneath it belongs to that record.
- A file placed directly under `datasets/` is one dataset on its own.
- In a chart folder, `preview.png` is the image, `notebook.ipynb` the
  notebook, `data/` the inputs. A chart folder holding several real figures
  is not a mistake: **a Chart is one IMAGE**, so the curator gives each image
  a role and a folder can produce several independent Charts (see *Choosing
  chart images by hand*).
- `docs/` is ignored entirely.
- **No YAML, JSON, metadata manifest or Qresp-specific file is ever
  required.** New artifact ids must be URL-safe (`[A-Za-z0-9._-]+`).

### Three modes

| Mode | When | Behavior |
| --- | --- | --- |
| **Qresp Standard** | every productive root is already an exact role name | deterministic immediate-child boundaries |
| **Legacy-compatible** | every productive root matches a known alias | same boundaries, plus a boundary picker for nested dataset/script trees |

The Charts section of the boundary panel is offered in **both** working modes,
because a standard layout still has to say which image in a folder is the
figure. A folder that needs reorganizing offers neither, and refuses a
submitted chart plan.
| **Needs reorganization** | any productive root is unknown | **no candidates and no extension guessing** — one grouped row per unsupported root, and Add is disabled |

Legacy aliases, matched case-insensitively. **Nothing on the file server is
ever renamed** — the mapping only says how to read it.

| Role | Aliases |
| --- | --- |
| datasets | data, datasets, dataset, raw_data, rawdata, raw-data, data_files, datafiles |
| charts | charts, chart, figures_tables, figures-tables, figurestables, figures, figure, figs, fig, plots |
| scripts | scripts, script, plot_scripts, plotscripts, postprocessing_scripts, code, codes, src |
| docs | doc, docs, documentation, tutorials, tutorial, manual |
| tools | tools, tool, software |

### Choosing record boundaries by hand

Legacy trees nest in ways only the author can resolve, so their dataset and
script roots come with a compact picker (folder names and file counts, never
a file list). One selected folder becomes exactly one record; selecting a
parent clears any descendant and vice versa, because the same file must not
land in two records. Nothing is selected by default, and **Rebuild proposals**
re-runs the analysis on the server — the browser never mutates candidates
itself.

```text
POST /api/curation/analyze-folder
{
  "path": "https://notebook.rcc.uchicago.edu/files/<paper>",
  "boundaries": {
    "data":    ["data/DFT/Figure2/espresso_calculation"],
    "scripts": ["scripts/analysis"]
  }
}
```

Every submitted path is validated server-side: it must be a relative POSIX
path **this analysis actually listed**, normalized, below the role root it was
submitted for, with no absolute path, URL, `..`, backslash or percent-encoding,
and no parent/descendant overlap. Duplicates collapse. Anything else is a
`400` with a plain reason. A selection replaces the defaults **only within its
own role root**; every other root keeps its deterministic children.

The response adds `structure_mode`, `structure_issues[]`, `normalized_roles`,
`boundary_trees`, `applied_boundaries`, `chart_image_groups`,
`applied_chart_plan` and `grouped_unclassified`. Unclassified files are
reported as grouped folder rows — path, file count, representative extensions
and a bounded name sample — never as a list of every path.

### Choosing chart images by hand

A Dataset or a Script boundary is a **folder**. A Chart is not: a Chart record
stores exactly **one** image, so its unit of choice is the image **file**. The
response therefore reports every chart image it discovered, grouped by the
folder it really sits in, so the browser never reconstructs that from a
candidate's internals:

```jsonc
"chart_image_groups": [
  {
    "folder": "figures_tables/figure_S1",
    "role_root": "figures_tables",
    "images": [
      { "path": "figures_tables/figure_S1/diagram.png",
        "reason": "image found in this chart folder",
        "suggested_action": "review" },
      { "path": "figures_tables/figure_S1/figure_S1.png",
        "reason": "filename matches the chart folder",
        "suggested_action": "chart" }
    ],
    "notebooks": [{ "path": "figures_tables/figure_S1/figure_S1.ipynb" }]
  }
]
```

`suggested_action` is advisory: `chart` only for the single image the
deterministic rule would have picked, `review` for every other image (which
stays visible and creates nothing until the curator decides). The curator's
decision travels back as `chart_plan`:

```text
POST /api/curation/analyze-folder
{
  "path": "https://notebook.rcc.uchicago.edu/files/<paper>",
  "boundaries": { "data": ["data/DFT"] },
  "chart_plan": [
    { "path": "figures_tables/figure_S1/figure_S1.png", "action": "chart" },
    { "path": "figures_tables/figure_S1/diagram.png", "action": "supporting",
      "target": "figures_tables/figure_S1/figure_S1.png" }
  ]
}
```

| action | result |
| --- | --- |
| `chart` | one independent Chart candidate whose `imageFile` is exactly that path |
| `supporting` | the image is appended to the target Chart's `files`, deduplicated |
| `ignore` | no candidate and no attachment |

Validated server-side before a single candidate is built: the path must be an
image **this analysis discovered**, relative, normalized POSIX (no URL,
absolute path, `..`, backslash or percent-encoding), the action must be one of
the three, no image may appear twice, and a `supporting` entry's target must be
an image in the **same folder** whose own action is `chart`. So an image can
never be both a Chart's own image and a supporting file, and no path lands in
two Chart records. Anything else is a `400` with a plain reason.

A plan applies **only to the folders it mentions**; a chart folder it does not
mention keeps its deterministic proposal, and omitting `chart_plan` entirely
keeps every default. `number`, `caption` and `properties` stay blank as always
— a figure number is never taken from discovery order — and a notebook is
attached only when its basename matches the image's, exactly or in case only.
Independent images become independent Chart proposals; relationships between
them belong in **Workflow**, not in a second image field.

A field is filled in **only when a file on the server proves it**. Everything
else is left blank, flagged in `needs_input`, and the reason is reported as
evidence. Generated-looking text is worse than an empty field: a curator
cannot tell "Qresp wrote this for you" from "someone checked this".

| Kind | Filled in (directly evidenced) | Left blank for the curator |
| --- | --- | --- |
| Chart | `imageFile` (one image, from the folder's own name or the curator's chart plan); `files` only from **same folder + exact basename**, plus any image the plan marked `supporting`; `notebookFile` only when a `.ipynb` sits in the **same folder with the same basename** | `number`, `caption`, `properties` |
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

## Chart images

A chart renders as the paper's `fileServerPath` joined to the chart's
relative `imageFile`. That join used to be `server + "/" + imageFile` at four
call sites, which broke three ways:

- **No saved path.** Analysis runs on the *selected* folder, so a chart could
  be applied before **Save File Server**. `"" + "/" + "figures/x.png"` is a
  path on the Qresp origin — a silent 404 and a blank figure. This was the
  main cause.
- **Inconsistent leading slash.** `Utils/Scraper.node` strips the server
  prefix from a manually picked file and leaves `/figures/x.png`, so manual
  charts produced `…/DOI//figures/x.png` while analyzed ones did not.
- **No encoding.** Spaces and `#` in real folder names broke the URL.

`Utils/fileServerUrl.buildFileUrl` now owns the join: it trims separators,
encodes each segment (without double-encoding), and returns `""` when it
cannot build a real absolute URL. Callers render an explicit message instead
of a broken `<img>`, and an `onError` handler labels a URL that is correct
but unreachable. Applying candidates whose analyzed folder is not the saved
path also warns at that moment. No proxy was added and no TLS behavior
changed — the browser fetches the file server directly, as before.

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
per-user daily limit. With Gemini
unconfigured the folder analysis still succeeds in full; only the AI action
reports `503 AI descriptions are not configured on this server.`

### Recommended values for a server that runs folder analysis

```
QRESP_GEMINI_TIMEOUT_SECONDS=45
QRESP_GEMINI_MAX_OUTPUT_TOKENS=2048
```

A keyword request fits comfortably in 256 output tokens; a batch of folder
candidates does not. Eight candidates of JSON overran the old cap, came back
`finishReason=MAX_TOKENS`, and the truncated answer then failed to parse —
and because the configuration ceiling was itself 256, raising the environment
variable changed nothing. The ceiling is 2048 now, and the request asks for a
budget scaled to the number of candidates rather than a fixed number.

15 seconds is tight for a batch on a busy provider; 45 leaves room without
letting a worker hang (the hard ceiling stays 60). Nothing retries
automatically: a retried call would consume the user's daily quota twice for
one action.

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
