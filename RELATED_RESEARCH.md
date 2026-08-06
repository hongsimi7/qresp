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

```
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
| `ok` | provider answered | results, or the empty message |
| `disabled` | feature switch is off | "External recommendations are turned off on this server." |
| `unresolved` | this paper could not be identified at the provider confidently enough to ask | "This record could not be matched in the external index…" |
| `unavailable` | timeout / 404 / 429 / 5xx / malformed answer | "External recommendations are unavailable right now. The Qresp results above are unaffected." |

`stale: true` is orthogonal: an expired cache whose refresh just failed serves
the last successful results with a dated warning rather than emptying.

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
   `fields=paperId,title,externalIds,references.externalIds`. A DOI is exact,
   so no confirmation is needed. The reference DOIs it returns are the only
   citation source Qresp has.
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
   "same research area" check). No venue, no citation counts, no embeddings,
   no open-access PDFs.

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
- **An expired entry is refreshed.**
- **A failed refresh returns the last successful results with `stale: true`**;
  `last_success_at` deliberately outlives the failure so this is possible.
- A failure is remembered for **1 hour only** (`FAILURE_RETRY_SECONDS`), enough
  to stop a hot page from hammering a failing or rate-limiting provider,
  short enough that recovery is quick. `unresolved` (not in the index) is a
  stable fact and keeps the full TTL.
- **Stored:** the gate-passing candidates' public bibliographic metadata and
  the reasons Qresp computed. **Never stored:** the API key, any header, any
  provider error body, any session/user/owner data, any RCC URL or file path,
  any file content.

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
| `QRESP_RELATED_RESEARCH_ENABLED` | *(off)* | `1`/`true`/`yes`/`on` enables the whole feature. Off ⇒ `enabled: false`, no section, no provider call. |
| `QRESP_SEMANTIC_SCHOLAR_API_KEY` | *(none)* | **Optional.** Semantic Scholar serves this API without a key at a lower rate limit. Without one, no credential header is sent and everything still works; with one it is sent as `x-api-key` only. |
| `QRESP_SEMANTIC_SCHOLAR_TIMEOUT_SECONDS` | `8` | Capped at 30. |
| `QRESP_RELATED_RESEARCH_CACHE_DAYS` | `7` | Capped at 90. |

The internal list never depends on any of the last three: a missing key or a
dead provider leaves Related Qresp Records fully working.

---

## Tests

```
backend/project/tests/test_relatedness.py        26 tests — the pure gate
backend/project/tests/test_related_research.py   44 tests — endpoint/provider/cache
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

## Known limitations

- **Citation evidence is one-directional and provider-dependent.** Qresp stores
  no reference list of its own, so "Directly cited by this paper" can only fire
  when the provider resolved this paper by DOI and reported its references.
  Papers that cite *this* one are not detected.
- **Small corpora.** With fewer than ~14 active records, IDF is coarse and the
  specificity floor of 2 does most of the work. The internal list will be short
  — correctly so.
- **The external list follows the record, not the reader.** Cached results are
  per record; an edit to the record's title or abstract is not reflected in the
  external list until the 7-day TTL expires.
- **Recomputed per request.** The internal list rebuilds corpus statistics on
  every detail view. That is what makes publish/deactivate instant, and is
  comfortable at the corpus sizes Qresp holds; a server with tens of thousands
  of records would want the statistics memoized.
- **No cross-server federation.** Only records on this instance are considered
  for the internal list.
- **Domain relevance is unvalidated.** The QA table above is the gate on
  turning this on anywhere public.
