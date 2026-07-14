// Primary-paper metadata adapter (Auto-Curation Lite).
//
// The PRIMARY paper's bibliography lives in the curator state's dedicated
// `publicationInfo` slice, owned by the "Add info about your paper"
// workflow (it serializes into the published document's legacy `reference`
// block — see Utils/model.js — so search/details/publish keep working and
// legacy records load via the same conversions). The separate
// "Add Reference to your paper" workflow owns `referenceInfo` (a CITED
// work, persisted as the optional `citedReference` block) and is never a
// destination of this adapter.

// Bibliographic fields the primary-paper importer may propose. Everything
// else (curator identity, collections/PaperStack, notebook, file server,
// sections, workflow, license, documentation) is NOT reachable through this
// adapter; PIs change ONLY via the explicit authorsAsPIs opt-in below.
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
// import may append to, and PIs for the optional authors-as-PIs opt-in).
// Absent fields read as empty on any state shape.
export const primaryPaperFromState = (state = {}) => {
  const publication = state.publicationInfo || {};
  const paper = state.paperInfo || {};
  return {
    kind: publication.kind || "",
    title: publication.title || "",
    authors: publication.authors || "",
    doi: publication.doi || "",
    publication: publication.publication || "",
    year: publication.year != null ? publication.year : null,
    url: publication.url || "",
    abstract: publication.abstract || "",
    tags: paper.tags || [],
    PIs: paper.PIs || "",
  };
};

// Return a NEW curator state with the selected primary-paper fields applied,
// tag suggestions appended, and — only when the curator explicitly opted in —
// the imported authors copied into the Principal Investigators field. Only
// publicationInfo (whitelisted fields) and paperInfo.tags/PIs can change;
// every other slice passes through untouched, so open-form values collected
// before the call survive. referenceInfo (the cited work) is never touched.
export const applyPrimaryPaperToState = (
  state,
  updates = {},
  tags = [],
  authorsAsPIs = ""
) => {
  const safeUpdates = {};
  PRIMARY_PAPER_FIELDS.forEach((field) => {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field];
    }
  });
  const next = {
    ...state,
    publicationInfo: { ...(state.publicationInfo || {}), ...safeUpdates },
  };
  const paper = state.paperInfo || {};
  const nextPaper = { ...paper };
  let paperChanged = false;
  if (tags.length) {
    nextPaper.tags = [...(paper.tags || []), ...tags];
    paperChanged = true;
  }
  if (authorsAsPIs) {
    nextPaper.PIs = authorsAsPIs;
    paperChanged = true;
  }
  if (paperChanged) {
    next.paperInfo = nextPaper;
  }
  return next;
};
