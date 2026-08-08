# AI assist evaluation — offline benchmarks for Qresp's two AI features

> **AI-based provisional evaluation. NOT expert ground truth, NOT validated,
> NOT verified.** Everything this tool produces is triage: a way to decide
> which twenty or thirty suggestions a domain expert should read first. No
> number here justifies changing a prompt, a threshold or any served
> behaviour on its own.

Qresp uses a language model in exactly two places, both opt-in and
suggestion-only:

| Feature | Endpoint | Code |
| --- | --- | --- |
| Paper keyword suggestions | `POST /api/assist/keywords` | `backend/project/assist.py` |
| RCC artifact descriptions/keywords | `POST /api/curation/describe-candidates` | `backend/project/curation.py` |

`backend/project/tools/assist_eval.py` benchmarks both. It is a QA command
line, not an endpoint: it is not in `swagger.yml`, not reachable over HTTP,
and never writes to MongoDB, a draft, a published record, the serving cache
or the per-user quota counter.

---

## What each benchmark asks

### 1. Paper keywords

Hide a record's own `tags`, run the keyword AI on the inputs the product
allows, and compare the suggestions with the hidden tags — in two modes:

- **`publication_only`** — kind, title, abstract, publication, DOI, year.
- **`publication_plus_artifacts`** — the above plus the reviewed
  Chart/Dataset/Script/Tool metadata, reduced by the product's own
  `assist._reviewed_context` with the product's own field allowlist, item cap
  and character budget.

### 2. RCC artifact descriptions

Pair an RCC candidate with the human-authored artifact for the **same file**,
hide the human text, and send only what the product would send — one
candidate per call, through the product's own `curation._sanitize_ai_items`.

| Kind | Description field | Keyword field | Other |
| --- | --- | --- | --- |
| Chart | `caption` | `properties` | — |
| Dataset | `readme` | `keywords` | — |
| Script | `readme` | `keywords` | — |
| Tool | `description` | **none** — a Tool has no keyword field | `packageName`, `facilityName`, `measurement` |

These are the CANONICAL names, traced through `models.py`, `schema.json`,
`ToolsInfoForm.js` and a real published record
(`backend/project/tests/data.json`). A Tool is the one that surprises: the
mongoengine model declares `readme`/`facilityname`, but `Tools` is a
`DynamicEmbeddedDocument` with `strict: False`, so what the curator submits
(`description`/`facilityName`, per `schema.json`) is what is stored and what
`/api/paper/{id}` returns.

**Charts are the case to watch.** The description AI receives no image bytes
and no paper text. A confident caption for a figure it cannot see is a
failure, not a success; **abstaining is the correct behaviour**, and the
summary measures the abstention rate rather than penalising it.

---

## What "reference" means, and what it does not

The existing curation is a **reference**, not an answer key.

- A curator's tag is one defensible choice among several. A suggestion that
  misses it is not thereby wrong.
- **Exact string matching is a LOWER BOUND.** `DFT` and `density functional
  theory` are the same answer and score zero against each other; so do
  `photovoltaics` and `solar cells`. No synonym dictionary is hardcoded —
  deciding those pairs are equivalent is a domain judgement, and a benchmark
  that guessed at it would be inventing its own answer key. Only case,
  spacing and singular/plural are folded (`normalized_concept_hits`).
- Description similarity is **resemblance**, not correctness. Two good
  descriptions of one dataset can share very few words.
- **Same-model self-evaluation bias.** Where the same Gemini both produced a
  suggestion and would judge it, the judgement leans toward itself. Treat
  agreement as weak evidence and disagreement as the interesting signal.

---

## How data leakage is prevented

The record being scored must not be able to see its own answer.

1. **Leave-one-out vocabulary.** The product builds `qresp_vocabulary` from
   every active record's tags. The benchmark rebuilds it with the record
   under evaluation removed, so a tag only that record carries is gone. A tag
   **another** record also uses legitimately stays — it is genuinely part of
   the site's language, and deleting it would model a Qresp that does not
   exist.
2. **Artifact keywords that repeat a held-out tag are withheld.** Curators
   often reuse a paper tag in a chart's `properties`; handing that to the
   model would hand it the answer. Those exact values are dropped and counted
   (`count_hidden_artifact_keywords`), because it makes the artifacts mode
   slightly weaker than production.
3. **The paper's own title and abstract are NOT treated as leakage.** A tag
   readable from the abstract is exactly what the keyword AI is for; excluding
   such records would leave only papers whose tags are unguessable.
4. **The RCC target text is stripped from the evidence.** The human
   description and keywords are removed from `context` before the payload is
   built.
5. **Checked again before any call.** `run` refuses, with a non-zero exit,
   if any planned payload still carries a label it should not — before a
   single provider request is made.

---

## Matching an RCC candidate to a human artifact

**Exact relative-path identity only.**

**Case is preserved.** RCC serves Linux paths, where `Figure.png` and
`figure.png` are two different files. Folding case would let the benchmark
score an AI description against the wrong file and never show a symptom.

Normalization is limited to spellings of the same name:

- Windows `\` becomes `/` (a spelling of the same separator);
- leading `./`, duplicate `/` and a trailing `/` are removed.

Nothing else. In particular **no lower-casing, no basename fallback, no stem
match, no title similarity.**

These shapes are not relative paths inside the record's folder and are
**refused with their own reason** rather than cleaned up:

| Shape | Reason code |
| --- | --- |
| `https://…` | `path_is_a_url` |
| `/abs/path`, `C:\path` | `path_is_absolute` |
| `../escape` | `path_contains_a_parent_reference` |
| `file.dat?v=2`, `file.dat#top` | `path_carries_a_query_or_fragment` |
| `dir%2Ffile.dat` | `path_is_percent_encoded` |

A Chart also matches on its `imageFile` and `notebookFile`; Datasets, Scripts
and Tools match on `files`. The candidate's kind must match the artifact's.

Other exclusions, all auditable:

| Reason code | Meaning |
| --- | --- |
| `no_artifact_with_this_exact_path` | nothing in the record has that path |
| `path_case_mismatch` | something matches **only** if case is ignored — on a case-sensitive server that is a different file, so it is refused and reported separately |
| `path_matches_more_than_one_artifact` | ambiguous; never resolved by picking one |
| `candidate_has_no_usable_path` | no path at all |

---

## The contract gap this benchmark found — now fixed

Tracing the code for the benchmark turned up a live mismatch between where
curators **store** artifact text and which keys the keyword AI **read**. The
values never reached the model at all:

| Kind | Canonical field | Old allowlist read | Was it sent? |
| --- | --- | --- | --- |
| Chart | `caption`, `properties` | `caption`, `properties` | ✅ |
| Dataset | `readme` | `description` | ❌ lost |
| Script | `readme` | `description` | ❌ lost |
| Tool | `facilityName` | `facility` | ❌ lost |
| Tool | `description` | `description` | ✅ |

`KeywordAssist.js` carried the same wrong names, so the values never left the
browser either — and the button's eligibility check used the same list, so it
could light up for a dataset whose text would then not be sent.

**Fixed.** The frontend now sends the canonical names, and the backend
resolves them itself:

```
kind -> {AI payload field: (accepted input names, best first)}
```

| Payload field | Accepted input, canonical first |
| --- | --- |
| `charts.caption` | `caption` |
| `charts.properties` | `properties` |
| `datasets.description` / `scripts.description` | `readme`, then legacy `description` |
| `datasets.keywords` / `scripts.keywords` | `keywords` |
| `tools.packageName` | `packageName` |
| `tools.description` | `description`, then legacy `readme` |
| `tools.facility` | `facilityName`, then legacy `facilityname`, `facility` |
| `tools.measurement` | `measurement` |

The payload field names the model sees are unchanged. The canonical value
always wins over a legacy alias, the same text is never sent twice under two
names, and the server does not trust the client to have picked correctly. The
length, item and context budgets are untouched.

`keyword_context_gaps` still computes the loss by pushing each record through
the product's own reducer — it is not hardcoded to zero, so if the two sides
drift apart again the audit will say so.

---

## Running it (Windows PowerShell)

All commands use the repository venv. Steps 1-7 make **zero Gemini calls**.

### 0. The API key — environment only

```powershell
$env:QRESP_GEMINI_ENABLED = "1"
$env:QRESP_GEMINI_API_KEY = "<paste the key>"

# Confirm it is set WITHOUT printing it:
[bool]$env:QRESP_GEMINI_API_KEY
```

The tool reports the key only as a boolean (`provider configured True`). Keys,
headers, prompts and payload bodies never reach stdout or any output file.

```powershell
cd C:\Users\hongs\Desktop\qresp_from_server\backend
```

### 1. `collect` — read the Qresp instance

Dry run first; nothing is requested without `--execute`.

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval collect `
  --api-base https://<a-qresp-instance> --output-dir ..\assist-eval-out

.\venv\Scripts\python.exe -m project.tools.assist_eval collect `
  --api-base https://<a-qresp-instance> --output-dir ..\assist-eval-out --execute
```

Optional `--ids-file ids.txt`, read as `utf-8-sig` so a BOM is harmless.
Write it as ASCII to avoid the question entirely:

```powershell
"rec1","rec2" | Set-Content -Encoding ascii ..\assist-eval-ids.txt
```

### 2. `audit` — coverage and the true cost of a full run

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval audit `
  --output-dir ..\assist-eval-out
```

Reports `keyword_units`, `artifact_units` and
`full_corpus_provider_calls_if_unsampled` — what a whole-corpus run would
cost. At this point `artifact_units` is **0**: no RCC analysis exists yet.

### 3. `collect-rcc` — dry run

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval collect-rcc `
  --output-dir ..\assist-eval-out
```

Prints `rcc_folders_to_read` and contacts **no file server**.

### 4. `collect-rcc --execute` — read the folders

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval collect-rcc `
  --output-dir ..\assist-eval-out --execute --limit 10 --rate-limit 0.5
```

Runs the **serving** analysis pipeline per record: `resolve_folder_url` (host
allowlist, scheme and traversal rejection) then `tls_exception_scope`, then
`walk_folder` (bounded listing), then bounded evidence reads, then
`analyze_folder_tree` with default boundaries and no chart plan. **No Gemini,
no quota, no Mongo, no draft, no publish.** A folder that cannot be read is
one record's problem; the run continues. Results land in
`..\assist-eval-out\rcc-analyses\<record_id>.json` and are reused next time
unless `--refresh` is given.

### 5. `audit` again — now with artifacts

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval audit `
  --output-dir ..\assist-eval-out
```

`artifact_units` should now be non-zero. If it is still 0 the artifact
benchmark will make **0 calls**, and the tool says so rather than implying ten.

### 6. `smoke-sample` — deterministic, seeded, no AI call

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval smoke-sample `
  --output-dir ..\assist-eval-out --seed 0
```

| Benchmark | Default sample | Calls |
| --- | --- | --- |
| Keyword | 5 records x 2 modes | **10** |
| RCC artifact | 10 candidates | **10** (0 with no RCC analysis) |
| | **planned_provider_calls** | **20** (or 10) |

Adjust with `--keyword-records` and `--artifact-candidates`.

### 7. `run` — dry run

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval run `
  --output-dir ..\assist-eval-out
```

Prints `planned_provider_calls`, runs the leakage checks, sends nothing.
Without `--execute` the provider function is replaced by a stand-in that
raises, so a call cannot happen by mistake.

### 8. `run --execute` — the real, limited run

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval run `
  --output-dir ..\assist-eval-out --execute --rate-limit 0.5
```

One call per unit, paced. Answers are cached by **model + prompt + input
fingerprint**, so a re-run costs nothing and an interrupted run resumes.
`--max-calls` (default 40) refuses a run costing more than expected.

### 9. `summarize` — cached answers only, zero calls

```powershell
.\venv\Scripts\python.exe -m project.tools.assist_eval summarize `
  --output-dir ..\assist-eval-out
```

---

## Outputs

| File | Contents |
| --- | --- |
| `raw-records.jsonl` | one line per record: bibliography, hidden `reference_tags`, human artifacts |
| `rcc-analyses/<record_id>.json` | one saved folder analysis per record, written by `collect-rcc` and read by every later step |
| `audit.json` | coverage, exclusion reasons, context gaps, full-corpus call estimate |
| `smoke-sample.json` | the seeded sample and `planned_provider_calls` |
| `provider-cache.jsonl` | one line per call: fingerprint, outcome, raw answer. **No key, no header, no prompt.** |
| `keyword-summary.json` | per-mode coverage, empty-result rate, exact P/R/F1@8, vocabulary reuse, duplicate rate, generic-keyword review list, artifacts-mode delta |
| `artifact-summary.json` | per-kind counts, abstention rate, similarity, type-contract violations, forbidden-field generations, unsupported-claim review, boilerplate repetition |
| `keyword-review.tsv` | one row per unit, `expert_rating` blank |
| `artifact-review.tsv` | one row per candidate, `expert_rating` blank |
| `expert-review.tsv` | ≤ 30 flagged rows — the short list worth a human's time |

`expert_rating` is always written **blank**. No AI fills it in.

---

## Known limitations

- **Chart evidence.** The model gets neither image bytes nor paper text, so a
  Chart benchmark mostly measures whether it abstains honestly.
- **RCC coverage depends on `collect-rcc`.** Until it has run with
  `--execute`, `artifact_units` is 0 and only the keyword benchmark has
  anything to do. The audit and the sample both say so explicitly rather than
  implying calls that will not happen.
- **`collect-rcc` needs the file server reachable from this machine** and
  obeys `QRESP_FILESERVER_ROOTS`; a record whose `fileServerPath` is outside
  the allowlist is refused by the serving resolver, exactly as it would be
  for a curator.
- **Exact match understates recall**, as above. `normalized_concept_hits`
  folds only case, spacing and plurals.
- **The artifacts mode is handicapped twice**: by the field-name gap above,
  and by withholding artifact keywords that repeat a held-out tag.
- **`unsupported_claim_terms` is a heuristic.** Legitimate paraphrase shows
  up there; it is a review list, not a verdict.
- **Nothing here is expert-validated.** The minimum a domain expert should
  read before any conclusion is drawn: the ≤ 30 rows in
  `expert-review.tsv`, and within them at least a few of each kind — chart,
  dataset, script, tool — and both keyword modes for the same record.
