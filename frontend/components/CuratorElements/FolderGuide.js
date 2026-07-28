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

// "How to organize an RCC folder" — advice, nothing more. There is no API,
// no persistence, no validation, and no score: a folder that ignores every
// word of this is analyzed exactly as before. Deliberately NOT a new
// manifest format either — researchers should not have to create
// Qresp-specific files to be understood.

// A live tree built from the app's own icon set, so it stays readable at any
// width and in any theme. (A rendered image of a folder tree would carry
// unselectable, unscalable text.)
const TREE = [
  { depth: 0, name: "my-paper/", kind: "folder" },
  { depth: 1, name: "figures/", kind: "folder" },
  { depth: 2, name: "figure-01/", kind: "folder" },
  { depth: 3, name: "figure-01.png", kind: "image" },
  { depth: 3, name: "figure-01.ipynb", kind: "file" },
  { depth: 3, name: "figure-01-data.csv", kind: "file" },
  { depth: 1, name: "datasets/", kind: "folder" },
  { depth: 2, name: "bandgap/", kind: "folder" },
  { depth: 3, name: "bandgap.csv", kind: "file" },
  { depth: 1, name: "scripts/", kind: "folder" },
  { depth: 2, name: "analysis/", kind: "folder" },
  { depth: 3, name: "analyze_bandgap.py", kind: "file" },
  { depth: 1, name: "README.md", kind: "file" },
  { depth: 1, name: "environment.yml", kind: "file" },
];

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

const TIPS = [
  "This layout is optional. Existing folders are analyzed exactly as they are — nothing here is required, checked, or scored.",
  "Keep an image, its notebook and its input data together where practical. Qresp can link them when they sit in the same folder and share a basename.",
  "Use meaningful folder and file names; recognizable names like figures, data, datasets and scripts help when practical.",
  "A README.md is a good place to explain the project to collaborators.",
  "Ordinary files like requirements.txt or environment.yml improve software and version detection. No Qresp-specific file is ever needed.",
  "Never store secrets, API keys, credentials or private account data in a folder Qresp may inspect.",
];

const FolderGuide = () => {
  const [open, setOpen] = useState(false);

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
            Qresp reads whatever folder you point it at. These are suggestions
            that tend to make the analysis more useful — not requirements.
          </Typography>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            An example layout
          </Typography>
          <FolderTree />

          <Box component="ul" sx={{ pl: 3, mt: 2, mb: 0 }}>
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
