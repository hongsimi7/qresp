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

| Kind | Description field | Keyword field |
| --- | --- | --- |
| Chart | `caption` | `properties` |
| Dataset | `readme` | `keywords` |
| Script | `readme` | `keywords` |
| Tool | `readme` | **none** — a Tool has no keyword field |

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

- Paths are normalized to POSIX, lower-cased, with `./`, leading `/`,
  duplicate slashes, trailing slashes and any `?`/`#` suffix removed.
  Backslashes become forward slashes.
- A Chart also matches on its `imageFile` and `notebookFile`; Datasets,
  Scripts and Tools match on `files`.
- The candidate's kind must match the artifact's kind.

**Fuzzy matching is refused outright.** Titles and basenames are never
compared: `figure2.png` appears in half the records on a server, and scoring
an AI description against somebody else's figure would produce a number that
means nothing. A candidate that matches nothing, matches more than one
artifact, or has no usable path is **excluded and reported with its reason**
(`no_artifact_with_this_exact_path`, `path_matches_more_than_one_artifact`,
`candidate_has_no_usable_path`).

---

## A contract gap the benchmark exposes

Tracing the code turned up a live mismatch between where curators **store**
artifact text and which keys the keyword AI **reads**:

| Kind | Curator/model field | `assist.CONTEXT_FIELDS` reads | Reaches the model? |
| --- | --- | --- | --- |
| Chart | `caption`, `properties` | `caption`, `properties` | ✅ |
| Dataset | `readme`, `keywords` | `description`, `keywords` | ❌ description lost |
| Script | `readme`, `keywords` | `description`, `keywords` | ❌ description lost |
| Tool | `facilityName` | `facility` | ❌ facility lost |

`frontend/components/CuratorElements/KeywordAssist.js` mirrors the same
names, so the values never leave the browser either. The benchmark **models
the product as it actually is** — it sends the stored field names through the
product's own reducer and lets them be dropped — and reports the loss under
`keyword_context_gaps` in `audit.json` and `keyword-summary.json`.

**Read `publication_plus_artifacts` with this in mind:** for datasets and
scripts, that mode currently adds their *keywords* but not their
*descriptions*. This document does not propose a fix; changing what is sent
would change served behaviour, which is out of scope for a benchmark.

---

## Running it (Windows PowerShell)

Everything below is read-only. Steps 1–4 make **zero** provider calls.

### 0. The API key — environment only

```powershell
# Session-scoped. Never written to a file, never echoed, never committed.
$env:QRESP_GEMINI_ENABLED = "1"
$env:QRESP_GEMINI_API_KEY = Read-Host -AsSecureString | `
    ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }

# Confirm it is set WITHOUT printing it:
[bool]$env:QRESP_GEMINI_API_KEY
```

The tool reports the key only as a boolean (`provider configured True`). Keys,
headers, prompts and payload bodies never reach stdout or any output file.

### 1. Collect (no AI call)

```powershell
cd C:\Users\hongs\Desktop\qresp_from_server\backend

python -m project.tools.assist_eval collect `
  --api-base https://<a-qresp-instance> `
  --output-dir ..\assist-eval-out
```

Optional: restrict to specific records with `--ids-file ids.txt` (UTF-8 with
or without a BOM, LF or CRLF — both are read safely).

To include the RCC benchmark, supply analyses the curator already saved:

```powershell
python -m project.tools.assist_eval collect `
  --api-base https://<a-qresp-instance> `
  --output-dir ..\assist-eval-out `
  --rcc-analyses ..\rcc-analyses
```

`--rcc-analyses` takes one JSON file `{record_id: <analyze-folder response>}`
or a directory of `<record_id>.json`. **No file server is contacted** —
`analyze-folder` needs a curator session and a CSRF token, and a QA tool has
no business holding either.

### 2. Audit — coverage and the true cost of a full run

```powershell
python -m project.tools.assist_eval audit --output-dir ..\assist-eval-out
```

Prints record and unit counts, the RCC exclusion reasons, the
`keyword_context_gaps` table, and
`full_corpus_provider_calls_if_unsampled` — **the number of Gemini calls a
whole-corpus run would cost.** Read it before going further.

### 3. Smoke sample — deterministic, seeded, still no AI call

```powershell
python -m project.tools.assist_eval smoke-sample `
  --output-dir ..\assist-eval-out --seed 0
```

Defaults to **5 keyword records × 2 modes = 10 calls** and **10 RCC
candidates = 10 calls**; `planned_provider_calls` is printed. The same seed
always yields the same sample. Adjust with `--keyword-records` and
`--artifact-candidates`.

### 4. Dry run — the exact call count, still nothing sent

```powershell
python -m project.tools.assist_eval run --output-dir ..\assist-eval-out
```

Prints `provider configured`, `units planned`, `already cached` and
`planned_provider_calls`, runs the leakage checks, and stops. Without
`--execute` the provider function is replaced by a stand-in that raises, so a
call cannot happen even by mistake.

### 5. The real, limited run

```powershell
python -m project.tools.assist_eval run `
  --output-dir ..\assist-eval-out --execute --rate-limit 0.5
```

- One provider call per unit; requests are paced (default 0.5/s).
- Every successful answer is cached by **model + prompt + input
  fingerprint**, so a re-run costs nothing and an interrupted run resumes.
- A failure is recorded and the run continues.
- `--max-calls` (default 40) refuses a run that would cost more than expected.
- A whole-corpus run needs `--keyword-records`/`--artifact-candidates` raised
  **and** `--max-calls` raised: it cannot happen by accident.

### 6. Summarize — cached answers only, zero provider calls

```powershell
python -m project.tools.assist_eval summarize --output-dir ..\assist-eval-out
```

---

## Outputs

| File | Contents |
| --- | --- |
| `raw-records.jsonl` | one line per record: bibliography, hidden `reference_tags`, human artifacts, RCC candidates |
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
- **RCC coverage depends on saved analyses.** Without `--rcc-analyses` only
  the keyword benchmark runs.
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
