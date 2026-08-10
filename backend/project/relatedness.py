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
import hashlib
import json
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

# Ordinary English, academic boilerplate and web/file vocabulary that a SMALL
# corpus can make look rare. This list is the answer to a specific failure: on
# a 65-record server, `python`, `http`, `user`, `another`, `related`,
# `discussed`, `play`, `will`, `proper`, `class`, `comparing`, `particular`,
# `region` and `yield` were all being reported to readers as "specific
# research terms", because document frequency was the only thing deciding.
#
# Nothing here is domain vocabulary: no material, method, facility, element or
# field name appears, and none may ever be added. These are words that are
# equally at home in any paper on any subject, which is exactly why sharing
# one says nothing about two records being related.
NON_TECHNICAL_TERMS = frozenset("""
another other others related relating relate relates discussed discuss
discusses discussion discussions mentioned mentioning note noted notes
particular particularly especially specifically respectively additionally
furthermore moreover overall generally typically usually often sometimes
always never likely unlikely possible possibly probable probably able unable
will shall may might would could should must can play plays played playing
role roles proper properly appropriate suitable reasonable relevant
comparing compares comparable similar similarly different differently
region regions area areas position positions place places part parts side
yield yields yielded give gives given giving take takes taken taking
make makes made making get gets got put puts keep keeps hold holds
class classes group groups kind kinds sort sorts form forms level levels
range ranges scale scales amount amounts quantity quantities degree degrees
first second third last next previous following above below here there
main major minor primary secondary basic simple complex complicated
good better best bad worse worst great greater greatest less least more
increase increases increased increasing decrease decreases decreased
change changes changed changing remain remains remained
account accounts including included follow follows followed
finding findings indicate indicates indicated highlight highlights
suggest suggests suggested imply implies implied conclude concluded
conclusion conclusions summary abstract introduction discussion references
acknowledgment acknowledgments appendix supplementary supporting
detail details detailed brief briefly full fully partial partially
excellent good accurate accuracy precise precision correct correctness
exact exactly approximate approximately estimate estimated estimation
current currently recently previously earlier later future
python http https www html htm json xml csv txt pdf zip tar gzip
url uri link links website web page pages site sites server servers
user users username password login account folder directory path paths
filename filepath download upload input output config configuration
readme license copyright github gitlab repository repo commit branch
notebook notebooks jupyter script scripts python2 python3 pip conda
condition conditions environment environments situation situations
technology technologies requirement requirements capability capabilities
opportunity opportunities challenge challenges advantage advantages
limitation limitations motivation background consequence consequences
importance presence absence addition description evaluation evaluations
implementation implementations contribution contributions experience
knowledge understanding attention interest community literature
reference references publication publications author authors journal
represent represents representing representative detrimental beneficial
investigating examining exploring assessing addressing enabling
difference differences parameter parameters criterion criteria
formation variation variations selection selection combination
""".split())

# Tokens shorter than this are noise ("of", "we", "eV" units, indices).
MIN_TOKEN_LENGTH = 3
# A single word must be at least this long to count as a *specific* research
# term. Multi-word keyword phrases are exempt -- "spin coating" is specific
# even though neither half is long.
MIN_SPECIFIC_LENGTH = 4
# A PLAIN lowercase word -- no digit, no hyphen, not an acronym, not a curated
# keyword -- has to be at least this long before it is treated as technical.
#
# This is the rule that stops a small corpus from inventing vocabulary. Rarity
# alone cannot make a word technical: `particular` in two records out of 32 is
# arithmetically as rare as `chalcogenide`, and the difference between them is
# not something document frequency can see. Length is a crude proxy for
# "someone coined this for a subject", and it is deliberately crude -- it is
# only ONE of the ways a term can qualify (see `is_intrinsically_technical`),
# so a short real term still gets in as a tag, an acronym or a formula.
#
# The cost is real and accepted: a short free-text term that is never tagged,
# never capitalised and never hyphenated (`exciton`, `phonon`, `qubit`) is not
# counted from prose alone. That loses recommendations rather than inventing
# them, which is the direction this feature is required to fail in.
LONG_TECHNICAL_LENGTH = 9

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

# Concepts BOTH titles carry. Two is enough to be strong on its own: a title
# is a deliberate summary, so two independent technical terms appearing in
# both is a much stronger statement than the same pair found in two abstracts.
STRONG_SHARED_TITLE_COUNT = 2

# How many of each list a reader is shown. Three, not five: on a real corpus
# five slots were filled by relaxing what counted as evidence, and the fifth
# was routinely the least convincing. The lists are capped AFTER the gate and
# the sort, never padded to reach this number.
MAX_RESULTS = 3

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

# What a technical token LOOKS like, in any field, before it is lowercased:
# an acronym (DFT, GW, MBPT, WEST), a formula or named method carrying a digit
# (G0W0, BiVO4, C60), or an internal capital (BiVO4, NaCl, TiO2).
#
# This is how a SHORT real term gets in without a domain dictionary. It reads
# the author's own typography rather than guessing at meaning.
_SURFACE_TECHNICAL_RE = re.compile(
    r"\b(?:[A-Z]{2,}[A-Za-z0-9]*"          # DFT, MBPT, WEST
    r"|[A-Za-z]+[0-9]+[A-Za-z0-9]*"        # G0W0, C60, BiVO4
    r"|[A-Z][a-z]*[A-Z][A-Za-z0-9]*)\b")   # NaCl, BiVO4


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


def _fold_variants(words):
    """Add the singular-folded spelling of every listed word.

    `tokenize` folds plurals before anything else sees a token, so a blocklist
    entry written in the plural would never match: "technologies" arrives as
    "technologie". Folding the lists themselves means an entry can be written
    either way and still work, instead of the list silently having a hole.
    """
    folded = set(words)
    folded.update(_singular(word) for word in words)
    return frozenset(folded)


STOPWORDS = _fold_variants(STOPWORDS)
GENERIC_TERMS = _fold_variants(GENERIC_TERMS)
NON_TECHNICAL_TERMS = _fold_variants(NON_TECHNICAL_TERMS)


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


def is_ordinary(term):
    """Is this a word any paper on any subject could use?"""
    return (not term or term in STOPWORDS or term in GENERIC_TERMS
            or term in NON_TECHNICAL_TERMS)


def is_intrinsically_technical(term):
    """Could this term identify a SUBJECT, judged from the term alone?

    Deliberately independent of the corpus. Document frequency answers "is
    this rare here", which on a small server is mostly noise; this answers "is
    this the kind of word somebody coined for a topic", which is the question
    that actually decides whether sharing it means anything.

    Qualifying shapes, none of them domain-specific:

      * a multi-word phrase with at least one non-ordinary part -- a curated
        tag like "spin coating" is a deliberate statement about the record;
      * a digit inside the token (`g0w0`, `c60`, `bivo4`);
      * an internal hyphen (`dielectric-dependent`, `bethe-salpeter`);
      * failing all of those, a plain word of at least
        LONG_TECHNICAL_LENGTH characters.

    Acronyms and formulas that survive none of these once lowercased (`dft`,
    `gw`, `nacl`) are recognised from their SURFACE form instead, per profile
    -- see `Profile.add_text`.
    """
    if not term:
        return False
    if " " in term:
        parts = term.split()
        return any(not is_ordinary(part) for part in parts)
    if is_ordinary(term):
        return False
    # A page range, a year span or a figure number is not a research term.
    # `1-2` survives tokenization because hyphens are kept for the sake of
    # `dielectric-dependent`, so numbers-and-punctuation are ruled out here.
    if not any(character.isalpha() for character in term):
        return False
    if any(character.isdigit() for character in term):
        return True
    if "-" in term:
        return True
    return len(term) >= LONG_TECHNICAL_LENGTH


def surface_technical_terms(value):
    """Normalized tokens that were written as an acronym, a formula or a
    mixed-case name in the ORIGINAL text."""
    found = set()
    for match in _SURFACE_TECHNICAL_RE.finditer(str(value or "")):
        for token in tokenize(match.group(0)):
            if not is_ordinary(token):
                found.add(token)
    return found


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
                 "field_terms", "author_keys", "author_names", "title_key",
                 "surface_terms", "title_terms")

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
        # Tokens the author wrote as an acronym, a formula or a mixed-case
        # name. Kept apart from text_counts because case is destroyed by
        # normalization, and it is the only evidence that a SHORT token is
        # technical rather than ordinary.
        self.surface_terms = set()
        # Terms from the title specifically. A title is the most deliberate
        # sentence in a record, so an overlap there is worth more than the
        # same overlap buried in an abstract.
        self.title_terms = set()
        # key -> the name as this side spells it, so a reason can name the
        # person rather than the matching key.
        self.author_names = {}
        for name in self.authors:
            key = author_key(name)
            if key:
                self.author_names.setdefault(key, name)
        self.author_keys = set(self.author_names)
        self.title_key = normalize_title_key(self.title)

    def add_text(self, value, weight=1, is_title=False):
        # Ordinary words are dropped HERE rather than only at the specificity
        # check, so they cannot inflate text similarity either. Two abstracts
        # that share nothing but "study", "data", "analysis", "particular" and
        # "discussed" must measure as unrelated, not as a strong match.
        self.surface_terms |= surface_technical_terms(value)
        for token in tokenize(value):
            if is_ordinary(token):
                continue
            self.text_counts[token] += weight
            if is_title:
                self.title_terms.add(token)

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

    @property
    def technical_terms(self):
        """The terms of this record that could identify a SUBJECT.

        A term qualifies by its own shape (`is_intrinsically_technical`), or
        because the author wrote it as an acronym or formula, or because a
        curator chose it as a tag, chart property, artifact keyword or tool
        name. Curated single words still have to clear MIN_SPECIFIC_LENGTH
        and not be ordinary -- a "python" tag is a fact about the toolchain,
        not a statement that two records study the same thing.
        """
        terms = {t for t in self.all_terms if is_intrinsically_technical(t)}
        terms |= {t for t in self.surface_terms if not is_ordinary(t)}
        for curated in self.keyword_terms | self.method_terms:
            if is_ordinary(curated):
                continue
            if " " in curated or len(curated) >= MIN_SPECIFIC_LENGTH:
                terms.add(curated)
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
    profile.add_text(profile.title, weight=2, is_title=True)
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


# Bumped only when the ALLOWLIST below changes, so a deployment that starts
# reading a new field invalidates every cached answer that was computed
# without it.
FINGERPRINT_VERSION = "1"


def _artifact_fingerprint(artifacts, keys):
    return [[_text(artifact, key) for key in keys]
            for artifact in (artifacts or []) if isinstance(artifact, dict)]


def _text(source, key):
    value = (source or {}).get(key)
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return "" if value is None else str(value)


def metadata_fingerprint(record):
    """A stable digest of exactly the public scientific metadata that decides
    a recommendation.

    This is what lets a cached external answer be thrown away the moment the
    record it describes is edited, without waiting out the TTL and without a
    migration: an entry whose fingerprint does not match (or which predates
    the field entirely) is simply a miss.

    The allowlist is the same set `build_internal_profile` reads, so the two
    cannot drift apart silently. RAW values are hashed, not normalized ones:
    the question is "did the curator change this record", not "did the change
    survive tokenization".

    Deliberately NOT included -- and therefore unable to invalidate a cache
    entry or to appear in one: owner_email, editor_emails, edit_history,
    info.insertedBy (curator name/email/affiliation), any RCC URL or file
    path (serverPath, fileServerPath, folderAbsolutePath, downloadPath,
    notebookPath), any `files` list or file content, drafts, sessions, CSRF
    tokens, and activation/audit bookkeeping.
    """
    record = record or {}
    reference = record.get("reference") or {}
    payload = [
        FINGERPRINT_VERSION,
        _text(reference, "DOI"),
        _text(reference, "title"),
        _text(reference, "publishedAbstract"),
        [[_text(person, "firstName"), _text(person, "middleName"),
          _text(person, "lastName")]
         for person in (reference.get("authors") or [])
         if isinstance(person, dict)],
        [str(tag) for tag in (record.get("tags") or [])],
        [str(item) for item in (record.get("collections") or [])],
        _artifact_fingerprint(record.get("charts"),
                              ("caption", "properties")),
        _artifact_fingerprint(record.get("datasets"), ("readme", "keywords")),
        _artifact_fingerprint(record.get("scripts"), ("readme", "keywords")),
        _artifact_fingerprint(record.get("tools"),
                              ("packageName", "programName", "facilityname",
                               "facilityName", "measurement", "readme")),
    ]
    encoded = json.dumps(payload, ensure_ascii=False,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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
    profile.add_text(profile.title, weight=2, is_title=True)
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

    def is_rare_enough(self, term):
        """Is this term still a fingerprint on THIS corpus, or has it become a
        field label? Rarity is necessary, never sufficient."""
        # Floor of 2, not 1: a term carried by exactly the two records being
        # compared and nobody else is the *most* specific overlap there is.
        # A ratio-only ceiling would rule it out on any corpus smaller than
        # ~14 records, which is every new Qresp instance.
        ceiling = max(2.0,
                      SPECIFIC_DOCUMENT_FREQUENCY_RATIO * self.document_count)
        return self.document_frequency.get(term, 0) <= ceiling

    def is_specific(self, term):
        """A term precise enough to justify a recommendation on its own merit.

        TWO independent conditions, and both are required:

          * the term must look like subject vocabulary at all
            (`is_intrinsically_technical`), and
          * it must still be rare on this corpus (`is_rare_enough`).

        The first half is what was missing. Rarity used to be the only test,
        so on a 65-record server any ordinary word appearing in fewer than ten
        abstracts was promoted to a "specific research term" and shown to
        readers as the reason two papers were related.
        """
        if not is_intrinsically_technical(term):
            return False
        return self.is_rare_enough(term)

    def specific_terms(self, profile):
        """The subject vocabulary of one record, as this corpus sees it."""
        return {t for t in profile.technical_terms
                if not is_ordinary(t) and self.is_rare_enough(t)}

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
                 "shared_terms", "shared_weight", "author_overlap")

    def __init__(self, passes, score, evidence, similarity, shared_terms,
                 shared_weight=0.0, author_overlap=0):
        # How many authors the two records share. Recorded for ORDERING only:
        # it is not evidence, it cannot pass a candidate, and it is never
        # rendered into a reason.
        self.author_overlap = author_overlap
        self.passes = passes
        self.score = score
        self.evidence = evidence
        self.similarity = similarity
        self.shared_terms = shared_terms
        # Combined IDF of the shared specific terms. Carried so a verdict can
        # be EXPLAINED (how far short of the strong bar was it?) without
        # anything having to recompute -- and therefore risk disagreeing with
        # -- the gate.
        self.shared_weight = shared_weight

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
    # Counted, never gated on. See the note above the gate.
    shared_authors = current.author_keys & candidate.author_keys
    # Curated overlap is filtered through the SAME specific-term test as free
    # text, so a tag can never smuggle in an ordinary word that prose could
    # not. Short curated terms still qualify -- a tag is a deliberate
    # statement, which is why `Profile.technical_terms` admits them.
    shared_methods = {t for t in current.method_terms & candidate.method_terms
                      if t in current_specific and t in candidate_specific}
    shared_keywords = {t for t in current.keyword_terms & candidate.keyword_terms
                       if t in current_specific and t in candidate_specific}
    shared_fields = current.field_terms & candidate.field_terms
    # Concepts both records put in their TITLE. A title is the most deliberate
    # sentence a record has, so an overlap there is a much stronger statement
    # than the same overlap buried in an abstract.
    shared_titles = independent_terms(
        {t for t in shared_specific
         if t in current.title_terms and t in candidate.title_terms})
    # "The same topic", used to corroborate a shared tool. A shared tool with
    # no topic overlap is a lab habit, not a relationship -- so the tool names
    # themselves are excluded from what counts as the topic, or every shared
    # tool would corroborate itself.
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

    if len(shared_titles) >= STRONG_SHARED_TITLE_COUNT:
        evidence.append(Evidence(
            FAMILY_TERMS, STRONG,
            "Both titles are about %s"
            % _term_list(shared_titles, stats)))

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

    # NOTE: there is deliberately NO author evidence.
    #
    # A shared author says who did the work, not what it was about. On a real
    # server one PI co-authors half the corpus, so "shared author" fires
    # almost everywhere and, paired with any second weak signal, pushed
    # unrelated subjects through the gate. It is now counted (below) purely to
    # order candidates that have ALREADY passed on their own topic, and it
    # never appears in a reason -- what a reader is shown has to be the
    # technical overlap that actually decided the verdict.

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

    # The gate is TOPIC-ONLY. Every family that can contribute is a statement
    # about subject matter; there is no family here that a person's name can
    # reach, so removing every author from both records cannot change this
    # verdict. `test_relatedness_quality.py` asserts exactly that.
    strong_count = sum(1 for e in evidence if e.strength == STRONG)
    medium_families = {e.family for e in evidence if e.strength == MEDIUM}
    passes = strong_count >= 1 or len(medium_families) >= 2

    score = sum(STRENGTH_WEIGHT[e.strength] for e in evidence)
    score += similarity
    score += min(shared_weight, 10.0) / 10.0

    return Assessment(passes, round(score, 6), evidence, similarity,
                      sorted(shared_specific), shared_weight,
                      author_overlap=len(shared_authors))


def rank(current, candidates, stats, citation_dois=frozenset(),
         limit=MAX_RESULTS):
    """Assess every candidate, drop the ones that fail the gate, and return
    at most `limit` of them as (profile, assessment), best first.

    Order of operations, and it matters: **gate, then sort, then cut**. The
    cut is the last thing that happens, so a short list -- including an empty
    one -- is what a reader gets when nothing else clears the bar. Nothing
    here relaxes the gate to reach `limit`.

    The shared-author count is a TIE-BREAKER and nothing more: it is consulted
    only after the topical score, between candidates the gate already passed
    on their own subject matter.
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
                                  -pair[1].author_overlap,
                                  -(pair[0].year or 0),
                                  pair[0].title.lower()))
    return scored[:limit]
