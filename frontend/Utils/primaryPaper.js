import { namesUtil } from "./utils";

// Primary-paper metadata adapter (Auto-Curation Lite).
//
// The curator state's `referenceInfo` slice is the ONE canonical
// primary-paper bibliography ("Publication Information for This Paper"):
// it serializes into the published record's `reference` block, which
// search/details/publish/dedup read. There is no separate cited-works
// model. This adapter is the importer's only write path.

// Bibliographic fields the primary-paper importer may propose. Everything
// else (curator identity, PaperStack/collections, notebook, file server,
// sections, workflow, license, documentation) is NOT reachable through this
// adapter; Principal Investigators change ONLY via the explicit
// selected-authors opt-in below.
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
// import may append to, and PIs for the authors-as-PIs opt-in). Absent
// fields read as empty on any state shape.
export const primaryPaperFromState = (state = {}) => {
  const biblio = state.referenceInfo || {};
  const paper = state.paperInfo || {};
  return {
    kind: biblio.kind || "",
    title: biblio.title || "",
    authors: biblio.authors || "",
    doi: biblio.doi || "",
    publication: biblio.publication || "",
    year: biblio.year != null ? biblio.year : null,
    url: biblio.url || "",
    abstract: biblio.abstract || "",
    tags: paper.tags || [],
    PIs: paper.PIs || "",
  };
};

// Return a NEW curator state with the selected primary-paper fields applied,
// tag suggestions appended, and — only for authors the curator explicitly
// ticked — the selected authors APPENDED to the Principal Investigators
// (never replacing existing PIs, skipping duplicates). Only referenceInfo
// (whitelisted fields) and paperInfo.tags/PIs can change; every other slice
// passes through untouched, so open-form values collected before the call
// survive.
export const applyPrimaryPaperToState = (
  state,
  updates = {},
  tags = [],
  selectedAuthors = []
) => {
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
  const paper = state.paperInfo || {};
  const nextPaper = { ...paper };
  let paperChanged = false;
  if (tags.length) {
    nextPaper.tags = [...(paper.tags || []), ...tags];
    paperChanged = true;
  }
  if (selectedAuthors.length) {
    const additions = namesUtil.set(selectedAuthors);
    const existing = (paper.PIs || "").trim();
    const existingNames = existing
      .split(",")
      .map((name) => name.replace(/\s+/g, " ").trim().toLowerCase())
      .filter(Boolean);
    const fresh = additions
      .split(",")
      .map((name) => name.trim())
      .filter(
        (name) =>
          name &&
          !existingNames.includes(
            name.replace(/\s+/g, " ").trim().toLowerCase()
          )
      );
    if (fresh.length) {
      nextPaper.PIs = existing
        ? `${existing}, ${fresh.join(", ")}`
        : fresh.join(", ");
      paperChanged = true;
    }
  }
  if (paperChanged) {
    next.paperInfo = nextPaper;
  }
  return next;
};
