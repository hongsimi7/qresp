import { Fragment, useContext, useMemo, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import CuratorContext from "../../Context/Curator/curatorContext";
import AlertContext from "../../Context/Alert/alertContext";

// "Analyze RCC Folder" — reads the selected (or saved) file-server folder and
// proposes Charts/Datasets/Scripts/Tools for review. The backend does the
// fetching (it is the only side that knows which roots are readable), returns
// an analysis and stores nothing. Here every candidate starts UNCHECKED and
// stays editable; "Add selected items to Curator" appends to Curator state
// only — it never saves a draft, never publishes, and never touches records
// the curator already created.

const GROUPS = [
  { key: "charts", type: "chart", label: "Charts" },
  { key: "datasets", type: "dataset", label: "Datasets" },
  { key: "scripts", type: "script", label: "Scripts" },
  { key: "tools", type: "tool", label: "Tools" },
  { key: "unclassified", type: null, label: "Unclassified", secondary: true },
];

// One AI request covers at most this many selected candidates, so a large
// selection cannot silently turn into an oversized (and expensive) call.
const MAX_AI_BATCH = 10;

// Where an accepted AI proposal is allowed to land, per kind. Anything not
// listed here — image files, figure numbers, file lists, package names,
// versions, executables, patches, facilities, measurements — is factual and
// is never touched by AI.
const AI_TARGETS = {
  chart: { description: "caption", keywords: "properties" },
  dataset: { description: "readme", keywords: null },
  script: { description: "readme", keywords: null },
  tool: { description: "description", keywords: null },
};

const list = (value) => (Array.isArray(value) ? value.join(", ") : value || "");

const split = (value) =>
  String(value || "")
    .split(",")
    .map((el) => el.trim())
    .filter(Boolean);

const basename = (path) => String(path || "").split("/").filter(Boolean).pop() || "";

const dirname = (path) => {
  const value = String(path || "");
  return value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
};

// The proposal as the curator edits it: arrays become comma-separated text so
// the fields behave like the manual Add forms.
const toDraft = (candidate) => {
  const p = candidate.proposal || {};
  if (candidate.kind === "chart") {
    return {
      imageFile: p.imageFile || "",
      number: String(p.number == null ? "" : p.number),
      caption: p.caption || "",
      properties: list(p.properties),
      files: list(p.files),
      notebookFile: p.notebookFile || "",
    };
  }
  if (candidate.kind === "tool") {
    return {
      packageName: p.packageName || "",
      version: p.version || "",
      executableName: p.executableName || "",
      description: p.description || "",
      urls: p.urls || "",
      patches: list(p.patches),
    };
  }
  return { files: list(p.files), readme: p.readme || "", URLs: list(p.URLs) };
};

// The draft mapped back to the exact shape the manual Add forms store, so an
// applied candidate is indistinguishable from a hand-entered record (and
// stays fully editable afterwards). `id` is deliberately absent: the reducer
// mints collision-safe ids for the whole batch.
const toRecord = (kind, draft) => {
  if (kind === "chart") {
    return {
      caption: draft.caption,
      number: draft.number,
      properties: split(draft.properties),
      files: split(draft.files),
      imageFile: draft.imageFile,
      notebookFile: draft.notebookFile,
      extraFields: [],
    };
  }
  if (kind === "tool") {
    return {
      kind: "software",
      packageName: draft.packageName,
      version: draft.version,
      executableName: draft.executableName,
      patches: split(draft.patches),
      description: draft.description,
      urls: draft.urls,
      extraFields: [],
    };
  }
  return {
    files: split(draft.files),
    readme: draft.readme,
    URLs: split(draft.URLs),
    extraFields: [],
  };
};

// A short, scannable label. The exact relative paths stay in the candidate
// data (and in the applied record) — they live under Details, not in the
// card header, so a folder of forty files is still readable.
const labelOf = (candidate) => {
  const p = candidate.proposal || {};
  if (candidate.kind === "chart") {
    const path = p.imageFile || "";
    const parent = basename(dirname(path));
    return {
      primary: parent ? `${parent} / ${basename(path)}` : basename(path),
      secondary: "",
    };
  }
  if (candidate.kind === "script") {
    const path = (p.files || [])[0] || "";
    return { primary: basename(path), secondary: dirname(path) };
  }
  if (candidate.kind === "tool") {
    return {
      primary: `${p.packageName || ""} ${p.version || ""}`.trim(),
      secondary: "",
    };
  }
  const directory = dirname((p.files || [])[0] || "");
  const count = (p.files || []).length;
  return {
    primary: `${directory ? basename(directory) : "folder root"} · ${count} file${
      count === 1 ? "" : "s"
    }`,
    secondary: directory,
  };
};

const FIELD_LABELS = {
  imageFile: "Image file",
  number: "Figure number (proposed order)",
  caption: "Caption",
  properties: "Properties (comma separated)",
  files: "Files (comma separated)",
  notebookFile: "Notebook file",
  packageName: "Package name",
  version: "Version",
  executableName: "Executable name",
  description: "Description",
  urls: "URL",
  patches: "Patches (comma separated)",
  readme: "Description",
  URLs: "URLs (comma separated)",
};

const FolderAnalysis = ({ path }) => {
  const { fileServerPath, addMany } = useContext(CuratorContext) || {};
  const { setAlert } = useContext(AlertContext) || {};

  // The folder to analyze. An explicit `path` wins even when it is empty —
  // that is the File Server form telling us "nothing is selected yet" — while
  // omitting it (the saved display card) falls back to Curator state. The
  // backend still validates whatever is sent against its own allowed roots.
  const target = (path === undefined ? fileServerPath : path) || "";

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [selected, setSelected] = useState({});
  const [removed, setRemoved] = useState({});
  const [detailsOpen, setDetailsOpen] = useState({});
  const [editOpen, setEditOpen] = useState({});
  const [showUnclassified, setShowUnclassified] = useState(false);
  const [tab, setTab] = useState(0);
  // Optional AI enrichment: a SEPARATE action over the candidates already
  // selected, behind its own always-unchecked consent box. Selecting
  // candidates never sends anything by itself, the deterministic analysis
  // works whether or not the provider is configured, and a returned proposal
  // is only ever a SUGGESTION — it is parked here until the curator accepts
  // it into a field.
  const [aiConsent, setAiConsent] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState({});

  const ready = Boolean(target.trim());

  const close = () => {
    setOpen(false);
    setLoading(false);
    setError("");
    setAnalysis(null);
    setDrafts({});
    setSelected({});
    setRemoved({});
    setDetailsOpen({});
    setEditOpen({});
    setShowUnclassified(false);
    setTab(0);
    setAiConsent(false);
    setAiLoading(false);
    setAiNotice("");
    setAiSuggestions({});
  };

  const analyze = async () => {
    setOpen(true);
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await axios.post("/api/curation/analyze-folder", {
        path: target,
      });
      const data = response.data || {};
      const initial = {};
      GROUPS.forEach(({ key, type }) => {
        if (!type) return;
        ((data.candidates || {})[key] || []).forEach((candidate) => {
          initial[candidate.id] = toDraft(candidate);
        });
      });
      setDrafts(initial);
      setAnalysis(data);
    } catch (err) {
      setError(
        (err && err.response && err.response.data && err.response.data.error) ||
          "The folder could not be analyzed."
      );
    } finally {
      setLoading(false);
    }
  };

  const candidatesFor = (key) =>
    (((analysis || {}).candidates || {})[key] || []).filter(
      (candidate) => !removed[candidate.id]
    );

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );

  // Everything the AI action may see, built here so the allowlist is visible:
  // the SELECTED candidate's id/kind, its display name, its RELATIVE paths,
  // and the text Qresp already extracted locally (docstrings, manifest lines,
  // evidence). No unselected candidate, no file contents, no image bytes, no
  // credentials, no profile or ownership data, nothing outside the folder.
  const aiItems = () => {
    const items = [];
    GROUPS.forEach(({ key, type }) => {
      if (!type) return;
      candidatesFor(key)
        .filter((candidate) => selected[candidate.id])
        .forEach((candidate) => {
          const draft = drafts[candidate.id] || {};
          items.push({
            id: candidate.id,
            kind: type,
            name: labelOf(candidate).primary,
            paths: candidate.paths || [],
            context: [draft.readme, draft.description]
              .concat(candidate.evidence || [])
              .filter(Boolean)
              .join(" "),
          });
        });
    });
    return items;
  };

  const describeWithAI = async () => {
    const items = aiItems();
    if (items.length > MAX_AI_BATCH) {
      // Refused locally: no request is made at all.
      setAiNotice(
        `One AI request covers at most ${MAX_AI_BATCH} candidates — you have ` +
          `${items.length} selected. Uncheck some and try again.`
      );
      return;
    }
    setAiLoading(true);
    setAiNotice("");
    try {
      const response = await axios.post("/api/curation/describe-candidates", {
        consent: true,
        items,
      });
      const suggestions = (response.data || {}).suggestions || {};
      const count = Object.keys(suggestions).length;
      // Parked as proposals ONLY. Nothing the curator typed is touched, and
      // no field is filled until they accept it below.
      setAiSuggestions((current) => ({ ...current, ...suggestions }));
      setAiNotice(
        count
          ? `AI proposed text for ${count} item(s). Nothing has been filled in ` +
            "— review each proposal and accept the ones you want."
          : "The AI service returned no usable suggestions."
      );
    } catch (err) {
      setAiNotice(
        (err && err.response && err.response.data && err.response.data.error) ||
          "AI descriptions could not be generated."
      );
    } finally {
      setAiLoading(false);
    }
  };

  const apply = () => {
    let total = 0;
    GROUPS.forEach(({ key, type }) => {
      if (!type) return;
      const records = candidatesFor(key)
        .filter((candidate) => selected[candidate.id])
        .map((candidate) => toRecord(type, drafts[candidate.id]));
      if (records.length) {
        total += records.length;
        addMany(type, records);
      }
    });
    if (setAlert) {
      setAlert(
        "Added to the form",
        `${total} item(s) were added to this curation form. Nothing has been ` +
          "saved or published — review each one and use Save when you are ready.",
        null
      );
    }
    close();
  };

  const setField = (id, field, value) =>
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], [field]: value },
    }));

  const toggle = (setter, id) =>
    setter((current) => ({ ...current, [id]: !current[id] }));

  const renderAiProposal = (candidate) => {
    const suggestion = aiSuggestions[candidate.id];
    if (!suggestion) return null;
    const targets = AI_TARGETS[candidate.kind] || {};
    const draft = drafts[candidate.id] || {};
    const description = suggestion.description || "";
    const keywords = suggestion.keywords || [];
    const descriptionField = targets.description;
    const keywordField = targets.keywords;

    return (
      <Box
        sx={{
          mt: 1,
          p: 1.5,
          borderRadius: 1,
          border: 1,
          borderColor: "info.light",
          bgcolor: "action.hover",
        }}
      >
        <Typography variant="caption" color="text.secondary" display="block">
          AI proposal — not applied
        </Typography>
        {description ? (
          <Fragment>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
            <Button
              size="small"
              onClick={() =>
                setField(candidate.id, descriptionField, description)
              }
            >
              {`Use as ${FIELD_LABELS[descriptionField] || descriptionField}`}
            </Button>
            {draft[descriptionField] ? (
              <Typography variant="caption" color="text.secondary">
                replaces what you typed
              </Typography>
            ) : null}
          </Fragment>
        ) : (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            The AI had too little evidence to describe this one — the field
            stays blank for you to fill in.
          </Typography>
        )}
        {keywords.length > 0 && (
          <Box sx={{ mt: 1, display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {keywords.map((keyword) => (
              <Chip key={keyword} size="small" variant="outlined" label={keyword} />
            ))}
            {keywordField ? (
              <Button
                size="small"
                onClick={() =>
                  setField(candidate.id, keywordField, keywords.join(", "))
                }
              >
                {`Use as ${FIELD_LABELS[keywordField] || keywordField}`}
              </Button>
            ) : (
              <Typography variant="caption" color="text.secondary">
                suggested keywords — this record type has no keyword field
              </Typography>
            )}
          </Box>
        )}
      </Box>
    );
  };

  const renderCandidate = (candidate) => {
    const draft = drafts[candidate.id] || {};
    const needs = candidate.needs_input || [];
    const { primary, secondary } = labelOf(candidate);
    const isSelected = Boolean(selected[candidate.id]);
    // Fields appear once the candidate matters: it is selected, or the
    // curator explicitly opened it. An unselected card stays a single line.
    const fieldsVisible = isSelected || Boolean(editOpen[candidate.id]);

    return (
      <Box
        key={candidate.id}
        sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1.5 }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Checkbox
            size="small"
            checked={isSelected}
            onChange={(event) =>
              setSelected((current) => ({
                ...current,
                [candidate.id]: event.target.checked,
              }))
            }
            slotProps={{ input: { "aria-label": `Select ${primary}` } }}
          />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap title={primary}>
              {primary}
            </Typography>
            {secondary ? (
              <Typography variant="caption" color="text.secondary" noWrap
                display="block">
                {secondary}
              </Typography>
            ) : null}
          </Box>
          <Chip
            size="small"
            label={candidate.confidence}
            data-testid={`confidence-${candidate.id}`}
          />
          {needs.length > 0 && (
            <Tooltip title={`Needs your input: ${needs.join(", ")}`}>
              <Chip size="small" color="warning" label="needs input" />
            </Tooltip>
          )}
          <Button size="small" onClick={() => toggle(setDetailsOpen, candidate.id)}>
            Details
          </Button>
          {!isSelected && (
            <Button size="small" onClick={() => toggle(setEditOpen, candidate.id)}>
              Edit proposal
            </Button>
          )}
          <Button
            size="small"
            onClick={() =>
              setRemoved((current) => ({ ...current, [candidate.id]: true }))
            }
          >
            Remove
          </Button>
        </Box>

        <Collapse in={Boolean(detailsOpen[candidate.id])} unmountOnExit>
          <Box sx={{ pl: 5, pt: 1 }}>
            {(candidate.evidence || []).map((line) => (
              <Typography key={line} variant="caption" display="block">
                {line}
              </Typography>
            ))}
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ wordBreak: "break-all" }}
            >
              Files: {(candidate.paths || []).join(", ")}
            </Typography>
          </Box>
        </Collapse>

        {renderAiProposal(candidate)}

        <Collapse in={fieldsVisible} unmountOnExit>
          <Grid container spacing={1} sx={{ mt: 0.5, pl: 5 }}>
            {Object.keys(draft).map((field) => (
              <Grid key={field} size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  size="small"
                  label={FIELD_LABELS[field] || field}
                  value={draft[field]}
                  onChange={(event) =>
                    setField(candidate.id, field, event.target.value)
                  }
                  helperText={
                    needs.includes(field)
                      ? "Qresp could not determine this — please fill it in."
                      : " "
                  }
                />
              </Grid>
            ))}
          </Grid>
        </Collapse>
      </Box>
    );
  };

  const activeGroup = GROUPS[tab];
  const hints = ((analysis || {}).candidates || {}).possible_dependencies || [];
  const unclassified = ((analysis || {}).candidates || {}).unclassified || [];

  return (
    <Fragment>
      {/* Trigger only — the surrounding form owns the explanatory copy so the
          button can sit in a tight action row. */}
      <Tooltip
        title={
          ready
            ? "Propose charts, datasets, scripts and tools from this folder"
            : "Pick a file server folder first"
        }
      >
        <Box component="span" sx={{ display: "inline-flex" }}>
          <RegularStyledButton onClick={analyze} disabled={!ready}>
            Analyze RCC Folder
          </RegularStyledButton>
        </Box>
      </Tooltip>

      <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
        <DialogTitle>Folder analysis</DialogTitle>
        <DialogContent dividers>
          {loading && (
            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              <CircularProgress size={20} />
              <Typography variant="body2">Reading the folder…</Typography>
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {analysis && (
            <Fragment>
              <Typography variant="body2" gutterBottom>
                These are proposals from the folder’s file names and manifests.
                Nothing is selected by default, and nothing is saved or
                published — check what you want, edit it, then add it to the
                form.
              </Typography>
              {analysis.truncated && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Only part of the folder was inspected.
                </Alert>
              )}
              {(analysis.warnings || []).map((warning) => (
                <Alert key={warning} severity="info" sx={{ mb: 1 }}>
                  {warning}
                </Alert>
              ))}
              <Tabs
                value={tab}
                onChange={(event, next) => setTab(next)}
                variant="scrollable"
              >
                {GROUPS.map(({ key, label, secondary }) => (
                  <Tab
                    key={key}
                    sx={secondary ? { color: "text.secondary" } : undefined}
                    label={`${label} (${
                      key === "unclassified"
                        ? unclassified.length
                        : candidatesFor(key).length
                    })`}
                  />
                ))}
              </Tabs>
              <Divider sx={{ mb: 2 }} />
              {activeGroup.type ? (
                <Fragment>
                  {candidatesFor(activeGroup.key).length === 0 && (
                    <Typography variant="body2">
                      No {activeGroup.label.toLowerCase()} were proposed.
                    </Typography>
                  )}
                  {candidatesFor(activeGroup.key).map(renderCandidate)}
                  {activeGroup.key === "tools" && hints.length > 0 && (
                    <Alert severity="info">
                      Possible dependencies seen in script imports (not added
                      as tools — an import name is not a package version):{" "}
                      {hints.join(", ")}
                    </Alert>
                  )}
                </Fragment>
              ) : (
                <Fragment>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {unclassified.length} file(s) were not classified. Add them
                    by hand if they belong to the paper.
                  </Typography>
                  {unclassified.length > 0 && (
                    <Fragment>
                      <Button
                        size="small"
                        onClick={() => setShowUnclassified((value) => !value)}
                      >
                        {showUnclassified
                          ? "Hide file names"
                          : "Show file names"}
                      </Button>
                      <Collapse in={showUnclassified} unmountOnExit>
                        <Box sx={{ mt: 1, maxHeight: 240, overflowY: "auto" }}>
                          {unclassified.map((file) => (
                            <Typography
                              key={file}
                              variant="caption"
                              display="block"
                              sx={{ wordBreak: "break-all" }}
                            >
                              {file}
                            </Typography>
                          ))}
                        </Box>
                      </Collapse>
                    </Fragment>
                  )}
                </Fragment>
              )}
            </Fragment>
          )}
        </DialogContent>
        {analysis && (
          <Box sx={{ px: 3, py: 2, borderTop: 1, borderColor: "divider" }}>
            {aiNotice && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {aiNotice}
              </Alert>
            )}
            <FormControlLabel
              control={
                <Checkbox
                  checked={aiConsent}
                  onChange={(event) => setAiConsent(event.target.checked)}
                  slotProps={{
                    input: {
                      "aria-label":
                        "Send the selected file and folder names to the AI service",
                    },
                  }}
                />
              }
              label={
                "Send the selected items' file names, folder names and the " +
                "comments Qresp already read from them to Gemini. No file " +
                "contents, images, or account details are sent."
              }
            />
            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              <Button
                onClick={describeWithAI}
                disabled={!aiConsent || selectedCount === 0 || aiLoading}
              >
                Generate descriptions and keywords with AI
              </Button>
              {aiLoading && <CircularProgress size={18} />}
              {selectedCount === 0 && (
                <Typography variant="caption">
                  Select the candidates you want described first.
                </Typography>
              )}
            </Box>
          </Box>
        )}
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="contained"
            disabled={selectedCount === 0}
            onClick={apply}
          >
            Add selected items to Curator
          </Button>
        </DialogActions>
      </Dialog>
    </Fragment>
  );
};

FolderAnalysis.propTypes = {
  // Omit to analyze the saved fileServerPath; pass explicitly (even "") to
  // analyze a selection that has not been committed yet.
  path: PropTypes.string,
};

export default FolderAnalysis;
