# Related Literature Explorer — Related Research on Paper Details

> **No language model is involved anywhere in this feature.** No Gemini,
> OpenAI, Kimi or Qwen call is made, and none is added. Candidates come from
> the free Semantic Scholar Recommendations API; every ordering, every
> threshold and every "Why related" sentence is computed deterministically by
> Qresp from the two records' own published scientific metadata.

A visitor reading a record's detail page gets, at the bottom of the page, two
independent lists:

- **Related Qresp Records** — other active, published records on this server.
- **Related External Papers** — papers proposed by Semantic Scholar that then
  passed Qresp's own quality gate.

Both are computed **at view time**, never pinned into the record. Nothing is
written to the `Paper` document at curation, publish, or read time.

**Off by default.** Without `QRESP_RELATED_RESEARCH_ENABLED` the endpoint
answers `enabled: false` and the section does not render at all — the detail
page is byte-for-byte what it was before.

---

## Where it lives

| Layer | File |
| --- | --- |
| Pure scoring, evidence, quality gate | `backend/project/relatedness.py` |
| Endpoint, provider call, cache | `backend/project/related.py` |
| Cache document | `backend/project/models.py` (`RelatedResearchCache`) |
| API contract | `backend/project/swagger.yml` |
| Rate limit | `nginx/default.conf` (`api_related` zone) |
| UI section | `frontend/components/Paper/RelatedResearch.js` |
| Page wiring | `frontend/pages/paperdetails/[id].js` |

`relatedness.py` is **pure**: no database, no network, no clock, no
environment. That is what makes the thresholds testable and what keeps the
scoring honest — it cannot reach for anything it was not handed.

---

## API contract

```http
GET /api/paper/{id}/related        (public, read-only, no CSRF, no session)
```

**200** — always, when the record is visible:

```jsonc
{
  "paper_id": "5f2b…",
  "enabled": true,
  "internal": {
    "status": "ok",
    "count": 2,
    "results": [
      {
        "id": "5f2c…",                     // Qresp record id; null for external
        "title": "…",
        "authors": "A. One, B. Two",       // "et al." past 8 names
        "year": 2018,
        "doi": "10.1038/…",                // null when unknown
        "url": null,                       // internal results link by id
        "source": "internal",
        "reasons": ["…", "…"]              // 0–3, grounded, never model-written
      }
    ]
  },
  "external": {
    "status": "ok",                        // ok | disabled | unresolved | unavailable
    "provider": "Semantic Scholar",
    "count": 1,
    "stale": false,                        // true => last successful results, refresh failed
    "updated_at": "2026-08-01T09:12:00",   // last SUCCESSFUL fetch, or null
    "results": [
      {
        "id": null,
        "title": "…",
        "authors": "…",
        "year": 2020,
        "doi": "10.1021/…",
        "url": "https://doi.org/10.1021/…", // HTTPS DOI preferred
        "source": "external",
        "reasons": ["…"]
      }
    ]
  }
}
```

**404** — `{"error": "This record is not available."}` for a record that does
not exist, an unparseable id, and a deactivated record whose viewer is not its
owner/editor/admin. The same body and status for all three: a related lookup
must not become an existence probe. This matches the details API's policy for
deactivated records (`GET /api/paper/{id}` answers 404 with the same message)
and the 404 the other paper sub-resources (`/permissions`, `/raw`) already use.

Each list is capped at **5** and is **never padded**. Both may be empty; that
is a correct answer, not a failure.

### External statuses

| status | meaning | UI |
| --- | --- | --- |
| `ok` | the provider answered (possibly with an empty list) | results, or the empty message |
| `disabled` | feature switch is off | "External recommendations are turned off on this server." |
| `unresolved` | the provider answered **"no such paper"**, or the title match was not close enough to trust | "This record could not be matched in the external index…" |
| `unavailable` | the provider **did not answer**: timeout, connection error, 429, 5xx, unreadable body, unexpected shape | "External recommendations are unavailable right now. The Qresp results above are unaffected." |

`stale: true` is orthogonal: results that came from an earlier success but are
being served under a non-`ok` status are always flagged, whether they come
from the refresh path or from the failure-retry window.

### Provider outcome → status → how long it is kept

Every provider call resolves to one of three outcomes, and **only the middle
column is a fact about the record**:

| Provider call result | Outcome | Status | Cached for |
| --- | --- | --- | --- |
| 200, usable body | `FOUND` | `ok` | full TTL (7 days) |
| **404**, or a well-formed answer naming no paper, or a title match below 90 % | `NOT_FOUND` | `unresolved` | full TTL (7 days) |
| timeout, connection error, **429**, 5xx, unreadable body, non-object body, 200 without `recommendedPapers` | `UNAVAILABLE` | `unavailable` | **1 hour** (`FAILURE_RETRY_SECONDS`) |

Both lookup paths (DOI resolution and title match) and the recommendations
call report all three independently.

> **Why this split exists.** These used to be collapsed: *any* failure came
> back as "not in the provider's index" and was cached for seven days. A
> single timeout or one 429 from the shared keyless pool therefore turned into
> a durable, wrong claim about the record, and the section stayed empty for a
> week after a momentary blip. A non-answer now expires within the hour and
> never overwrites a good answer.

---

## Internal recommendations

Computed live on every request over `active_papers()` (records that are
explicitly active or predate the flag), so a publish or a deactivation is
reflected **immediately** — there is no internal cache to invalidate.

### What is read

- `reference.title` (weighted ×2 — a title word carries more signal than an
  abstract word), `reference.publishedAbstract`, `reference.authors`
- `tags` (paper keywords)
- `collections` — as a **broad field only**, never as a specific term
- Chart `caption` and `properties`
- Dataset / Script `keywords` and `readme`
- Tool `packageName`, `programName`, `facilityname`/`facilityName`,
  `measurement`, `readme`

### What is never read, scored, cached, or sent

RCC URLs and file paths (`info.serverPath`, `fileServerPath`,
`folderAbsolutePath`, `downloadPath`, `notebookPath`), any file listing or file
content, image/notebook/data bytes, `owner_email`, `editor_emails`,
`info.insertedBy` (curator name/email/affiliation), `edit_history`, drafts,
sessions, CSRF tokens, secrets, and any private or deactivated record. These
fields are not loaded into the `Profile` object at all, which is enforced by
`TestProfileScope.test_only_scientific_metadata_is_read`.

---

## External recommendations

### Identifying this paper

1. **DOI first.** `GET /graph/v1/paper/DOI:<doi>` with
   `fields=paperId,title,externalIds`. A DOI is exact, so no confirmation is
   needed.
2. **No DOI → official title match.** `GET /graph/v1/paper/search/match?query=<title>`
   with `fields=paperId,title,externalIds`, and the answer is then checked
   **against the stored title here**: at least 90 % token overlap
   (`TITLE_MATCH_MIN_OVERLAP`). Below that the external list is skipped with
   `unresolved` — recommendations built from somebody else's paper are worse
   than none.
3. **Recommendations.** `GET /recommendations/v1/papers/forpaper/<paperId>`
   with `limit=20` and
   `fields=title,abstract,year,authors.name,externalIds,fieldsOfStudy` — the
   minimum the quality gate needs (text for similarity and shared terms,
   authors for the shared-author signal, year for display/ordering,
   `externalIds` for the DOI link and de-duplication, `fieldsOfStudy` for the
   "same research area" check). No venue, no citation counts, no embeddings.
   No `from` parameter, so the provider's default pool is used.

> ### Correction — the provider DOES cover Qresp's domains
>
> An earlier note here claimed the Recommendations API returns nothing usable
> for Qresp records, based on two hand-picked DOIs. **That generalization was
> wrong**, and a proper sample overturned it. Over 18 real records from a
> public Qresp instance:
>
> | Pool | Records with candidates | Candidates | Gate pass rate |
> | --- | --- | --- | --- |
> | `recommendations_default` (what production uses) | 15 / 18 (83 %) | 300 | 74 % |
> | `recommendations_all_cs` | 18 / 18 (100 %) | 347 | 58 % |
> | `title_resolution` | 13 / 18 (72 %) | 260 | 75 % |
>
> The candidates are on-topic, not Computer Science strays — the `all-cs`
> pool returned, for example, quantum-embedding papers against a
> quantum-embedding record. The lesson is about method, not the provider: two
> DOIs are an anecdote, and the reason the evaluation CLI below exists is so
> claims like this are made from a sample instead.

> **Two things the live API taught us that no stub could.**
>
> **Nested field selectors poison the request.** Asking for
> `references.externalIds` made the provider *discard the entire field list*
> and answer with its defaults — so the call came back with **more** data than
> was requested (`authors`, `openAccessPdf`) and still no reference DOIs. The
> resolution call now asks only for flat fields. Consequently **citation
> evidence has no source and never fires**; wiring it would take one extra
> `GET /graph/v1/paper/<id>/references?fields=externalIds` per cache miss,
> which has not been added.
>
> **The provider volunteers extras.** Requesting `abstract` alone returns
> `abstract`, `authors`, `title` *and* `openAccessPdf`. That is the provider's
> behaviour, not a wider request. `_normalize_candidate` allowlists what is
> copied out, so nothing outside the documented set reaches a profile, the
> cache, or the response — pinned by a test.

### Filtering before scoring

Removed: results with no title, the current paper (by normalized DOI **or** by
normalized title key), a DOI already seen, a title already seen. Order is
preserved so the de-duplication is deterministic.

### Then Qresp judges them

The provider's ranking is **discarded**. Every surviving candidate is scored by
the same gate the internal list uses, against the same Qresp corpus statistics,
and only the ones that clear it are shown — at most five.

### Exactly what leaves this server

Per cache miss, at most two GETs to `https://api.semanticscholar.org`, carrying:

- the paper's **DOI**, or — only when it has none — its **published title**;
- the opaque `paperId` the provider itself just returned.

Nothing else. Not the abstract, not the authors, not the keywords, not the
artifacts, not another record, not a path, not a file, not a user.

The provider origin is a **fixed HTTPS constant in code**
(`SEMANTIC_SCHOLAR_ORIGIN`); no environment variable, config file or request
parameter can redirect it. The API key, when configured, is sent **only** as
the `x-api-key` request header — never in a URL, query string or body, where an
access log would capture it.

---

## Quality gate

A candidate is shown only when it has

- **at least one STRONG** piece of evidence, **or**
- **at least two MEDIUM** pieces from **independent families**.

Families: `citation`, `terms`, `methods`, `text`, `authors`. Only the strongest
evidence per family is kept, so two views of one overlap count once.

### Strong

| Evidence | Condition |
| --- | --- |
| Directly cited by this paper | candidate DOI ∈ the current paper's reference DOIs (provider-supplied; never inferred) |
| Several specific shared research terms | ≥ 3 **independent** shared specific terms **and** combined IDF ≥ 4.5 |
| High title/abstract similarity | IDF-weighted cosine ≥ 0.34 |
| Same method/tool on a related topic | a shared specific tool/facility/measurement **and** topic overlap that is not itself the tool |

### Medium

| Evidence | Condition |
| --- | --- |
| Shared specific keywords | ≥ 1 shared **explicit** keyword (tag, chart property, artifact keyword) |
| Shared specific research terms | ≥ 2 independent shared specific free-text terms (when no shared keyword) |
| Shared author on a related topic | shared author **and** topic overlap |
| Same research area + significant similarity | shared collection/field **and** cosine ≥ 0.16 |
| Shared specific tool or facility | a shared tool with **no** topic overlap |

### Never evidence, alone or in combination

Same journal. Adjacent years. A single broad field. Generic words (`study`,
`data`, `analysis`, `simulation`, and ~90 more in `GENERIC_TERMS`). The
provider's own ranking position. **None of these produce an Evidence object at
all**, so none of them can push a candidate through the gate. Generic words are
additionally stripped from the text vectors, so two abstracts that share
nothing but "study / data / analysis / simulation" measure as *unrelated*, not
as a strong match.

### Why these thresholds

- **`SPECIFIC_DOCUMENT_FREQUENCY_RATIO = 0.15`** — specificity is measured
  against **this server's own corpus**, not a hardcoded vocabulary. A term
  carried by more than 15 % of the corpus is a field label ("photoemission" on
  a photoemission-heavy server), not a fingerprint. It still contributes to
  similarity; it just stops counting as *specific*.
- **Floor of 2 documents** — a ratio-only ceiling would rule out a term shared
  by exactly the two records being compared on any corpus smaller than ~14
  records, i.e. every new Qresp instance. That overlap is the *most* specific
  one there is.
- **`STRONG_SHARED_TERM_COUNT = 3` + `STRONG_SHARED_TERM_WEIGHT = 4.5`** — two
  shared rare terms coincide often enough (a shared instrument plus a shared
  element); three distinct ones do not. The weight floor stops three merely
  uncommon terms from clearing a bar meant for genuinely rare ones.
- **`MEDIUM_SHARED_TERM_COUNT = 2`** — a curated keyword is a deliberate
  statement about the record, so one is enough. A single word pulled out of an
  abstract ("functional") is a coincidence between neighbouring fields, so
  free-text overlap needs two.
- **`HIGH_TEXT_SIMILARITY = 0.34` / `MODERATE_TEXT_SIMILARITY = 0.16`** — at or
  above HIGH the two abstracts describe the same system or the same
  measurement. MODERATE is "plausibly adjacent", which is why it is only ever
  MEDIUM and only when a shared research area corroborates it.
- **Independence collapsing** — one shared two-word keyword arrives as three
  matching terms (the phrase and each word). Words covered by a shared phrase
  are not counted again, so a single tag cannot clear a bar meant for several
  unrelated terms.
- **Topic overlap excludes the shared tool** — otherwise every shared tool
  would corroborate itself and "same lab, different subject" would pass.

These are **starting values for a prototype**, deliberately expressed as named
module constants so a domain expert can retune them from the QA table below
without reading the algorithm.

### Ordering

`3 × strong + 1 × medium + cosine + min(shared IDF, 10)/10`, then year
descending, then title. Ordering is presentation only; it can never promote a
candidate that failed the gate.

---

## Cache

`RelatedResearchCache` — a **separate collection** (`related_research_cache`),
keyed by paper id. Recommendations are never written into the canonical `Paper`
document: pinning them would freeze them at curation time and make a read look
like an edit.

- **Only external results are cached.** Internal ones are recomputed per
  request (see above).
- **Default TTL 7 days** (`QRESP_RELATED_RESEARCH_CACHE_DAYS`, capped at 90).
- **A valid entry is returned immediately and the provider is not called.**
  "Valid" means unexpired **and** still describing the record as it stands —
  see the fingerprint below.
- **An expired entry is refreshed.**
- **A failed refresh returns the last successful results with `stale: true`**;
  `last_success_at` deliberately outlives the failure so this is possible.
- A failure is remembered for **1 hour only** (`FAILURE_RETRY_SECONDS`), enough
  to stop a hot page from hammering a failing or rate-limiting provider,
  short enough that recovery is quick. `unresolved` (not in the index) is a
  stable fact and keeps the full TTL.
- **Stored:** the gate-passing candidates' public bibliographic metadata, the
  reasons Qresp computed, and the metadata fingerprint. **Never stored:** the
  API key, any header, any provider error body, any session/user/owner data,
  any RCC URL or file path, any file content.

### Metadata fingerprint — editing a record refreshes its answer at once

A cached answer describes the record **as it was**. Keyed on the paper id and
an expiry alone, a record edited a minute after publication kept serving
recommendations computed from the old title and abstract for a week.

`RelatedResearchCache.fingerprint` is a SHA-256 of exactly the public
scientific metadata a recommendation depends on
(`relatedness.metadata_fingerprint`, pure and unit-tested). An entry whose
fingerprint does not match the record is a **miss whatever its expiry says**.

**In the fingerprint** — the same allowlist `build_internal_profile` reads, so
the two cannot drift apart:

`reference.DOI`, `reference.title`, `reference.publishedAbstract`,
`reference.authors` (first/middle/last), `tags`, `collections`, chart
`caption` + `properties`, dataset and script `readme` + `keywords`, tool
`packageName` / `programName` / `facilityname` / `facilityName` /
`measurement` / `readme`.

**Never in the fingerprint** — so they can neither invalidate an entry nor
appear in one: `owner_email`, `editor_emails`, `edit_history`,
`updated_by_email`, `is_active`, `info.insertedBy` (curator name, email,
affiliation), every RCC URL and file path (`serverPath`, `fileServerPath`,
`folderAbsolutePath`, `downloadPath`, `notebookPath`), every `files` list and
all file content, `imageFile`, drafts, sessions and CSRF tokens.

RAW values are hashed, not normalized ones: the question is "did the curator
change this record", not "did the change survive tokenization".

**No migration.** An entry written before this field existed has no
fingerprint, so it can never match and is simply refetched and rewritten on
the next request. `FINGERPRINT_VERSION` is bumped only if the allowlist
changes, which invalidates every entry computed under the old one.

---

## Security

- Public **active** records only; deactivated records are visible only to those
  who could already edit them, exactly as the detail page is.
- A read **never** changes a `Paper`, a draft, ownership, publication state, or
  any curation state. The only write is to `related_research_cache`.
- A provider timeout, 404, 429 or malformed response degrades **the external
  section only** — never a 500, and never the internal list.
- Provider error bodies, request headers and the API key never reach the
  response or the logs; only the failure kind and the HTTP status code are
  logged.
- **nginx:** `location ~ ^/api/paper/[^/]+/related$` gets its own
  `api_related` zone at 60 r/m with `burst=30`. It sits deliberately between
  `api_general` (600 r/m — too permissive for something that can reach outward)
  and `api_costly` (20 r/m — would throttle ordinary browsing, since this
  renders with every detail page). A regex location so it wins over the `/api`
  prefix without disturbing any other paper sub-resource.

---

## Environment variables

All read from `os.environ` **only** — deliberately not `Config.get_setting`,
which falls back to `config.ini`. There is no `config.ini` fallback for any of
these, by design: neither the switch for an outbound call nor a credential
should be settable (or accidentally committable) there.

| Variable | Default | Notes |
| --- | --- | --- |
| `QRESP_RELATED_RESEARCH_ENABLED` | *(off)* | **Master switch** for the whole section. Off ⇒ `enabled: false`, nothing rendered, no provider call. |
| `QRESP_RELATED_EXTERNAL_ENABLED` | *(off)* | Enables the **outbound** Semantic Scholar call. Subordinate: worthless unless the master switch is also on. |
| `QRESP_SEMANTIC_SCHOLAR_API_KEY` | *(none)* | **Optional.** Semantic Scholar serves this API without a key at a lower rate limit. Without one, no credential header is sent and everything still works; with one it is sent as `x-api-key` only. |
| `QRESP_SEMANTIC_SCHOLAR_TIMEOUT_SECONDS` | `8` | Capped at 30. |
| `QRESP_RELATED_RESEARCH_CACHE_DAYS` | `7` | Capped at 90. |

The internal list never depends on any of the last three: a missing key or a
dead provider leaves Related Qresp Records fully working.

### The two switches

Related Qresp Records is local computation over records this server already
holds. Related External Papers is a request to a third party. Those are
different decisions, so they are different variables — an operator may
reasonably want the first and no outbound traffic at all.

| `..._RESEARCH_ENABLED` | `..._EXTERNAL_ENABLED` | Internal list | Provider call | External cache | `external.status` | Frontend |
| --- | --- | --- | --- | --- | --- | --- |
| off | off | not computed | never | untouched | `disabled` | whole section hidden |
| off | **on** | not computed | **never** | untouched | `disabled` | whole section hidden |
| on | off | **computed and shown** | **never** | **neither read nor written** | `disabled` | internal section only; the external heading is not rendered at all |
| on | on | computed and shown | on cache miss | read and written | `ok` / `unresolved` / `unavailable` | both sections |

The second row is the one worth stating explicitly: setting only the external
variable must not make a server whose operator never enabled the feature start
calling out. `config()["EXTERNAL_ENABLED"]` is the master AND the external
flag, never the external flag alone.

Internal-only, for staging:

```sh
QRESP_RELATED_RESEARCH_ENABLED=1
QRESP_RELATED_EXTERNAL_ENABLED=      # unset or empty: no outbound traffic
```

In that mode the external cache collection is not touched at all — not even
read — so an entry left over from a period when external was on is ignored
rather than replayed.

---

## Domain-quality evaluation CLI

`backend/project/tools/related_eval.py` — a **read-only, development/QA
command line**. It is not an endpoint, not in `swagger.yml`, and not reachable
over HTTP.

It exists because the gate's own accept/reject decision cannot be the answer
key for judging the gate. The CLI lays the verdicts out beside the candidates
that were thrown away, so a person can rate them.

**It will not:** write to any Paper, Draft, cache or MongoDB; call
`/api/paper/{id}/related` (so the production cache and the quota behind it are
untouched); make any external request without `--live`; fill in a rating;
or emit curator identity, owner/editor fields, RCC URLs, file-server paths,
file names, the API key or any header.

### Collect

```sh
cd backend
python -m project.tools.related_eval collect \
  --api-base https://<a-qresp-instance> \
  --sample-size 18 \
  --output-dir ../related-eval-out \
  --live --rate-limit 0.7 --max-retries 2
```

No instance URL is hardcoded anywhere in the tool; `--api-base` is required.
`--ids-file FILE` (one record id per line) replaces `--sample-size`. Drop
`--live` to evaluate the internal list only, with zero external requests.
`--review-rejected N` (default 5) sets how many near-misses per source go into
the review file — those are what expose false negatives. `--include-flagged`
samples records the triage set aside. `--insecure` skips TLS verification for
a self-signed staging tunnel.

The API key is read **only** from `QRESP_SEMANTIC_SCHOLAR_API_KEY` and is
reported only as `api_key_present: true|false`.

Requests are sequential and paced (default 1/s); HTTP 429 is retried a bounded
number of times, honouring `Retry-After` up to 60 s.

### Inputs

`GET /api/search` for the record pool and `GET /api/paper/{id}` for artifact
metadata. Both the legacy name-mangled keys (`_Search__id`, `_Search__title`,
`_Search__abstract`, `_Search__doi`, `_Search__tags`, `_Search__collections`,
`_Search__publication`, `_Search__year`) and plain `id`/`title`/`abstract`/
`doi` are understood, in one place: `eval_core.normalize_search_record`.

**Sampling is deterministic** — no RNG, so a re-run is comparable to the run
before it. Metadata-rich records (DOI + abstract + tags) are preferred, and
selection round-robins across collections/publications so one collection
cannot crowd out the rest.

**Triage never deletes anything.** Records whose titles read as scaffolding
(`STAGING TEST`, `QA`, `placeholder`, `asdf`, …), whose tags are keyboard
mash, or whose title and abstract share no content words at all are reported
with a reason and held out of the default sample; `--include-flagged` puts
them back. Merely thin records (short abstract, no DOI) are still evaluated,
carrying their flags into the output.

### Candidate pools

| Pool | What it is |
| --- | --- |
| `internal` | Related Qresp Records, via the production ranking |
| `recommendations_default` | Recommendations with no `from` — exactly what production asks for |
| `recommendations_all_cs` | Recommendations with `from=all-cs` |
| `title_resolution` | The paper resolved by title instead of DOI, then recommendations |

Every candidate is kept, accepted or not, with its `rank`, `gate_score`, score
components, decision, `rejection_code`, prose `rejection_reason`, and whether
production would have shown it (`in_top5`).

### Outputs

| File | Contents |
| --- | --- |
| `raw-results.jsonl` | one line per record: the record, every candidate from every pool with scores and verdicts, and the provider outcome per pool |
| `human-review.tsv` | `record_id, record_title, source, candidate_title, reasons, gate_score, gate_decision, human_rating, human_note` — the shown candidates plus the best near-misses, with **`human_rating` blank** |
| `summary.json` | sample size, flagged vs not-sampled records, per-pool coverage and gate pass rate, zero-candidate ratio, rejection-code frequency, provider request counts |
| `metrics.json` | written by `summarize` |

`human_rating` accepts only `related`, `partial` or `unrelated` (blank means
unrated). Anything else stops the scoring with the offending line numbers.

### Summarize

```sh
python -m project.tools.related_eval summarize --output-dir ../related-eval-out
```

Reports precision@5 (strict, `related` only) and lenient (`related` +
`partial`) over the candidates production would actually show, false positives
(accepted but rated unrelated), false negatives (rejected but rated related or
partial), record coverage, and a per-pool breakdown. **Unrated rows are
excluded from every metric and counted separately**, so a half-finished review
cannot masquerade as a verdict.

---

## Tests

```text
backend/project/tests/test_relatedness.py        31 tests — the pure gate + fingerprint
backend/project/tests/test_related_research.py   56 tests — endpoint/provider/cache
frontend/__tests__/RelatedResearch.spec.js       14 tests — the section
frontend/__tests__/PaperDetailsRelated.spec.js    4 tests — page composition
backend/project/tests/test_nginx_config.py       +1 test — the rate-limit zone
```

No DOI, paper title, material, method or facility name is hardcoded in
`relatedness.py`, `related.py`, or in any test's *algorithm*. Test fixtures use
invented vocabulary precisely so the thresholds, not a lookup table, are what
is under test.

---

## Domain QA — rate the recommendations

The gate above is calibrated by reasoning, not yet by a physicist. This table
is what turns it into evidence. Pick 10–20 records that already exist on the
instance (a mix: same group, same method, same field, unrelated), open each
detail page, and rate what appears.

**Reference sample for the external path:** DOI `10.1021/acs.nanolett.7b00283`
— a record carrying this DOI exercises the DOI-first resolution and returns a
non-trivial recommendation set. *(This DOI appears in documentation only; it is
not referenced by any code or test.)*

| # | Qresp record (title / id) | List | Recommended title | Reasons shown | 관련 있음 / 부분 관련 / 관련 없음 | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | internal | | | | |
| 2 | | internal | | | | |
| 3 | | internal | | | | |
| 4 | | internal | | | | |
| 5 | | internal | | | | |
| 6 | | internal | | | | |
| 7 | | internal | | | | |
| 8 | | internal | | | | |
| 9 | | internal | | | | |
| 10 | | internal | | | | |
| 11 | | external | | | | |
| 12 | | external | | | | |
| 13 | | external | | | | |
| 14 | | external | | | | |
| 15 | | external | | | | |
| 16 | | external | | | | |
| 17 | | external | | | | |
| 18 | | external | | | | |
| 19 | | external | | | | |
| 20 | | external | | | | |

Also record, per rated record:

| Question | Answer |
| --- | --- |
| Records where a clearly related paper was **missing** (false negative) | |
| Reasons that read as true but **uninformative** ("Shares 3 specific research terms: …") | |
| Reasons naming a term that is really a **field label** on this corpus | |
| Records where the list was **empty** and that was correct | |

**How to act on the result**

| Symptom | Knob (`backend/project/relatedness.py`) |
| --- | --- |
| Too many loose matches | raise `HIGH_TEXT_SIMILARITY`, raise `STRONG_SHARED_TERM_COUNT` to 4, raise `STRONG_SHARED_TERM_WEIGHT` |
| Too few matches on a small corpus | lower `MODERATE_TEXT_SIMILARITY`, lower `STRONG_SHARED_TERM_WEIGHT` |
| A field label keeps being called "specific" | lower `SPECIFIC_DOCUMENT_FREQUENCY_RATIO`, or add the word to `GENERIC_TERMS` |
| Same-lab-different-subject keeps passing | it should not — check whether `topic_terms` is being satisfied by a shared tool; report it |

---

## Verifying against the real provider on staging

Everything below runs on **`qresp_staging` only**. No secrets belong in any
committed file — export them in the shell or inject them into the container.

### 1. Configure the staging backend

```sh
# On the staging host, in the staging compose project only.
export QRESP_RELATED_RESEARCH_ENABLED=1
# OPTIONAL. Without it the shared keyless pool is used, which returns 429
# often enough that you should expect `unavailable` on a first try.
export QRESP_SEMANTIC_SCHOLAR_API_KEY='...'      # never committed, never logged
export QRESP_SEMANTIC_SCHOLAR_TIMEOUT_SECONDS=15
export QRESP_RELATED_RESEARCH_CACHE_DAYS=7
```

### 2. Recreate the backend so it picks the variables up

The compose file bind-mounts `./backend`, so a `build` does **not** change
backend code or environment — the container has to be recreated:

```sh
cd ~/qresp_staging
git pull
docker compose up -d --force-recreate --no-deps backend
docker compose exec backend python -c \
  "import os; print('enabled:', bool(os.environ.get('QRESP_RELATED_RESEARCH_ENABLED')), \
   'key set:', bool(os.environ.get('QRESP_SEMANTIC_SCHOLAR_API_KEY')))"
```

That last line prints booleans only — never echo the key itself.

### 3. Check the endpoint

Pick a record id from the explorer, then (through the SSH tunnel):

```sh
ID=<paper id from /explorer>

# Shape and status, without dumping the whole body:
curl -sk "https://localhost:8443/api/paper/$ID/related" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); \
      print("enabled:", d["enabled"]); \
      print("internal:", d["internal"]["count"]); \
      print("external:", d["external"]["status"], d["external"]["count"], \
            "stale:", d["external"]["stale"])'

# Second call must be a cache hit: same output, and no outbound request.
docker compose logs --tail=50 backend | grep -i "related research" || echo "no provider errors logged"
```

Expected on a healthy run: `enabled: true`, a non-zero `internal` count on a
record that has neighbours, and an `external` status of `ok` (see the
limitation below about the count being 0).

### 4. Confirm the cache without reading secrets out of it

```sh
docker compose exec mongo mongo qresp --quiet --eval '
  db.related_research_cache.find({}, {paper_id:1, status:1, fingerprint:1,
    expires_at:1, last_success_at:1}).limit(5).forEach(printjson)'

# The canonical record must be untouched by any number of related reads:
docker compose exec mongo mongo qresp --quiet --eval '
  printjson(Object.keys(db.papers.findOne({_id: ObjectId("'"$ID"'")})))'
```

`papers` must contain no `related*` key of any kind, and the cache documents
must contain no email, no path and no key.

### 5. Exercise the failure paths deliberately

```sh
# Non-answer: point the container at a black hole and reload a detail page.
docker compose exec backend sh -c \
  "echo '127.0.0.1 api.semanticscholar.org' >> /etc/hosts"
#   -> external.status == "unavailable"; internal results unaffected;
#      a previously cached record shows stale: true.
# Undo by recreating the container:
docker compose up -d --force-recreate --no-deps backend

# Metadata invalidation: edit the record's title in the curator, reload.
#   -> the provider is queried again immediately, and `fingerprint` changes.
```

## Known limitations

- **Gate permissiveness is the open question, not provider coverage.**
  Measured over 18 real records from a public Qresp instance (see the
  evaluation CLI below), the gate **accepts 71 % of all candidate pairs** —
  74 % internally, 58–75 % across the external pools. Only the top five are
  ever shown, so the user-visible damage is bounded, but "accepted" currently
  means very little. Whether that is correct is exactly what the human
  labelling pass has to decide; **no threshold has been changed on the
  strength of unlabelled data.**
- **Citation evidence is INACTIVE: it has no input source and can never
  fire.** The pure module implements and unit-tests the signal, and `assess()`
  still accepts a `citation_dois` argument, but **nothing ever passes a
  non-empty one** — `related.py` calls it with an empty set, always. The
  reason is the field-selector defect above: asking the provider for
  `references.externalIds` makes it discard the whole field list, so no
  reference DOIs come back. Reactivating it needs one extra
  `GET /graph/v1/paper/<id>/references?fields=externalIds` per cache miss,
  which has deliberately not been added. Papers that cite *this* one are not
  detected either way. **Treat "Directly cited by this paper" as dead code
  paths, not as a signal in service.**
- **Small corpora.** With fewer than ~14 active records, IDF is coarse and the
  specificity floor of 2 does most of the work. The internal list will be short
  — correctly so.
- **The external list follows the record, not the world.** An edit to the
  record refreshes it at once (fingerprint), but new papers appearing at the
  provider are only picked up when the TTL expires.
- **Recomputed per request.** The internal list rebuilds corpus statistics on
  every detail view. That is what makes publish/deactivate instant, and is
  comfortable at the corpus sizes Qresp holds; a server with tens of thousands
  of records would want the statistics memoized.
- **No cross-server federation.** Only records on this instance are considered
  for the internal list.
- **Domain relevance is unvalidated.** The QA table above is the gate on
  turning this on anywhere public.
