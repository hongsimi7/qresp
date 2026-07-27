import { Fragment, useContext, useMemo, useState } from "react";

import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import CuratorContext from "../../Context/Curator/curatorContext";
import AlertContext from "../../Context/Alert/alertContext";

// "Analyze RCC Folder" — reads the file-server folder the curator ALREADY
// saved and proposes Charts/Datasets/Scripts/Tools for review. The backend
// does the fetching (it is the only side that knows which roots are
// readable), returns an analysis and stores nothing. Here every candidate
// starts UNCHECKED and stays editable; "Add selected items to Curator"
// appends to Curator state only — it never saves a draft, never publishes,
// and never touches records the curator already created.

const GROUPS = [
  { key: "charts", type: "chart", label: "Charts" },
  { key: "datasets", type: "dataset", label: "Datasets" },
  { key: "scripts", type: "script", label: "Scripts" },
  { key: "tools", type: "tool", label: "Tools" },
  { key: "unclassified", type: null, label: "Unclassified" },
];

const list = (value) => (Array.isArray(value) ? value.join(", ") : value || "");

const split = (value) =>
  String(value || "")
    .split(",")
    .map((el) => el.trim())
    .filter(Boolean);

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

const titleOf = (candidate) => {
  const p = candidate.proposal || {};
  if (candidate.kind === "chart") return p.imageFile;
  if (candidate.kind === "tool")
    return `${p.packageName} ${p.version}`.trim();
  if (candidate.kind === "script") return (p.files || [])[0];
  const first = (p.files || [])[0] || "";
  const directory = first.includes("/")
    ? first.slice(0, first.lastIndexOf("/"))
    : "folder root";
  return `${directory} (${(p.files || []).length} files)`;
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

const FolderAnalysis = () => {
  const { fileServerPath, addMany } = useContext(CuratorContext) || {};
  const { setAlert } = useContext(AlertContext) || {};

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [selected, setSelected] = useState({});
  const [removed, setRemoved] = useState({});
  const [tab, setTab] = useState(0);

  const ready = Boolean((fileServerPath || "").trim());

  const close = () => {
    setOpen(false);
    setLoading(false);
    setError("");
    setAnalysis(null);
    setDrafts({});
    setSelected({});
    setRemoved({});
    setTab(0);
  };

  const analyze = async () => {
    setOpen(true);
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await axios.post("/api/curation/analyze-folder", {
        path: fileServerPath,
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

  const renderCandidate = (candidate) => {
    const draft = drafts[candidate.id] || {};
    const needs = candidate.needs_input || [];
    return (
      <Box
        key={candidate.id}
        sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 2 }}
      >
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Checkbox
            checked={Boolean(selected[candidate.id])}
            onChange={(event) =>
              setSelected((current) => ({
                ...current,
                [candidate.id]: event.target.checked,
              }))
            }
            slotProps={{
              input: { "aria-label": `Select ${titleOf(candidate)}` },
            }}
          />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle2">{titleOf(candidate)}</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", my: 0.5 }}>
              <Chip
                size="small"
                label={`${candidate.confidence} confidence`}
                data-testid={`confidence-${candidate.id}`}
              />
              {needs.length > 0 && (
                <Chip
                  size="small"
                  color="warning"
                  label={`Needs your input: ${needs.join(", ")}`}
                />
              )}
            </Box>
            {(candidate.evidence || []).map((line) => (
              <Typography key={line} variant="caption" display="block">
                {line}
              </Typography>
            ))}
            <Typography variant="caption" color="text.secondary" display="block">
              Files: {(candidate.paths || []).join(", ")}
            </Typography>
          </Box>
          <Button
            size="small"
            onClick={() =>
              setRemoved((current) => ({ ...current, [candidate.id]: true }))
            }
          >
            Remove
          </Button>
        </Box>
        <Grid container spacing={1} sx={{ mt: 1 }}>
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
      </Box>
    );
  };

  const activeGroup = GROUPS[tab];
  const hints = ((analysis || {}).candidates || {}).possible_dependencies || [];

  return (
    <Fragment>
      <Box sx={{ mt: 2 }}>
        <RegularStyledButton onClick={analyze} disabled={!ready}>
          Analyze RCC Folder
        </RegularStyledButton>
        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
          {ready
            ? "Inspects the saved folder and proposes charts, datasets, " +
              "scripts and tools for you to review. Nothing is saved or " +
              "published."
            : "Search for a file server folder and save it first — the " +
              "analysis reads the folder you already selected."}
        </Typography>
      </Box>

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
                {GROUPS.map(({ key, label }) => (
                  <Tab
                    key={key}
                    label={`${label} (${
                      key === "unclassified"
                        ? ((analysis.candidates || {}).unclassified || []).length
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
                  <Typography variant="body2" gutterBottom>
                    Qresp did not classify these files. Add them by hand if
                    they belong to the paper.
                  </Typography>
                  {((analysis.candidates || {}).unclassified || []).map(
                    (path) => (
                      <Typography key={path} variant="caption" display="block">
                        {path}
                      </Typography>
                    )
                  )}
                </Fragment>
              )}
            </Fragment>
          )}
        </DialogContent>
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

export default FolderAnalysis;
