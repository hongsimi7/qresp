"""Deterministic relatedness scoring for Related Research.

This module is PURE: no database, no network, no clock, no environment, no
language model. It takes plain dictionaries in and returns evidence out, so
every threshold below is unit-testable in isolation (see
`tests/test_relatedness.py`).

Why it exists
-------------
"Semantic Scholar returned it" and "same journal, same year" are not reasons.
A recommendation is only shown when Qresp can NAME the overlap it found in the
two records' own scientific metadata. Everything the user reads under
"Why related" is generated here, from the evidence that actually fired -- no
sentence is written by a model, and no DOI, paper title or material name is
hardcoded anywhere in this file.

The gate
--------
A candidate is shown only if it has

  * at least one STRONG piece of evidence, or
  * at least two MEDIUM pieces of evidence from INDEPENDENT families.

"Independent" means different signal families (terms / text / authors /
methods / citation): two mediums derived from the same overlap are one
observation, not two.

Deliberately NOT evidence, alone or together
--------------------------------------------
Same journal, adjacent publication years, a single broad field, generic words
("study", "data", "analysis", "simulation"), and the provider's own ranking.
None of them produce an Evidence object at all, so none of them can push a
candidate through the gate.

Specificity comes from the Qresp corpus itself: a term that appears in a large
share of the corpus is a field label, not a fingerprint, and is weighted (and
gated) accordingly.
"""
import math
import re
from collections import Counter

# ---------------------------------------------------------------- vocabulary

# Ordinary English function words. Removed before anything is measured.
STOPWORDS = frozenset("""
a about above after again against all also am an and any are as at be because
been before being below between both but by can cannot could did do does
doing down during each few for from further had has have having he her here
hers herself him himself his how however i if in into is it its itself me more
most much must my myself no nor not of off on once only or other ought our
ours ourselves out over own same she should so some such than that the their
theirs them themselves then there these they this those through to too under
until up very was we were what when where which while who whom why with would
you your yours yourself yourselves via can't don't within upon whereas thus
hence therefore among across per towards toward given onto whose
""".split())

# Words that are true of almost every scientific record and therefore cannot
# distinguish one from another. They are never counted as a specific research
# term, no matter how rare the corpus makes them look. The first four are
# named in the product requirement; the rest are the same kind of word.
GENERIC_TERMS = frozenset("""
study studies data analysis analyses simulation simulations result results
method methods methodology approach approaches paper papers article research
researches work works investigation investigations experiment experiments
experimental theoretical computational numerical calculation calculations
model models modeling modelling framework frameworks technique techniques
new novel recent present presented show shown shows report reported using use
used useful important significant various different several many high low
large small value values case cases set sets number numbers type types kind
figure figure1 table section supporting information dataset datasets script
scripts software tool tools code codes file files version versions readme
project projects sample samples system systems process processes property
properties effect effects behavior behaviour performance
compute computed computes computing calculate calculated calculates
determine determined determines obtain obtained observe observed observation
observations measure measured measurement measurements predict predicted
prediction predictions characterize characterized characterization reveal
revealed reveals describe described compare compared comparison comparisons
investigate investigated examine examined propose proposed demonstrate
demonstrated develop developed apply applied application applications
provide provided perform performed consider considered include included
allow allows enable enables find finds obtained combined based
""".split())

# Tokens shorter than this are noise ("of", "we", "eV" units, indices).
MIN_TOKEN_LENGTH = 3
# A single word must be at least this long to count as a *specific* research
# term. Multi-word keyword phrases are exempt -- "spin coating" is specific
# even though neither half is long.
MIN_SPECIFIC_LENGTH = 4

# ---------------------------------------------------------------- thresholds
#
# Every number here is a judgement call, so each one records what it is for.
# They are module constants (not magic literals) precisely so a domain expert
# can retune them from the QA table without reading the algorithm.

# A term carried by more than this share of the Qresp corpus is a FIELD LABEL
# ("photoemission" in a photoemission-heavy corpus), not a fingerprint. Above
# the line a term still contributes to similarity, but never as "specific".
SPECIFIC_DOCUMENT_FREQUENCY_RATIO = 0.15

# "Several rare, specific shared research terms" -> strong. Two shared rare
# terms happen by coincidence often enough (a shared instrument plus a shared
# element); three distinct ones do not. The weight floor stops three merely
# uncommon terms from clearing a bar meant for genuinely rare ones.
STRONG_SHARED_TERM_COUNT = 3
STRONG_SHARED_TERM_WEIGHT = 4.5

# A shared *explicit keyword* (a curated tag, chart property or artifact
# keyword) is a deliberate statement about the record, so one is enough for a
# medium. A shared word merely pulled out of an abstract is not: a single one
# ("functional", "spectrum") is a coincidence between neighbouring fields, so
# free-text overlap needs at least two before it counts as anything.
MEDIUM_SHARED_TERM_COUNT = 2

# IDF-weighted cosine over title+abstract (+ artifact descriptions). At/above
# HIGH the two abstracts are describing the same system or the same
# measurement; MODERATE is "plausibly adjacent", which is why moderate
# similarity is only ever MEDIUM and only when a shared research area
# corroborates it.
HIGH_TEXT_SIMILARITY = 0.34
MODERATE_TEXT_SIMILARITY = 0.16

# Evidence strengths.
STRONG = "strong"
MEDIUM = "medium"

# Independent signal families. Two mediums must come from two of these.
FAMILY_CITATION = "citation"
FAMILY_TERMS = "terms"
FAMILY_TEXT = "text"
FAMILY_AUTHORS = "authors"
FAMILY_METHODS = "methods"

# Display order when trimming to the three reasons the UI shows.
FAMILY_PRIORITY = (FAMILY_CITATION, FAMILY_TERMS, FAMILY_METHODS,
                   FAMILY_TEXT, FAMILY_AUTHORS)

STRENGTH_WEIGHT = {STRONG: 3.0, MEDIUM: 1.0}

# How many shared terms to name in a reason sentence before "and N more".
MAX_TERMS_IN_REASON = 3

_WORD_RE = re.compile(r"[a-z0-9]+(?:[-'][a-z0-9]+)*")
_NUMERIC_RE = re.compile(r"^[0-9]+$")


# ------------------------------------------------------------- normalization

def normalize_text(value):
    """Lowercase, unify separators, collapse whitespace."""
    text = str(value or "").lower()
    text = re.sub(r"[‐-―−]", "-", text)
    text = re.sub(r"[^a-z0-9\-'\s]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _singular(token):
    """Very conservative plural folding, so 'nanowires' meets 'nanowire'.
    Deliberately not a stemmer: aggressive stemming merges distinct terms."""
    if len(token) > 4 and token.endswith("s") and not token.endswith(
            ("ss", "us", "is", "as", "os")):
        return token[:-1]
    return token


def tokenize(value):
    """Content tokens of a free-text field, stopwords and numbers removed."""
    tokens = []
    for match in _WORD_RE.finditer(normalize_text(value)):
        token = match.group(0).strip("-'")
        if len(token) < MIN_TOKEN_LENGTH or _NUMERIC_RE.match(token):
            continue
        if token in STOPWORDS:
            continue
        token = _singular(token)
        if len(token) < MIN_TOKEN_LENGTH or token in STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def normalize_phrase(value):
    """A keyword/tool name as one comparable term ('Spin Coating' ->
    'spin coating'). Stopword-only or empty phrases return ''."""
    tokens = tokenize(value)
    return " ".join(tokens)


def normalize_doi(value):
    """Comparable DOI form: no scheme, no doi: prefix, lowercased."""
    doi = str(value or "").strip()
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.IGNORECASE)
    doi = re.sub(r"^doi:\s*", "", doi, flags=re.IGNORECASE)
    return doi.strip().strip(".,;").lower()


def normalize_title_key(value):
    """Order-insensitive comparable form of a title, for de-duplication."""
    return " ".join(sorted(set(tokenize(value))))


def author_key(name):
    """'Alex P. Gaiduk' / 'A. Gaiduk' -> 'a gaiduk'. First initial plus family
    name is the strictest key that still survives how differently the two
    metadata sources write the same person."""
    cleaned = normalize_text(name)
    parts = [p for p in cleaned.split() if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return "%s %s" % (parts[0][0], parts[-1])


# ------------------------------------------------------------------ profiles

class Profile(object):
    """Everything relatedness is allowed to look at, for one paper.

    Only public scientific metadata reaches this object. There is deliberately
    no field for owner/editor/account data, RCC URLs, file paths, file
    contents, drafts or session state -- they are not read into a Profile, so
    they cannot be scored, cached, or sent anywhere.
    """

    __slots__ = ("key", "title", "doi", "year", "authors", "url", "source",
                 "text_counts", "keyword_terms", "method_terms",
                 "field_terms", "author_keys", "author_names", "title_key")

    def __init__(self, key, title="", doi="", year=None, authors=(), url="",
                 source="internal"):
        self.key = key
        self.title = title or ""
        self.doi = normalize_doi(doi)
        self.year = year
        self.authors = list(authors or [])
        self.url = url or ""
        self.source = source
        self.text_counts = Counter()
        self.keyword_terms = set()
        self.method_terms = set()
        self.field_terms = set()
        # key -> the name as this side spells it, so a reason can name the
        # person rather than the matching key.
        self.author_names = {}
        for name in self.authors:
            key = author_key(name)
            if key:
                self.author_names.setdefault(key, name)
        self.author_keys = set(self.author_names)
        self.title_key = normalize_title_key(self.title)

    def add_text(self, value, weight=1):
        # Generic words are dropped here rather than only at the specificity
        # check, so they cannot inflate text similarity either. Two abstracts
        # that share nothing but "study", "data", "analysis" and "simulation"
        # must measure as unrelated, not as a strong match.
        for token in tokenize(value):
            if token in GENERIC_TERMS:
                continue
            self.text_counts[token] += weight

    def add_keyword(self, value):
        phrase = normalize_phrase(value)
        if not phrase:
            return
        self.keyword_terms.add(phrase)
        self.add_text(value)

    def add_method(self, value):
        phrase = normalize_phrase(value)
        if not phrase:
            return
        self.method_terms.add(phrase)
        self.add_text(value)

    def add_field(self, value):
        phrase = normalize_phrase(value)
        if phrase:
            self.field_terms.add(phrase)

    @property
    def all_terms(self):
        terms = set(self.text_counts)
        terms |= self.keyword_terms
        terms |= self.method_terms
        return terms


def _people(entries):
    """['{firstName,middleName,lastName}'|'name'|'plain string'] -> names."""
    names = []
    for entry in entries or []:
        if isinstance(entry, dict):
            name = " ".join(str(entry.get(part) or "").strip()
                            for part in ("firstName", "middleName",
                                         "lastName")).strip()
            if not name:
                name = str(entry.get("name") or "").strip()
        else:
            name = str(entry or "").strip()
        name = re.sub(r"\s+", " ", name)
        if name:
            names.append(name)
    return names


def build_internal_profile(record):
    """Profile of a stored Qresp record, from its published scientific
    metadata only.

    `record` is a plain dict (``Paper.to_mongo().to_dict()`` shaped). Read:
    title, abstract, paper tags, collections (as broad FIELDS, never as
    specific terms), author names, chart captions/properties, dataset and
    script keywords and readme descriptions, and tool package/facility/
    measurement names.

    Never read: info.serverPath / fileServerPath / folderAbsolutePath /
    downloadPath / notebookPath (RCC URLs and file paths), any file listing or
    file content, owner_email / editor_emails / insertedBy / edit_history
    (account data), drafts, or activation bookkeeping.
    """
    reference = record.get("reference") or {}
    year = reference.get("year")
    try:
        year = int(year) if year is not None else None
    except (TypeError, ValueError):
        year = None

    profile = Profile(
        key=str(record.get("_id") or record.get("id") or ""),
        title=str(reference.get("title") or "").strip(),
        doi=reference.get("DOI") or "",
        year=year,
        authors=_people(reference.get("authors")),
        source="internal",
    )
    # The title carries more signal per word than the abstract does.
    profile.add_text(profile.title, weight=2)
    profile.add_text(reference.get("publishedAbstract"))

    for tag in record.get("tags") or []:
        profile.add_keyword(tag)
    for collection in record.get("collections") or []:
        profile.add_field(collection)

    for chart in record.get("charts") or []:
        chart = chart or {}
        profile.add_text(chart.get("caption"))
        for prop in chart.get("properties") or []:
            profile.add_keyword(prop)

    for artifacts in (record.get("datasets"), record.get("scripts")):
        for artifact in artifacts or []:
            artifact = artifact or {}
            profile.add_text(artifact.get("readme"))
            for keyword in artifact.get("keywords") or []:
                profile.add_keyword(keyword)

    for tool in record.get("tools") or []:
        tool = tool or {}
        for field in ("packageName", "programName", "facilityname",
                      "facilityName", "measurement"):
            profile.add_method(tool.get(field))
        profile.add_text(tool.get("readme"))

    return profile


def build_external_profile(paper):
    """Profile of one external provider result.

    `paper` is the provider's already-normalized dict: title, abstract, year,
    authors (names), doi, url, fields (broad research areas). Nothing else
    from the provider payload is read -- ranking position included.
    """
    profile = Profile(
        key=str(paper.get("key") or paper.get("doi") or paper.get("title")
                or ""),
        title=str(paper.get("title") or "").strip(),
        doi=paper.get("doi") or "",
        year=paper.get("year"),
        authors=paper.get("authors") or [],
        url=paper.get("url") or "",
        source="external",
    )
    profile.add_text(profile.title, weight=2)
    profile.add_text(paper.get("abstract"))
    for field in paper.get("fields") or []:
        profile.add_field(field)
    return profile


# -------------------------------------------------------------------- corpus

class CorpusStats(object):
    """Document frequencies over the Qresp corpus.

    This is what makes a shared term mean something: rarity is measured
    against the records this server actually holds, so no vocabulary, field,
    material or method is hardcoded.
    """

    def __init__(self, profiles):
        profiles = list(profiles)
        self.document_count = len(profiles)
        self.document_frequency = Counter()
        for profile in profiles:
            for term in profile.all_terms:
                self.document_frequency[term] += 1

    def idf(self, term):
        """Smoothed inverse document frequency; unseen terms score highest
        without dividing by zero, and a one-record corpus stays finite."""
        df = self.document_frequency.get(term, 0)
        return math.log((self.document_count + 1.0) / (df + 1.0)) + 1.0

    def is_specific(self, term):
        """A term precise enough to justify a recommendation on its own
        merit: not generic, long enough (or a phrase), and not carried by a
        large share of the corpus."""
        if not term or term in GENERIC_TERMS or term in STOPWORDS:
            return False
        if " " not in term and len(term) < MIN_SPECIFIC_LENGTH:
            return False
        if " " in term and all(part in GENERIC_TERMS
                               for part in term.split()):
            return False
        # Floor of 2, not 1: a term carried by exactly the two records being
        # compared and nobody else is the *most* specific overlap there is.
        # A ratio-only ceiling would rule it out on any corpus smaller than
        # ~14 records, which is every new Qresp instance.
        ceiling = max(2.0,
                      SPECIFIC_DOCUMENT_FREQUENCY_RATIO * self.document_count)
        return self.document_frequency.get(term, 0) <= ceiling

    def specific_terms(self, profile):
        return {t for t in profile.all_terms if self.is_specific(t)}

    def similarity(self, left, right):
        """IDF-weighted cosine over the two text bags. 0.0 when either side
        has no usable text."""
        if not left.text_counts or not right.text_counts:
            return 0.0
        shared = set(left.text_counts) & set(right.text_counts)
        if not shared:
            return 0.0
        dot = sum(left.text_counts[t] * right.text_counts[t] * (self.idf(t) ** 2)
                  for t in shared)
        left_norm = math.sqrt(sum((c * self.idf(t)) ** 2
                                  for t, c in left.text_counts.items()))
        right_norm = math.sqrt(sum((c * self.idf(t)) ** 2
                                   for t, c in right.text_counts.items()))
        if not left_norm or not right_norm:
            return 0.0
        return dot / (left_norm * right_norm)


# ------------------------------------------------------------------ evidence

class Evidence(object):
    """One named, grounded observation. `text` is what the user reads under
    "Why related"; it is assembled from the overlap that fired, never written
    by a model."""

    __slots__ = ("family", "strength", "text")

    def __init__(self, family, strength, text):
        self.family = family
        self.strength = strength
        self.text = text

    def as_dict(self):
        return {"family": self.family, "strength": self.strength,
                "text": self.text}

    def __repr__(self):  # pragma: no cover - debugging aid
        return "Evidence(%s, %s, %r)" % (self.family, self.strength, self.text)


class Assessment(object):
    """Verdict for one candidate."""

    __slots__ = ("passes", "score", "evidence", "similarity",
                 "shared_terms")

    def __init__(self, passes, score, evidence, similarity, shared_terms):
        self.passes = passes
        self.score = score
        self.evidence = evidence
        self.similarity = similarity
        self.shared_terms = shared_terms

    def reasons(self, limit=3):
        """The (at most) `limit` strongest reasons, strongest family first."""
        ordered = sorted(
            self.evidence,
            key=lambda e: (0 if e.strength == STRONG else 1,
                           FAMILY_PRIORITY.index(e.family)
                           if e.family in FAMILY_PRIORITY else len(FAMILY_PRIORITY)))
        return [e.text for e in ordered[:limit]]


def independent_terms(terms):
    """Collapse a shared overlap to its INDEPENDENT observations.

    One shared two-word keyword arrives as three matching terms -- the phrase
    and each of its words -- which would let a single tag clear a bar meant
    for several unrelated ones. A word that only appears because a shared
    phrase contains it is therefore not counted again on its own.
    """
    covered = set()
    for term in terms:
        if " " in term:
            covered |= set(term.split())
    return {t for t in terms if " " in t or t not in covered}


def _term_list(terms, stats):
    """Rarest first, capped, rendered for a reason sentence.

    Equally rare terms are broken by length: on a small corpus every shared
    term has the same document frequency, and "photoemission" tells the
    reader far more about the overlap than "body" (the tail of "many body")
    does.
    """
    ordered = sorted(terms, key=lambda t: (-stats.idf(t), -len(t), t))
    shown = ordered[:MAX_TERMS_IN_REASON]
    text = ", ".join(shown)
    remaining = len(ordered) - len(shown)
    if remaining > 0:
        text += " and %d more" % remaining
    return text


def assess(current, candidate, stats, citation_dois=frozenset()):
    """Evidence and verdict for one (current paper, candidate) pair.

    `citation_dois` is the set of normalized DOIs the current paper is known
    to cite. It is optional: when no citation source is available it is empty
    and no citation evidence can fire -- it is never inferred.
    """
    evidence = []

    current_specific = stats.specific_terms(current)
    candidate_specific = stats.specific_terms(candidate)
    shared_specific = independent_terms(current_specific & candidate_specific)
    shared_weight = sum(stats.idf(t) for t in shared_specific)
    similarity = stats.similarity(current, candidate)
    shared_authors = current.author_keys & candidate.author_keys
    shared_methods = {t for t in current.method_terms & candidate.method_terms
                      if stats.is_specific(t)}
    shared_keywords = {t for t in current.keyword_terms & candidate.keyword_terms
                       if stats.is_specific(t)}
    shared_fields = current.field_terms & candidate.field_terms
    # "The same topic", used to corroborate an author or a tool. A shared tool
    # with no topic overlap is a lab habit, not a relationship -- so the tool
    # names themselves are excluded from what counts as the topic, or every
    # shared tool would corroborate itself.
    topic_terms = shared_specific - shared_methods
    topic_overlap = bool(topic_terms) or similarity >= MODERATE_TEXT_SIMILARITY

    # -- strong ------------------------------------------------------------
    if candidate.doi and candidate.doi in citation_dois:
        evidence.append(Evidence(
            FAMILY_CITATION, STRONG,
            "Directly cited by this paper"))

    if (len(shared_specific) >= STRONG_SHARED_TERM_COUNT
            and shared_weight >= STRONG_SHARED_TERM_WEIGHT):
        evidence.append(Evidence(
            FAMILY_TERMS, STRONG,
            "Shares %d specific research terms: %s"
            % (len(shared_specific), _term_list(shared_specific, stats))))

    if similarity >= HIGH_TEXT_SIMILARITY:
        evidence.append(Evidence(
            FAMILY_TEXT, STRONG,
            "High title and abstract similarity (%.2f)" % similarity))

    if shared_methods and topic_overlap:
        evidence.append(Evidence(
            FAMILY_METHODS, STRONG,
            "Same method or tool (%s) on a related topic"
            % _term_list(shared_methods, stats)))

    # -- medium ------------------------------------------------------------
    if shared_keywords:
        evidence.append(Evidence(
            FAMILY_TERMS, MEDIUM,
            "Shared specific keywords: %s"
            % _term_list(shared_keywords, stats)))
    elif len(shared_specific) >= MEDIUM_SHARED_TERM_COUNT:
        evidence.append(Evidence(
            FAMILY_TERMS, MEDIUM,
            "Shares %d specific research terms: %s"
            % (len(shared_specific), _term_list(shared_specific, stats))))

    if shared_authors and topic_overlap:
        names = sorted(candidate.author_names.get(k) or current.author_names[k]
                       for k in shared_authors)
        shown = names[:MAX_TERMS_IN_REASON]
        listed = ", ".join(shown)
        if len(names) > len(shown):
            listed += " and %d more" % (len(names) - len(shown))
        evidence.append(Evidence(
            FAMILY_AUTHORS, MEDIUM,
            "Shared author%s (%s) on a related topic"
            % ("s" if len(names) > 1 else "", listed)))

    if shared_fields and similarity >= MODERATE_TEXT_SIMILARITY:
        evidence.append(Evidence(
            FAMILY_TEXT, MEDIUM,
            "Same research area (%s) with significant text similarity (%.2f)"
            % (_term_list(shared_fields, stats), similarity)))

    if shared_methods and not topic_overlap:
        # A rare shared tool with nothing else: one medium, never enough by
        # itself.
        evidence.append(Evidence(
            FAMILY_METHODS, MEDIUM,
            "Shared specific tool or facility (%s)"
            % _term_list(shared_methods, stats)))

    # One observation per family: the same overlap must not be counted twice.
    strongest = {}
    for item in evidence:
        held = strongest.get(item.family)
        if held is None or (held.strength == MEDIUM and item.strength == STRONG):
            strongest[item.family] = item
    evidence = [strongest[f] for f in FAMILY_PRIORITY if f in strongest]

    strong_count = sum(1 for e in evidence if e.strength == STRONG)
    medium_families = {e.family for e in evidence if e.strength == MEDIUM}
    passes = strong_count >= 1 or len(medium_families) >= 2

    score = sum(STRENGTH_WEIGHT[e.strength] for e in evidence)
    score += similarity
    score += min(shared_weight, 10.0) / 10.0

    return Assessment(passes, round(score, 6), evidence, similarity,
                      sorted(shared_specific))


def rank(current, candidates, stats, citation_dois=frozenset(), limit=5):
    """Assess every candidate, drop the ones that fail the gate, and return
    at most `limit` of them as (profile, assessment), best first.

    The list is NOT padded: a short list -- including an empty one -- is the
    correct answer when nothing else clears the bar.
    """
    scored = []
    for candidate in candidates:
        if not candidate.title:
            continue
        assessment = assess(current, candidate, stats, citation_dois)
        if not assessment.passes:
            continue
        scored.append((candidate, assessment))
    scored.sort(key=lambda pair: (-pair[1].score,
                                  -(pair[0].year or 0),
                                  pair[0].title.lower()))
    return scored[:limit]
