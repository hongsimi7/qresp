// Primary-paper metadata adapter (Auto-Curation Lite).
//
// What the legacy state actually stores: the curator state's `referenceInfo`
// slice IS the PRIMARY paper's bibliographic record — it persists as the
// published document's `reference` block, which drives paper details, search
// results, publish validation and verify-time dedup. The "Add Reference to
// your paper" form is the citation-of-record editor over that same slice
// (PaperInfoForm already writes into it: saving PIs calls
// setReferenceAuthors). There is no separate cited-works list in the schema.
//
// This adapter gives the "Add info about your paper" workflow a clearly
// named, non-destructive read/write path over that legacy storage, so the
// DOI/manuscript importer can target PRIMARY-paper metadata without being
// hard-wired to `referenceInfo` semantics, without calling the Reference
// form's setters, and without duplicating data or changing the persisted
// schema. Legacy records keep loading/editing/publishing byte-identically.

// Bibliographic fields the primary-paper importer may propose. Everything
// else (curator identity, PIs, collections, notebook, files, charts,
// datasets, tools, scripts, workflow, license, documentation) is explicitly
// NOT reachable through this adapter.
export const PRIMARY_PAPER_FIELDS = [
  "kind",
  "title",
  "authors",
  "doi",
  "publication",
  "year",
  "url",
  "abstract",
];

// Read the primary paper's current bibliographic values (plus tags, which
// import may append to). Works on any curator state, including legacy
// drafts/records — absent fields read as empty.
export const primaryPaperFromState = (state = {}) => {
  const ref = state.referenceInfo || {};
  const paper = state.paperInfo || {};
  return {
    kind: ref.kind || "",
    title: ref.title || "",
    authors: ref.authors || "",
    doi: ref.doi || "",
    publication: ref.publication || "",
    year: ref.year != null ? ref.year : null,
    url: ref.url || "",
    abstract: ref.abstract || "",
    tags: paper.tags || [],
  };
};

// Return a NEW curator state with the selected primary-paper fields applied
// and tag suggestions appended. Only the whitelisted bibliographic fields
// and paperInfo.tags can change; every other slice is passed through
// untouched, so open-form values collected before the call survive.
export const applyPrimaryPaperToState = (state, updates = {}, tags = []) => {
  const safeUpdates = {};
  PRIMARY_PAPER_FIELDS.forEach((field) => {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field];
    }
  });
  const next = {
    ...state,
    referenceInfo: { ...(state.referenceInfo || {}), ...safeUpdates },
  };
  if (tags.length) {
    const paper = state.paperInfo || {};
    next.paperInfo = { ...paper, tags: [...(paper.tags || []), ...tags] };
  }
  return next;
};
