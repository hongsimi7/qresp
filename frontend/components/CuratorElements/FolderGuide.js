import { Fragment, useState } from "react";

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import {
  DescriptionOutlined,
  FolderOpenOutlined,
  ImageOutlined,
} from "@mui/icons-material";

// "How to organize an RCC folder" — the Qresp Folder Standard v1, offered as
// a recommended contract rather than enforced. There is no API, no
// persistence, no validation and no score: a folder that ignores every word
// of this is still read, and nothing on the file server is renamed.
//
// It is NOT "any folder works perfectly" either. Automatic record proposals
// are deterministic on this layout and on recognized legacy aliases; an
// unsupported top-level structure is left as Needs reorganization or
// Unclassified rather than guessed at. Deliberately NOT a new manifest format
// — researchers should not have to create Qresp-specific files to be
// understood.

// A live tree built from the app's own icon set, so it stays readable at any
// width and in any theme. (A rendered image of a folder tree would carry
// unselectable, unscalable text.)
const TREE = [
  { depth: 0, name: "paper-folder/", kind: "folder" },
  { depth: 1, name: "README.md", kind: "file" },
  { depth: 1, name: "main.ipynb", kind: "file" },
  { depth: 1, name: "datasets/", kind: "folder" },
  { depth: 2, name: "dataset-id/", kind: "folder" },
  { depth: 3, name: "...", kind: "file" },
  { depth: 1, name: "charts/", kind: "folder" },
  { depth: 2, name: "figure-id/", kind: "folder" },
  { depth: 3, name: "preview.png", kind: "image" },
  { depth: 3, name: "notebook.ipynb", kind: "file" },
  { depth: 3, name: "data/", kind: "folder" },
  { depth: 4, name: "...", kind: "file" },
  { depth: 1, name: "scripts/", kind: "folder" },
  { depth: 2, name: "script-id/", kind: "folder" },
  { depth: 3, name: "...", kind: "file" },
  { depth: 1, name: "tools/", kind: "folder" },
  { depth: 2, name: "tool-id/", kind: "folder" },
  { depth: 3, name: "...", kind: "file" },
  { depth: 1, name: "docs/", kind: "folder" },
  { depth: 2, name: "...", kind: "file" },
];

// The same tree as plain text, for the clipboard.
const TREE_TEXT = TREE.map(
  (entry) => `${"  ".repeat(entry.depth)}${entry.name}`
).join("\n");

const iconFor = (kind) => {
  const sx = { fontSize: 16, mr: 0.75, flexShrink: 0 };
  if (kind === "folder") {
    return <FolderOpenOutlined sx={{ ...sx, color: "primary.main" }} />;
  }
  if (kind === "image") {
    return <ImageOutlined sx={{ ...sx, color: "secondary.main" }} />;
  }
  return <DescriptionOutlined sx={{ ...sx, color: "text.secondary" }} />;
};

const FolderTree = () => (
  <Box
    data-testid="folder-guide-tree"
    sx={{
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      p: 1.5,
      bgcolor: "action.hover",
      overflowX: "auto",
    }}
  >
    {TREE.map((entry) => (
      <Box
        key={`${entry.depth}-${entry.name}`}
        sx={{
          display: "flex",
          alignItems: "center",
          pl: { xs: entry.depth * 1.25, sm: entry.depth * 2 },
          py: 0.15,
        }}
      >
        {iconFor(entry.kind)}
        <Typography
          variant="caption"
          sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}
        >
          {entry.name}
        </Typography>
      </Box>
    ))}
  </Box>
);

// The standard itself. These describe the recommended layout — what Qresp
// reads without having to ask you anything.
const TIPS = [
  "All five role folders are optional — use only the ones your paper needs.",
  "For new Qresp-managed folders use these exact lowercase names: datasets, charts, scripts, tools, docs.",
  "By default each immediate child folder of datasets/, charts/, scripts/ or tools/ is ONE Qresp record, and everything beneath that child belongs to it.",
  "A file placed directly under datasets/ is one dataset on its own.",
  "Dataset and Script records can be split further in Record boundaries, if one folder really holds several records.",
  "One charts/<figure-id>/ folder is one Chart: preview.png is the Figure Image, notebook.ipynb is the Reproduction Notebook, and the chart's data/ holds its Input / Supporting Files.",
  "Give each independent figure its own charts/<figure-id>/ folder — that is the recommended unit, and Qresp proposes it without asking.",
  "docs/ is excluded from the analysis candidates entirely.",
  "No YAML, JSON, metadata manifest or Qresp-specific file is ever required.",
  "Existing folders are never renamed or modified. Recognized legacy names such as data, Figures_Tables, Plot_Scripts and doc keep working.",
  "Figure Number, Figure Caption, scientific descriptions and tool versions are never inferred from filenames — you enter those, or accept an AI suggestion.",
  "Never store secrets, API keys, credentials or private account data in a folder Qresp may inspect.",
];

// Not part of the standard: what to do about folders that were written before
// it. Kept visibly separate so the compatibility path is never read as a
// second, looser way to lay out a new paper.
const LEGACY_NOTES = [
  "Older folders often keep several images in one figure folder. A Chart stores exactly one Figure Image, so Qresp will not silently pick one and drop the rest.",
  "Record boundaries lists every image it found under the folder it really sits in — none is hidden — and you give each one a role: Create Chart, Supporting File, or Ignore.",
  "Create Chart proposes an independent Chart with that single Figure Image. Supporting File attaches the image to a Chart in the same folder. Ignore proposes nothing.",
  "Rebuilding proposals changes proposals only — nothing is added to the form, saved or published until you say so.",
  "Relationships between separate Charts belong in Workflow, not in a second image on one Chart.",
];

const FolderGuide = () => {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState("");

  // Clipboard access is unavailable over plain HTTP and in some browsers, so
  // failure is expected and gets a useful answer rather than a silent no-op.
  const copyStructure = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(TREE_TEXT);
      setCopyState("Copied.");
    } catch (err) {
      setCopyState("Could not copy — select the tree above and copy it.");
    }
  };

  return (
    <Fragment>
      <Button
        size="small"
        onClick={() => setOpen(true)}
        sx={{ whiteSpace: "nowrap" }}
      >
        How to organize an RCC folder
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>How to organize an RCC folder</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" gutterBottom>
            Qresp can inspect any folder inside the file server roots this
            server is allowed to read. Automatic record proposals are
            deterministic for the <strong>Qresp Folder Standard v1</strong>{" "}
            below and for the legacy folder names Qresp recognizes; a
            top-level structure it does not support is left as{" "}
            <em>Needs reorganization</em> or Unclassified rather than guessed
            at.
          </Typography>
          <Typography variant="body2" gutterBottom>
            The standard is not a rule for storing your files — it is the
            recommended contract for accurate automatic analysis. Existing
            folders stay exactly as they are, are never renamed, and can always
            be reviewed by hand.
          </Typography>

          <Box
            sx={{
              mt: 2,
              mb: 1,
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="subtitle2">
              Qresp Folder Standard v1
            </Typography>
            <Button size="small" onClick={copyStructure}>
              Copy standard structure
            </Button>
            {copyState ? (
              <Typography variant="caption" color="text.secondary">
                {copyState}
              </Typography>
            ) : null}
          </Box>
          <FolderTree />

          <Box
            component="ul"
            sx={{ pl: 3, mt: 2, mb: 0 }}
            data-testid="folder-guide-standard"
          >
            {TIPS.map((tip) => (
              <Typography
                component="li"
                variant="body2"
                key={tip}
                sx={{ mb: 0.75 }}
              >
                {tip}
              </Typography>
            ))}
          </Box>

          {/* Deliberately its own section: this is how an EXISTING folder is
              reviewed safely, not an alternative layout to aim for. */}
          <Typography variant="subtitle2" sx={{ mt: 3 }}>
            Existing folders with several images in one figure folder
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mb: 1 }}
          >
            Compatibility review — for folders that already exist, not a second
            way to organize a new paper.
          </Typography>
          <Box
            component="ul"
            sx={{ pl: 3, mt: 0, mb: 0 }}
            data-testid="folder-guide-legacy"
          >
            {LEGACY_NOTES.map((note) => (
              <Typography
                component="li"
                variant="body2"
                key={note}
                sx={{ mb: 0.75 }}
              >
                {note}
              </Typography>
            ))}
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 2 }}
          >
            Better organization improves matching, but it does not let Qresp
            infer figure numbers, captions, scientific properties or package
            versions without evidence — those stay yours to enter.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Fragment>
  );
};

export default FolderGuide;
