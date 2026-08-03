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
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import CuratorContext from "../../Context/Curator/curatorContext";
import AlertContext from "../../Context/Alert/alertContext";
import { buildFileUrl } from "../../Utils/fileServerUrl";
import {
  aiTargets,
  fieldsFor,
  isRequired,
  labelFor,
  missingRequired,
  toDraft,
  toRecord,
} from "../../Utils/artifactFields";

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

// Grouped Unclassified rows rendered before "Show more".
const UNCLASSIFIED_ROWS = 25;

// Where an accepted AI proposal is allowed to land, per kind. Anything not
// listed here — image files, figure numbers, file lists, package names,
// versions, executables, patches, facilities, measurements — is factual and
// is never touched by AI.
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

// A short, scannable label.
//
// The BACKEND owns a candidate's identity (`label` + `file_count`). Deriving
// it here is what broke: since record boundaries became folders,
// proposal.files holds ONE folder path, so dirname() returned the role root
// and every dataset under data/ rendered as "data · 1 file". The fallbacks
// below only cover an older response shape, and never walk up to a parent.
const labelOf = (candidate) => {
  const p = candidate.proposal || {};
  const count = candidate.file_count;
  const suffix =
    typeof count === "number" && count > 0
      ? ` · ${count} file${count === 1 ? "" : "s"}`
      : "";

  if (candidate.label) {
    const first = (candidate.paths || [])[0] || "";
    const boundary = (p.files || [])[0] || p.imageFile || first;
    return {
      primary: `${candidate.label}${
        candidate.kind === "chart" || candidate.kind === "tool" ? "" : suffix
      }`,
      secondary: dirname(boundary),
      full: boundary,
    };
  }

  // --- fallbacks for a response without an explicit label ------------------
  if (candidate.kind === "chart") {
    const path = p.imageFile || (candidate.paths || [])[0] || "";
    const parent = basename(dirname(path));
    return {
      primary: parent ? `${parent} / ${basename(path)}` : basename(path),
      secondary: dirname(path),
      full: path,
    };
  }
  if (candidate.kind === "tool") {
    return {
      primary: `${p.packageName || ""} ${p.version || ""}`.trim(),
      secondary: "",
      full: (candidate.paths || [])[0] || "",
    };
  }
  const path = (p.files || [])[0] || (candidate.paths || [])[0] || "";
  return { primary: basename(path), secondary: dirname(path), full: path };
};

// A candidate a curator can actually see and judge. An unnamed card would
// render blank yet still be tickable and addable, so it never reaches the
// list, the selection, or the apply payload.
const isRenderable = (candidate) => {
  const { primary } = labelOf(candidate);
  return Boolean(
    (primary || "").trim() && ((candidate.paths || [])[0] || "").trim()
  );
};

// Evidence vocabulary, shared by the card chip and the per-field chips.
// "High evidence" is reserved for something a file directly states — an AI
// suggestion can never earn it (see the suggestion panel below).
const HIGH_EVIDENCE = "high";

const EVIDENCE_LABELS = {
  high: "High evidence",
  medium: "Medium evidence",
  low: "Low evidence",
  needs_input: "Needs input",
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
  const [showUnclassified, setShowUnclassified] = useState({});
  const [unclassifiedFilter, setUnclassifiedFilter] = useState("");
  const [showAllUnclassified, setShowAllUnclassified] = useState(false);
  // Record-boundary selection, keyed by role root. Nothing is selected by
  // default: the deterministic immediate-child boundaries are in force until
  // the curator rebuilds with a choice.
  const [boundaries, setBoundaries] = useState({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState(0);
  // Optional AI enrichment: a SEPARATE action over the candidates already
  // selected, behind its own always-unchecked consent box. Selecting
  // candidates never sends anything by itself, the deterministic analysis
  // works whether or not the provider is configured, and a returned proposal
  // is only ever a SUGGESTION — it is parked here until the curator accepts
  // it into a field.
  const [aiConsent, setAiConsent] = useState(false);
  // The candidate whose consent dialog is open, or null. Consent is asked
  // fresh for every candidate and is never remembered.
  const [aiConsentOpen, setAiConsentOpen] = useState(null);
  // Both keyed by candidate id: one candidate's request must not blank
  // another's result or show its spinner.
  const [aiLoading, setAiLoading] = useState({});
  const [aiNotice, setAiNotice] = useState({});
  const [aiSuggestions, setAiSuggestions] = useState({});
  // Candidate lists can be long. Nothing is discarded — the rest is one
  // explicit click away, and the count is always on screen.
  const [showAll, setShowAll] = useState({});

  // A chart folder may legitimately hold several images. Each one gets ONE
  // role, and the roles are mutually exclusive, so a path can never end up
  // both the primary image and a related file, or duplicated into a separate
  // chart. Keyed by candidate id, then by image path.
  const [imageRoles, setImageRoles] = useState({});

  const rolesFor = (candidate) => {
    const stored = imageRoles[candidate.id];
    if (stored) return stored;
    // The backend's suggestion is a starting point, not a decision: the
    // suggested primary is preselected and everything else is Unused.
    const primary = (candidate.proposal || {}).imageFile || "";
    const initial = {};
    (candidate.image_options || []).forEach((option) => {
      initial[option.path] = option.path === primary ? "primary" : "unused";
    });
    return initial;
  };

  // A notebook follows an image into its own chart ONLY on an unambiguous
  // name match, mirroring the backend rule. A shared notebook stays with the
  // original chart rather than being copied into both.
  const notebookFor = (candidate, imagePath) => {
    const notebook = (candidate.proposal || {}).notebookFile || "";
    if (!notebook) return "";
    const stem = (value) => basename(value).replace(/\.[^.]+$/, "");
    return stem(notebook).toLowerCase() === stem(imagePath).toLowerCase()
      ? notebook
      : "";
  };

  const setImageRole = (candidate, path, role) => {
    setImageRoles((current) => {
      const roles = { ...rolesFor(candidate), [path]: role };
      if (role === "primary") {
        // At most one primary. The previous one becomes Unused rather than
        // disappearing -- it is still in the folder, and still choosable.
        Object.keys(roles).forEach((other) => {
          if (other !== path && roles[other] === "primary") {
            roles[other] = "unused";
          }
        });
      }
      return { ...current, [candidate.id]: roles };
    });
    if (role === "primary") {
      setField(candidate.id, "imageFile", path);
    } else {
      const draft = drafts[candidate.id] || {};
      if (draft.imageFile === path) setField(candidate.id, "imageFile", "");
    }
  };

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
    setShowUnclassified({});
    setUnclassifiedFilter("");
    setShowAllUnclassified(false);
    setBoundaries({});
    setPickerOpen(false);
    setTab(0);
    setAiConsent(false);
    setAiConsentOpen(false);
    setAiLoading(false);
    setAiNotice("");
    setAiSuggestions({});
    setShowAll({});
  };

  const analyze = async (chosen) => {
    setOpen(true);
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await axios.post("/api/curation/analyze-folder", {
        path: target,
        // Only sent when the curator picked boundaries; the backend
        // validates every path against the tree it just listed.
        ...(chosen && Object.keys(chosen).length
          ? { boundaries: chosen }
          : {}),
      });
      const data = response.data || {};
      const initial = {};
      GROUPS.forEach(({ key, type }) => {
        if (!type) return;
        ((data.candidates || {})[key] || []).forEach((candidate) => {
          initial[candidate.id] = toDraft(candidate.kind,
                                          candidate.proposal);
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

  const EVIDENCE_ORDER = { high: 0, medium: 1, low: 2 };
  const DEFAULT_VISIBLE = 25;

  // Strongest evidence first, so the default view leads with what Qresp can
  // actually stand behind. Nothing is dropped by this ordering.
  const candidatesFor = (key) =>
    (((analysis || {}).candidates || {})[key] || [])
      .filter((candidate) => !removed[candidate.id] && isRenderable(candidate))
      .slice()
      .sort(
        (a, b) =>
          (EVIDENCE_ORDER[a.confidence] == null
            ? 3
            : EVIDENCE_ORDER[a.confidence]) -
          (EVIDENCE_ORDER[b.confidence] == null
            ? 3
            : EVIDENCE_ORDER[b.confidence])
      );

  // What the tab renders right now. Selected candidates are ALWAYS shown, so
  // collapsing the list can never hide something the curator picked.
  const visibleCandidatesFor = (key) => {
    const all = candidatesFor(key);
    if (showAll[key] || all.length <= DEFAULT_VISIBLE) {
      return all;
    }
    const head = all.slice(0, DEFAULT_VISIBLE);
    const kept = new Set(head.map((candidate) => candidate.id));
    return head.concat(
      all.slice(DEFAULT_VISIBLE).filter(
        (candidate) => selected[candidate.id] && !kept.has(candidate.id)
      )
    );
  };

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );

  // Everything the AI action may see, built here so the allowlist is visible:
  // the SELECTED candidate's id/kind, its display name, its RELATIVE paths,
  // and the text Qresp already extracted locally (docstrings, manifest lines,
  // evidence). No unselected candidate, no file contents, no image bytes, no
  // credentials, no profile or ownership data, nothing outside the folder.
  // The AI request is built for ONE candidate. The Add checkboxes are a
  // different concept entirely -- they choose what goes to the Curator -- and
  // they no longer decide what gets described. A batch shared one output
  // budget between candidates and invited the model to compare them, which is
  // what produced partial answers and interchangeable descriptions.
  const aiItem = (candidate) => {
    const draft = drafts[candidate.id] || {};
    return {
      id: candidate.id,
      kind: candidate.kind,
      name: labelOf(candidate).primary,
      paths: candidate.paths || [],
      context: [draft.readme, draft.description]
        .concat(candidate.evidence || [])
        .filter(Boolean)
        .join(" "),
    };
  };

  // Consent is asked FRESH every time: the box resets whenever the dialog
  // opens, and closing it (however) clears it again. There is deliberately
  // no remembered "always allow".
  const openAiConsent = (candidate) => {
    setAiConsent(false);
    setAiConsentOpen(candidate);
  };

  const closeAiConsent = () => {
    setAiConsentOpen(null);
    setAiConsent(false);
  };

  const describeWithAI = async (candidate) => {
    setAiConsentOpen(null);
    setAiConsent(false);
    if (!candidate) return;
    const id = candidate.id;
    // Loading and failure belong to THIS candidate: another candidate's
    // suggestion, or its error, is not disturbed by this request.
    setAiLoading((current) => ({ ...current, [id]: true }));
    setAiNotice((current) => ({ ...current, [id]: "" }));
    try {
      const response = await axios.post("/api/curation/describe-candidates", {
        consent: true,
        // Exactly one. The server rejects anything else before it calls the
        // provider or spends a quota unit.
        items: [aiItem(candidate)],
      });
      const suggestions = (response.data || {}).suggestions || {};
      const mine = suggestions[id];
      if (mine) {
        // Parked as a proposal ONLY. Nothing the curator typed is touched,
        // and no field is filled until they accept it below.
        setAiSuggestions((current) => ({ ...current, [id]: mine }));
        setAiNotice((current) => ({ ...current, [id]: "" }));
      } else {
        setAiNotice((current) => ({
          ...current,
          [id]: "No reliable suggestion was returned for this item.",
        }));
      }
    } catch (err) {
      setAiNotice((current) => ({
        ...current,
        [id]:
          (err && err.response && err.response.data &&
            err.response.data.error) ||
          "AI descriptions could not be generated.",
      }));
    } finally {
      setAiLoading((current) => ({ ...current, [id]: false }));
    }
  };

  const apply = () => {
    let total = 0;
    GROUPS.forEach(({ key, type }) => {
      if (!type) return;
      const records = [];
      candidatesFor(key)
        .filter((candidate) => selected[candidate.id])
        .forEach((candidate) => {
          const record = toRecord(type, drafts[candidate.id]);
          if (type === "chart") {
            const roles = rolesFor(candidate);
            // Related images join this chart's files, deduplicated and never
            // including the primary or anything promoted to its own chart.
            const related = Object.keys(roles).filter(
              (path) => roles[path] === "related" && path !== record.imageFile
            );
            record.files = Array.from(
              new Set((record.files || []).concat(related))
            ).filter((path) => roles[path] !== "separate");
            records.push(record);
            // "Create as separate Chart" makes another INCOMPLETE proposal,
            // exactly like any other folder proposal: caption, number and
            // keywords are the curator's to fill in.
            Object.keys(roles)
              .filter((path) => roles[path] === "separate")
              .forEach((path) => {
                records.push(
                  toRecord("chart", {
                    imageFile: path,
                    number: "",
                    caption: "",
                    properties: "",
                    files: "",
                    notebookFile: notebookFor(candidate, path),
                  })
                );
              });
          } else {
            records.push(record);
          }
        });
      if (records.length) {
        total += records.length;
        addMany(type, records);
      }
    });
    if (setAlert) {
      // Candidate paths are RELATIVE to the folder that was analyzed. Charts
      // render as fileServerPath + imageFile, so if the analyzed folder is
      // not (yet) the saved one, every image URL would point somewhere else.
      // Say so at the moment it matters rather than leaving blank figures.
      const mismatch =
        target && fileServerPath && target !== fileServerPath
          ? " NOTE: these paths are relative to the folder you analyzed, " +
            "which is not the saved File Server path — save that folder so " +
            "chart images resolve."
          : !fileServerPath
          ? " NOTE: no File Server path is saved yet. Use Save File Server " +
            "for this folder, or chart images will not load."
          : "";
      setAlert(
        "Added to the form",
        `${total} item(s) were added to this curation form. Nothing has been ` +
          "saved or published — review each one and use Save when you are " +
          "ready." +
          mismatch,
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

  // Selecting a folder clears any ancestor or descendant of it, so a file
  // can only ever belong to one proposed record.
  const toggleBoundary = (root, path) =>
    setBoundaries((current) => {
      const chosen = current[root] || [];
      if (chosen.includes(path)) {
        return { ...current, [root]: chosen.filter((p) => p !== path) };
      }
      const kept = chosen.filter(
        (other) => !path.startsWith(`${other}/`) && !other.startsWith(`${path}/`)
      );
      return { ...current, [root]: kept.concat(path) };
    });

  const toggle = (setter, id) =>
    setter((current) => ({ ...current, [id]: !current[id] }));

  const renderAiProposal = (candidate) => {
    const notice = aiNotice[candidate.id];
    const suggestion = aiSuggestions[candidate.id];
    if (notice && !suggestion) {
      return (
        <Alert
          severity="warning"
          sx={{ mt: 1 }}
          data-testid={`ai-notice-${candidate.id}`}
        >
          {notice}
        </Alert>
      );
    }
    if (!suggestion) return null;
    const targets = aiTargets(candidate.kind);
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
        {/* Deliberately unlike the deterministic evidence chip: an outlined
            secondary label, always prefixed "AI suggestion", so a model's
            opinion can never be read as a detected fact. */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Chip
            size="small"
            variant="outlined"
            color="secondary"
            label={`AI suggestion: ${suggestion.confidence || "low"}`}
            data-testid={`ai-confidence-${candidate.id}`}
          />
          <Typography variant="caption" color="text.secondary">
            not applied
          </Typography>
        </Box>
        {suggestion.reason ? (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mb: 0.5 }}
            data-testid={`ai-reason-${candidate.id}`}
          >
            Based on: {suggestion.reason}
          </Typography>
        ) : null}
        {/* A second opinion on the classification, shown only when the
            deterministic pass was itself unsure and the AI disagrees. It is
            a note: Qresp never moves a candidate between groups on its own,
            because that would change records the curator did not review. */}
        {suggestion.kind &&
          suggestion.kind !== candidate.kind &&
          candidate.confidence !== "high" && (
            <Typography
              variant="body2"
              sx={{ mt: 0.5 }}
              data-testid={`ai-kind-${candidate.id}`}
            >
              AI reads this more like a <strong>{suggestion.kind}</strong> than
              a {candidate.kind}. Nothing has been moved — remove it here and
              add it under {suggestion.kind}s yourself if you agree.
            </Typography>
          )}
        {description ? (
          <Fragment>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
            {/* Per-field acceptance. Disabled while the curator's own text is
                in the field: an AI suggestion never overwrites something a
                person wrote, not even on a click meant for something else. */}
            <Button
              size="small"
              disabled={Boolean(draft[descriptionField])}
              onClick={() =>
                setField(candidate.id, descriptionField, description)
              }
            >
              {`Use as ${labelFor(candidate.kind, descriptionField)}`}
            </Button>
            {draft[descriptionField] ? (
              <Typography variant="caption" color="text.secondary">
                your text is kept — clear the field to use this instead
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
            {/* keywordField is always set when keywords arrive: the server
                does not return them for a type that cannot hold them. */}
            {keywordField ? (
              <Button
                size="small"
                disabled={Boolean(draft[keywordField])}
                onClick={() =>
                  setField(candidate.id, keywordField, keywords.join(", "))
                }
              >
                {`Use as ${labelFor(candidate.kind, keywordField)}`}
              </Button>
            ) : null}
          </Box>
        )}
      </Box>
    );
  };

  // A chart folder with more than one image. Every image is listed with the
  // role it will play, so nothing is hidden and nothing is decided for the
  // curator: the backend's pick is preselected, everything else is Unused.
  const renderImageRoles = (candidate) => {
    const options = candidate.image_options || [];
    if (candidate.kind !== "chart" || options.length < 2) return null;
    const roles = rolesFor(candidate);

    return (
      <Box
        sx={{ mt: 1.5, pl: { xs: 0, sm: 5 } }}
        data-testid={`image-roles-${candidate.id}`}
      >
        <Typography variant="subtitle2" gutterBottom>
          {options.length} images found
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mb: 1 }}
        >
          A chart has one primary image. Give the others a role — nothing is
          split into separate charts unless you say so.
        </Typography>
        <Stack spacing={1.5}>
          {options.map((option) => (
            <Box
              key={option.path}
              sx={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 1.5,
              }}
              data-testid={`image-option-${candidate.id}-${basename(
                option.path
              )}`}
            >
              {/* A thumbnail when the browser can load it. When RCC TLS or
                  the file itself refuses, the filename and a direct link are
                  the fallback -- never a blank box. */}
              {buildFileUrl(fileServerPath, option.path) ? (
                <Box
                  component="img"
                  src={buildFileUrl(fileServerPath, option.path)}
                  alt=""
                  sx={{ width: 56, height: 56, objectFit: "contain",
                        border: 1, borderColor: "divider", borderRadius: 1 }}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              <Box sx={{ flexGrow: 1, flexBasis: 180, minWidth: 0 }}>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {basename(option.path)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.reason}
                </Typography>
              </Box>
              {buildFileUrl(fileServerPath, option.path) ? (
                <Button
                  size="small"
                  href={buildFileUrl(fileServerPath, option.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Open image
                </Button>
              ) : null}
              <TextField
                select
                size="small"
                label="Role"
                value={roles[option.path] || "unused"}
                onChange={(event) =>
                  setImageRole(candidate, option.path, event.target.value)
                }
                sx={{ minWidth: 190 }}
                slotProps={{
                  htmlInput: {
                    "aria-label": `Role for ${basename(option.path)}`,
                  },
                }}
              >
                <MenuItem value="primary">Primary image</MenuItem>
                <MenuItem value="related">Related file</MenuItem>
                <MenuItem value="separate">Create as separate Chart</MenuItem>
                <MenuItem value="unused">Unused</MenuItem>
              </TextField>
            </Box>
          ))}
        </Stack>
      </Box>
    );
  };

  const renderCandidate = (candidate) => {
    const draft = drafts[candidate.id] || {};
    const needs = missingRequired(candidate.kind, draft);
    const { primary, secondary, full } = labelOf(candidate);
    const isSelected = Boolean(selected[candidate.id]);
    // Fields appear once the candidate matters: it is selected, or the
    // curator explicitly opened it. An unselected card stays a single line.
    const fieldsVisible = isSelected || Boolean(editOpen[candidate.id]);

    return (
      <Box
        key={candidate.id}
        sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1.5 }}
      >
        {/* One wrapping row: the label grows, the actions keep their natural
            width and drop onto their own line when the row runs out of
            space, instead of the labels breaking word by word. */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            rowGap: 1,
            columnGap: 1,
          }}
        >
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
          <Box sx={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap title={full || primary}>
              {primary}
            </Typography>
            {secondary ? (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                display="block"
                title={secondary}
              >
                {secondary}
              </Typography>
            ) : null}
          </Box>
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}
          >
            <Chip
              size="small"
              color={candidate.confidence === HIGH_EVIDENCE ? "success" : "info"}
              label={
                EVIDENCE_LABELS[candidate.confidence] || candidate.confidence
              }
              data-testid={`confidence-${candidate.id}`}
            />
            {needs.length > 0 && (
              <Tooltip
                title={`Missing: ${needs
                  .map((field) => labelFor(candidate.kind, field))
                  .join(", ")}`}
              >
                <Chip
                  size="small"
                  color="warning"
                  label={`${needs.length} required field${
                    needs.length === 1 ? "" : "s"
                  } missing`}
                  data-testid={`needs-input-${candidate.id}`}
                />
              </Tooltip>
            )}
          </Box>
          <Box
            data-testid={`actions-${candidate.id}`}
            sx={{
              display: "flex",
              gap: 0.5,
              flexShrink: 0,
              ml: "auto",
              // Multi-word labels stay on one line at every width.
              "& .MuiButton-root": { whiteSpace: "nowrap", minWidth: "auto" },
            }}
          >
            {/* Visually distinct from the Add checkbox on the left: the
                checkbox chooses what goes to the Curator, this describes
                THIS candidate and nothing else. A multi-selection can stay
                exactly as it is while one item is enhanced. */}
            {Object.keys(aiTargets(candidate.kind)).length > 0 && (
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                disabled={Boolean(aiLoading[candidate.id])}
                onClick={() => openAiConsent(candidate)}
                data-testid={`enhance-${candidate.id}`}
              >
                {aiLoading[candidate.id] ? "Asking AI…" : "Enhance with AI"}
              </Button>
            )}
            <Button size="small" onClick={() => toggle(setDetailsOpen, candidate.id)}>
              Details
            </Button>
            {!isSelected && (
              <Button size="small" onClick={() => toggle(setEditOpen, candidate.id)}>
                Edit Proposal
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
        </Box>

        <Collapse in={Boolean(detailsOpen[candidate.id])} unmountOnExit>
          <Box sx={{ pl: { xs: 0, sm: 5 }, pt: 1 }}>
            {(candidate.evidence || []).map((line) => (
              <Typography
                key={line}
                variant="caption"
                display="block"
                sx={{ overflowWrap: "anywhere" }}
              >
                {line}
              </Typography>
            ))}
            {/* Filename material, kept clearly apart from evidence: these
                are guesses about names, not things Qresp verified. */}
            {(candidate.filename_hints || []).length > 0 && (
              <Box sx={{ mt: 1 }} data-testid={`hints-${candidate.id}`}>
                <Typography variant="caption" color="warning.main" display="block">
                  Filename hints — not verified metadata, never used as a
                  field value:
                </Typography>
                {(candidate.filename_hints || []).map((hint) => (
                  <Typography
                    key={hint}
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    {hint}
                  </Typography>
                ))}
              </Box>
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ overflowWrap: "anywhere" }}
            >
              Files: {(candidate.paths || []).join(", ")}
            </Typography>
          </Box>
        </Collapse>

        {renderAiProposal(candidate)}

        <Collapse in={fieldsVisible} unmountOnExit>
          {/* Deliberate separation from the header/evidence above. */}
          <Divider sx={{ mt: 2 }} />
          {renderImageRoles(candidate)}
          <Grid
            container
            spacing={2}
            sx={{ mt: 0.5, pl: { xs: 0, sm: 5 } }}
            data-testid={`fields-${candidate.id}`}
          >
            {fieldsFor(candidate.kind).map(({ key: field, required }) => {
              const blank = !String(draft[field] || "").trim();
              // Per-field standing, from the deterministic analysis. The
              // backend marks a field it could not determine "needs_input"
              // whether or not the field is required, so an OPTIONAL field
              // never carries that chip: an empty Keywords or Notebook File
              // is a complete record, not an unfinished one.
              // Standing is only meaningful for a field that HAS a value.
              // An empty field says "needs input" by being empty and marked
              // required; a chip repeating it three ways is noise.
              const evidence = blank
                ? null
                : (candidate.field_evidence || {})[field];
              // When the deterministic pass found several images and refused
              // to guess between them, the curator picks from what is there.
              const choices = ((candidate.options || {})[field] || []).filter(
                Boolean
              );
              return (
                <Grid key={field} size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    size="small"
                    select={choices.length > 1}
                    label={labelFor(candidate.kind, field)}
                    // MUI renders the asterisk and sets aria-required, so the
                    // marker is real semantics rather than a character glued
                    // onto the label text.
                    required={required}
                    value={draft[field]}
                    onChange={(event) =>
                      setField(candidate.id, field, event.target.value)
                    }
                    helperText={
                      required && blank
                        ? "Required before Save/Update and Publish."
                        : " "
                    }
                  >
                    {choices.length > 1
                      ? [
                          <MenuItem key="" value="">
                            <em>Not selected</em>
                          </MenuItem>,
                        ].concat(
                          choices.map((choice) => (
                            <MenuItem key={choice} value={choice}>
                              {basename(choice)}
                            </MenuItem>
                          ))
                        )
                      : null}
                  </TextField>
                  {evidence ? (
                    <Chip
                      size="small"
                      variant={evidence === HIGH_EVIDENCE ? "filled" : "outlined"}
                      color={
                        evidence === HIGH_EVIDENCE
                          ? "success"
                          : evidence === "medium"
                          ? "info"
                          : "default"
                      }
                      label={EVIDENCE_LABELS[evidence] || evidence}
                      data-testid={`field-evidence-${candidate.id}-${field}`}
                      sx={{ mt: -1.5 }}
                    />
                  ) : null}
                </Grid>
              );
            })}
          </Grid>
        </Collapse>
      </Box>
    );
  };

  const activeGroup = GROUPS[tab];
  const hints = ((analysis || {}).candidates || {}).possible_dependencies || [];
  const candidates = (analysis || {}).candidates || {};
  // Grouped folder ROWS from the backend — never the raw path list, which is
  // what used to render as one unreadable paragraph.
  const groupedUnclassified = candidates.grouped_unclassified || [];
  const unclassifiedTotal = candidates.unclassified_total || 0;
  const structureMode = (analysis || {}).structure_mode || "";
  const invalidStructure = structureMode === "invalid";

  const visibleUnclassified = useMemo(() => {
    const needle = unclassifiedFilter.trim().toLowerCase();
    const rows = groupedUnclassified.filter(
      (row) => !needle || (row.path || "").toLowerCase().includes(needle)
    );
    return showAllUnclassified ? rows : rows.slice(0, UNCLASSIFIED_ROWS);
  }, [groupedUnclassified, unclassifiedFilter, showAllUnclassified]);

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
          <RegularStyledButton onClick={() => analyze()} disabled={!ready}>
            Analyze RCC Folder
          </RegularStyledButton>
        </Box>
      </Tooltip>

      <Dialog
        open={open}
        onClose={close}
        maxWidth="md"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              // ONE scroll owner. The Paper must not scroll, or the dialog
              // shows two nested vertical scrollbars and the page behind it
              // moves with the wheel.
              overflow: "hidden",
              maxHeight: { xs: "100dvh", sm: "90dvh" },
            },
          },
        }}
      >
        <DialogTitle sx={{ flexShrink: 0 }}>Folder analysis</DialogTitle>
        <DialogContent
          dividers
          sx={{ overflowY: "auto", overscrollBehavior: "contain" }}
        >
          {/* Said ONCE, here, rather than repeated under every candidate. */}
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mb: 2 }}
            data-testid="required-note"
          >
            * Required before Save/Update and Publish. Folder proposals may be
            added incomplete.
          </Typography>
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
                <Alert severity="info" sx={{ mb: 1 }}>
                  <strong>This is a partial view of the folder.</strong> Qresp
                  scanned{" "}
                  {(analysis.counts || {}).files != null
                    ? `${analysis.counts.files} file(s) across ${
                        (analysis.counts || {}).directories || 0
                      } folder(s)`
                    : "part of the folder"}{" "}
                  and stopped at its built-in safety limits
                  {(analysis.limits || {}).max_depth
                    ? ` (at most ${analysis.limits.max_depth} folder levels, ${analysis.limits.max_files} files)`
                    : ""}
                  , so the candidates below do not represent everything that is
                  there. Nothing was skipped silently — the reasons are listed
                  below.
                </Alert>
              )}
              {(analysis.warnings || []).map((warning) => (
                <Alert key={warning} severity="info" sx={{ mb: 1 }}>
                  {warning}
                </Alert>
              ))}
              {/* How the folder was read. Derived from its shape by the
                  Folder Standard validator — session-only, and nothing on
                  the file server is renamed. */}
              {analysis.structure_mode && (
                <Box sx={{ mb: 2 }} data-testid="structure-mode">
                  <Chip
                    size="small"
                    color={
                      analysis.structure_mode === "standard"
                        ? "success"
                        : analysis.structure_mode === "legacy"
                        ? "info"
                        : "warning"
                    }
                    label={
                      analysis.structure_mode === "standard"
                        ? "Qresp Standard"
                        : analysis.structure_mode === "legacy"
                        ? "Legacy-compatible"
                        : "Needs reorganization"
                    }
                  />
                  {(analysis.structure_issues || []).map((issue) => (
                    <Typography
                      key={`${issue.path}-${issue.reason}`}
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mt: 0.5 }}
                    >
                      {issue.path ? `${issue.path}: ` : ""}
                      {issue.reason}
                    </Typography>
                  ))}
                </Box>
              )}
              {/* Legacy layouts only: their nesting is something only the
                  author can resolve, so the boundary is theirs to choose.
                  Standard layouts use the deterministic immediate children
                  and never see this. */}
              {structureMode === "legacy" &&
                Object.keys(analysis.boundary_trees || {}).length > 0 && (
                <Box sx={{ mb: 2 }} data-testid="boundary-picker">
                  <Button
                    size="small"
                    onClick={() => setPickerOpen((value) => !value)}
                    sx={{ textTransform: "none" }}
                  >
                    {pickerOpen
                      ? "Hide record boundaries"
                      : "Choose record boundaries"}
                  </Button>
                  <Collapse in={pickerOpen} unmountOnExit>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mb: 1 }}
                    >
                      One selected folder becomes one proposed Dataset or
                      Script record. Select a parent to keep everything
                      beneath it together, or select child folders to split
                      it. Nothing on the file server is changed.
                    </Typography>
                    {Object.keys(analysis.boundary_trees)
                      .sort()
                      .map((root) => {
                        const tree = analysis.boundary_trees[root];
                        const chosen = boundaries[root] || [];
                        return (
                          <Box key={root} sx={{ mb: 1.5 }}>
                            <Typography variant="subtitle2">
                              {`${root} → ${tree.role}`}
                            </Typography>
                            {(tree.nodes || []).length === 0 && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                display="block"
                                data-testid={`no-boundaries-${root}`}
                              >
                                No selectable dataset/script boundaries were
                                found in {root}. Its immediate children are
                                used as records.
                              </Typography>
                            )}
                            {(tree.nodes || []).map((node) => {
                              const isChosen = chosen.includes(node.path);
                              // Mutual exclusion: an ancestor or a descendant
                              // of an already-chosen node cannot also be
                              // chosen, because the same files would land in
                              // two records.
                              const blocked =
                                !isChosen &&
                                chosen.some(
                                  (other) =>
                                    node.path.startsWith(`${other}/`) ||
                                    other.startsWith(`${node.path}/`)
                                );
                              return (
                                <Box
                                  key={node.path}
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    pl: { xs: (node.level - 1) * 1.5, sm: (node.level - 1) * 3 },
                                  }}
                                >
                                  <Checkbox
                                    size="small"
                                    checked={isChosen}
                                    disabled={blocked}
                                    onChange={() => toggleBoundary(root, node.path)}
                                    slotProps={{
                                      input: {
                                        "aria-label": `Use ${node.path} as one record`,
                                      },
                                    }}
                                  />
                                  <Typography
                                    variant="caption"
                                    noWrap
                                    title={node.path}
                                    sx={{ color: blocked ? "text.disabled" : "inherit" }}
                                  >
                                    {`${node.path} (${node.file_count} files)`}
                                  </Typography>
                                </Box>
                              );
                            })}
                          </Box>
                        );
                      })}
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={
                          !Object.values(boundaries).some(
                            (value) => (value || []).length
                          )
                        }
                        onClick={() => analyze(boundaries)}
                      >
                        Rebuild proposals
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setBoundaries({});
                          analyze();
                        }}
                      >
                        Use default boundaries
                      </Button>
                    </Box>
                  </Collapse>
                </Box>
              )}
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
                        ? unclassifiedTotal
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
                  {visibleCandidatesFor(activeGroup.key).map(renderCandidate)}
                  {candidatesFor(activeGroup.key).length >
                    visibleCandidatesFor(activeGroup.key).length && (
                    <Box sx={{ mt: 1, mb: 2 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() =>
                          setShowAll((current) => ({
                            ...current,
                            [activeGroup.key]: true,
                          }))
                        }
                      >
                        {`Show all ${
                          candidatesFor(activeGroup.key).length
                        } candidates`}
                      </Button>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                        sx={{ mt: 0.5 }}
                      >
                        {candidatesFor(activeGroup.key).length -
                          visibleCandidatesFor(activeGroup.key).length}{" "}
                        more with weaker evidence are collapsed, not discarded.
                        Anything you have already selected stays visible.
                      </Typography>
                    </Box>
                  )}
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
                    {unclassifiedTotal} file(s) were not classified — Qresp
                    would have had to guess. Add them by hand if they belong
                    to the paper.
                  </Typography>
                  {groupedUnclassified.length > 0 && (
                    <Fragment>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Filter by folder"
                        value={unclassifiedFilter}
                        onChange={(event) =>
                          setUnclassifiedFilter(event.target.value)
                        }
                        slotProps={{
                          input: { "aria-label": "Filter unclassified folders" },
                        }}
                        sx={{ mb: 1, maxWidth: 360 }}
                      />
                      {/* Grouped folder rows. The backend never sends the raw
                          path list any more, so hundreds of paths cannot be
                          rendered as one paragraph. */}
                      {visibleUnclassified.length === 0 && (
                        <Typography variant="body2">
                          No folder matches that filter.
                        </Typography>
                      )}
                      {visibleUnclassified.map((row) => (
                        <Box
                          key={row.path}
                          sx={{ mb: 1 }}
                          data-testid={`unclassified-group-${row.path || "root"}`}
                        >
                          <Button
                            size="small"
                            onClick={() =>
                              setShowUnclassified((current) => ({
                                ...current,
                                [row.path]: !current[row.path],
                              }))
                            }
                            sx={{ textTransform: "none" }}
                          >
                            {`${row.name} (${row.file_count})`}
                          </Button>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: 1 }}
                          >
                            {(row.extensions || []).join(" ")}
                          </Typography>
                          <Collapse
                            in={Boolean(showUnclassified[row.path])}
                            unmountOnExit
                          >
                            <Box
                              sx={{
                                pl: 2,
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 0.5,
                                maxHeight: 220,
                                overflowY: "auto",
                              }}
                            >
                              {(row.sample_names || []).map((name) => (
                                <Chip
                                  key={name}
                                  size="small"
                                  variant="outlined"
                                  label={name}
                                  title={
                                    row.path ? `${row.path}/${name}` : name
                                  }
                                />
                              ))}
                              {row.file_count >
                                (row.sample_names || []).length && (
                                <Typography variant="caption" sx={{ ml: 1 }}>
                                  …and{" "}
                                  {row.file_count -
                                    (row.sample_names || []).length}{" "}
                                  more in this folder
                                </Typography>
                              )}
                            </Box>
                          </Collapse>
                        </Box>
                      ))}
                      {!showAllUnclassified &&
                        groupedUnclassified.length > UNCLASSIFIED_ROWS && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => setShowAllUnclassified(true)}
                          >
                            {`Show more (${
                              groupedUnclassified.length - UNCLASSIFIED_ROWS
                            } more folders)`}
                          </Button>
                        )}
                    </Fragment>
                  )}
                </Fragment>
              )}
            </Fragment>
          )}
        </DialogContent>
        <DialogActions sx={{ flexShrink: 0, flexWrap: "wrap", gap: 1 }}>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="contained"
            disabled={selectedCount === 0 || invalidStructure}
            onClick={apply}
          >
            Add selected items to Curator
          </Button>
        </DialogActions>
      </Dialog>

      {/* Consent is a deliberate stop, not a checkbox beside a button: it
          states the count and the exact scope BEFORE anything is sent, and
          it is asked again for every request. */}
      {/* transitionDuration 0: this sits on top of the review dialog, and a
          lingering exit transition leaves MUI's aria-hidden on the dialog
          underneath — the suggestions would be invisible to assistive tech
          for as long as it lasts. */}
      <Dialog
        open={aiConsentOpen}
        onClose={closeAiConsent}
        maxWidth="sm"
        fullWidth
        transitionDuration={0}
      >
        <DialogTitle>
          Send “{aiConsentOpen ? labelOf(aiConsentOpen).primary : ""}” to
          Gemini?
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" gutterBottom>
            Qresp will send, for <strong>this one candidate</strong> and for
            nothing else:
          </Typography>
          <Box component="ul" sx={{ pl: 3, mt: 0, mb: 2 }}>
            <Typography component="li" variant="body2">
              their relative paths, file names and folder names
            </Typography>
            <Typography component="li" variant="body2">
              short text Qresp has already read from this folder — README,
              docstring and dependency-manifest excerpts
            </Typography>
          </Box>
          <Typography variant="body2" gutterBottom>
            It will <strong>not</strong> send raw datasets, image bytes,
            notebook contents, credentials, your account details, or anything
            from outside this candidate.
          </Typography>
          {aiConsentOpen ? (
            <Typography
              variant="body2"
              sx={{ mb: 1 }}
              data-testid="ai-consent-fields"
            >
              It will ask for:{" "}
              <strong>
                {Object.keys(aiTargets(aiConsentOpen.kind))
                  .map((slot) =>
                    labelFor(
                      aiConsentOpen.kind,
                      aiTargets(aiConsentOpen.kind)[slot]
                    )
                  )
                  .join(" and ")}
              </strong>
              .
            </Typography>
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Gemini returns suggestions only. Nothing is filled in, added,
            saved or published as a result.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={aiConsent}
                onChange={(event) => setAiConsent(event.target.checked)}
                slotProps={{
                  input: {
                    "aria-label":
                      "I agree to send this evidence to Gemini for this request",
                  },
                }}
              />
            }
            label="Send this evidence to Gemini for this request."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAiConsent}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!aiConsent}
            onClick={() => describeWithAI(aiConsentOpen)}
          >
            Send and get suggestions
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
