// THE artifact field contract. One definition, used by every surface that
// shows or judges an artifact field.
//
// Folder Analysis used to hardcode its own labels, its own required set and
// its own draft shape, alongside whatever the Add/Edit forms happened to say.
// They drifted, and the drift was visible to curators: the same field was
// "Keywords" in one place and "Properties (comma separated)" in the other,
// an input labelled "Keywords" wrote to `URLs`, and optional fields were
// flagged "Needs input". Anything that renders, marks, validates or converts
// an artifact field reads this file instead.
//
// `key` is the STORAGE key and never changes for compatibility: a chart's
// keywords live in `properties` because every published record already
// stores them there.

// A Chart is a FIGURE: one image, its number in the paper, the paper's own
// caption for it, and the files it was made from. The labels say so. The
// storage keys deliberately do not move -- every published record already
// uses them -- and `caption` is never softened into a generic "Description",
// because a figure caption is a specific thing a paper already has.
const CHART = [
  { key: "imageFile", label: "Figure Image", required: true,
    help: "The image file for this figure. One image per Chart." },
  { key: "number", label: "Figure Number", required: true,
    help: "The figure's number in the paper (e.g. 2, S1). Qresp never " +
      "guesses it." },
  { key: "caption", label: "Figure Caption", required: true,
    ai: "description",
    help: "Use the paper's caption for this figure. If the figure has no " +
      "published caption, write a concise description of what it shows." },
  { key: "properties", label: "Keywords", required: true, list: true,
    ai: "keywords",
    help: "Keyword(s) for what the figure shows, comma separated." },
  { key: "files", label: "Input / Supporting Files", required: false,
    list: true,
    help: "Data or supporting files this figure was made from, comma " +
      "separated." },
  { key: "notebookFile", label: "Reproduction Notebook", required: false,
    help: "The notebook that reproduces this figure." },
];

// Datasets and scripts are the same shape. `URLs` is deliberately ABSENT: it
// is a legacy field that existing records may carry, and it is preserved
// untouched on save (see carryLegacy below), but it is not offered on any new
// surface and is never confused with keywords again.
const DATA = [
  { key: "files", label: "Files", required: true, list: true },
  { key: "readme", label: "Description", required: true, ai: "description" },
  { key: "keywords", label: "Keywords", required: false, list: true,
    ai: "keywords" },
];

// Folder analysis only ever proposes SOFTWARE tools; an experiment is never
// inferred from a folder, so the experiment fields are declared for the
// manual form and parity checks but are not part of the proposal shape.
const TOOL_SOFTWARE = [
  { key: "packageName", label: "Package Name", required: true },
  { key: "version", label: "Version", required: true },
  { key: "executableName", label: "Executable Name", required: false },
  { key: "patches", label: "Patches", required: false, list: true },
  { key: "description", label: "Description", required: false,
    ai: "description" },
  { key: "urls", label: "URLs", required: false },
];

const TOOL_EXPERIMENT = [
  { key: "facilityName", label: "Facility Name", required: true },
  { key: "measurement", label: "Measurement", required: true },
];

export const ARTIFACT_FIELDS = {
  chart: CHART,
  dataset: DATA,
  script: DATA,
  tool: TOOL_SOFTWARE,
};

export const TOOL_EXPERIMENT_FIELDS = TOOL_EXPERIMENT;

const fieldsOf = (kind) => ARTIFACT_FIELDS[kind] || [];

export const fieldsFor = fieldsOf;

export const labelFor = (kind, key) => {
  const field = fieldsOf(kind).find((entry) => entry.key === key);
  return field ? field.label : key;
};

// The one-line explanation a surface shows under the input, when the contract
// has one. Kept here so Folder Analysis and the Add/Edit form cannot explain
// the same field two different ways.
export const helpFor = (kind, key) => {
  const field = fieldsOf(kind).find((entry) => entry.key === key);
  return (field && field.help) || "";
};

export const isRequired = (kind, key) => {
  const field = fieldsOf(kind).find((entry) => entry.key === key);
  return Boolean(field && field.required);
};

export const requiredKeys = (kind) =>
  fieldsOf(kind)
    .filter((field) => field.required)
    .map((field) => field.key);

// Where an accepted AI proposal may land, per kind. A tool has no keyword
// field, so `keywords` is absent for it — the server does not return keywords
// for a tool either, so there is nothing to hide.
export const aiTargets = (kind) => {
  const targets = {};
  fieldsOf(kind).forEach((field) => {
    if (field.ai) targets[field.ai] = field.key;
  });
  return targets;
};

const asText = (value) =>
  Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);

const asList = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

// A backend proposal -> the editable draft, in contract order.
export const toDraft = (kind, proposal = {}) => {
  const draft = {};
  fieldsOf(kind).forEach((field) => {
    draft[field.key] = asText(proposal[field.key]);
  });
  return draft;
};

// The draft -> the exact shape the manual Add forms store, so an applied
// candidate is indistinguishable from a hand-entered one.
export const toRecord = (kind, draft = {}) => {
  const record = {};
  fieldsOf(kind).forEach((field) => {
    record[field.key] = field.list
      ? asList(draft[field.key])
      : draft[field.key] || "";
  });
  record.extraFields = [];
  if (kind === "tool") record.kind = "software";
  return record;
};

// Only a MISSING REQUIRED field needs the curator, and `required` is per
// KIND -- there is no field that is optional everywhere. A chart's Keywords
// (`properties`) ARE required, alongside Figure Image, Figure Number and
// Figure Caption; a dataset's or script's Keywords are not. Genuinely
// optional, and never flagged: a chart's Input / Supporting Files and its
// Reproduction Notebook.
export const missingRequired = (kind, draft = {}) =>
  requiredKeys(kind).filter((key) => !String(draft[key] || "").trim());

// Fields an existing record may carry that no current surface edits. They are
// copied through on save so nothing a curator stored years ago is dropped —
// and never read as, or converted into, anything else.
export const LEGACY_KEYS = {
  dataset: ["URLs"],
  script: ["URLs"],
};

export const carryLegacy = (kind, previous = {}, next = {}) => {
  const carried = { ...next };
  (LEGACY_KEYS[kind] || []).forEach((key) => {
    if (previous && previous[key] !== undefined) carried[key] = previous[key];
  });
  return carried;
};
