import { Fragment, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import {
  Box,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import CuratorContext from "../../Context/Curator/curatorContext";
import { namesUtil, referenceUtil } from "../../Utils/utils";
import {
  applyPrimaryPaperToState,
  primaryPaperFromState,
} from "../../Utils/primaryPaper";

// Review-and-apply dialog for PRIMARY-paper metadata proposals (DOI lookup
// or manuscript source). The destination is the primary-paper adapter owned
// by the "Add info about your paper" workflow — never the Reference form's
// setters, and never any non-bibliographic slice. Everything remains a
// proposal until the curator explicitly applies selected fields; populated
// fields are only replaced when checked; tags are append-only suggestions.

// What still needs MANUAL completion, as a readable checklist. Fields the
// import can never provide (PaperStack, notebook) are called out explicitly.
// Draft saving never requires any of these — publish validation remains the
// only completeness gate.
const missingForPublish = (state) => {
  const missing = [];
  const biblio = state.referenceInfo || {};
  const info = state.curatorInfo || {};
  const paper = state.paperInfo || {};
  if (!(biblio.title || "").trim()) missing.push("Title");
  if (!(biblio.authors || "").trim()) missing.push("Authors");
  if (!(biblio.publication || "").trim() || !biblio.year)
    missing.push("Publication and year");
  if (!(paper.PIs || "").trim()) missing.push("Principal Investigators");
  if (!(paper.collections || []).length)
    missing.push("PaperStack / collections (manual)");
  if (!(paper.notebookFile || "").trim())
    missing.push("Main notebook file (manual)");
  if (!(info.firstName || "").trim() || !(info.emailId || "").trim())
    missing.push("Curator name and email");
  if (!(state.license || "").trim()) missing.push("License");
  if (!(state.charts || []).length) missing.push("At least one chart");
  if (!(state.datasets || []).length) missing.push("At least one dataset");
  return missing;
};

const KIND_LABELS = { preprint: "Preprint", journal: "Journal",
                      dissertation: "Dissertation" };

const displayValue = (value) => {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === "object") {
      return namesUtil.set(value);
    }
    return value.join(", ");
  }
  return String(value);
};

// Turn an import result into reviewable rows against the CURRENT
// primary-paper values (open-form values included via collectDraftState).
const buildRows = (result, currentPaper) => {
  const proposal = result.proposal || {};
  const provenance = result.provenance || {};
  const alternatives = result.alternatives || {};

  const rows = [];
  const push = (key, label, proposed, currentValue, applyValue, source) => {
    if (proposed == null || proposed === "") return;
    const currentText = (currentValue || "").toString().trim();
    rows.push({
      key,
      label,
      proposedText: displayValue(proposed),
      currentText,
      applyValue,
      source: source || provenance[key] || "import",
      alternatives: alternatives[key] || [],
      // Empty fields default to applying; a populated field is NEVER
      // overwritten unless the user explicitly checks it.
      defaultSelected: !currentText,
    });
  };

  // Kind: from the registry when known; for a manuscript without a DOI,
  // suggest "preprint" — a client-side suggestion only, nothing invented
  // beyond the default kind for unpublished sources.
  let kind = proposal.kind;
  let kindSource;
  if (!kind && result.importSource === "manuscript" && !proposal.doi) {
    kind = "preprint";
    kindSource = "suggested";
  }
  if (kind) {
    push("kind", "Kind", KIND_LABELS[kind] || kind,
         KIND_LABELS[currentPaper.kind] || currentPaper.kind, kind,
         kindSource);
  }

  push("title", "Title", proposal.title, currentPaper.title, proposal.title);
  if (proposal.authors && proposal.authors.length) {
    const authors = namesUtil.set(proposal.authors);
    push("authors", "Authors", authors, currentPaper.authors, authors);
  }
  push("abstract", "Abstract", proposal.abstract, currentPaper.abstract,
       proposal.abstract);
  push("doi", "DOI", proposal.doi, currentPaper.doi, proposal.doi);
  push("year", "Year", proposal.year, currentPaper.year, proposal.year);
  push("url", "URL", proposal.url, currentPaper.url, proposal.url);
  if (proposal.journal) {
    const publication = referenceUtil.set({
      journal: proposal.journal,
      year: proposal.year || "",
      volume: proposal.volume || "",
      page: proposal.pages || "",
    });
    push("publication", "Publication", publication,
         currentPaper.publication, publication);
  }
  if (proposal.tags && proposal.tags.length) {
    const existing = (currentPaper.tags || []).map((t) => t.toLowerCase());
    const fresh = proposal.tags.filter(
      (t) => !existing.includes(t.toLowerCase()));
    if (fresh.length) {
      rows.push({
        key: "tags",
        label: "Tag suggestions (added to your tags, never replacing them)",
        proposedText: fresh.join(", "),
        currentText: (currentPaper.tags || []).join(", "),
        applyValue: fresh,
        source: provenance.tags || "import",
        alternatives: [],
        // Suggestions only: never applied unless explicitly selected.
        defaultSelected: false,
      });
    }
  }
  return rows;
};

const ImportReview = ({ open, result, onClose }) => {
  const { collectDraftState, setAll, remountForms } =
    useContext(CuratorContext);

  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState({});
  // Per-author opt-in for "Add selected paper authors as Principal
  // Investigators" — every author UNCHECKED by default.
  const [piSelection, setPiSelection] = useState({});
  const [applied, setApplied] = useState(null); // missing-info checklist

  useEffect(() => {
    if (!open || !result) {
      setRows([]);
      setSelected({});
      setPiSelection({});
      setApplied(null);
      return;
    }
    const currentPaper = primaryPaperFromState(collectDraftState());
    const nextRows = buildRows(result, currentPaper);
    setRows(nextRows);
    setSelected(
      nextRows.reduce((acc, row) => {
        acc[row.key] = row.defaultSelected;
        return acc;
      }, {})
    );
    setPiSelection({});
    setApplied(null);
    // collectDraftState is stable enough for this open-time snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, result]);

  const apply = () => {
    // Snapshot INCLUDING open-form values so nothing typed is lost, then
    // write only the whitelisted primary-paper fields through the adapter.
    const current = collectDraftState();
    const updates = {};
    let tags = [];
    rows.forEach((row) => {
      if (!selected[row.key]) return;
      if (row.key === "tags") {
        tags = row.applyValue;
      } else {
        updates[row.key] = row.applyValue;
      }
    });
    const proposalAuthors = (result && result.proposal
      && result.proposal.authors) || [];
    const selectedAuthors = proposalAuthors.filter(
      (author, index) => piSelection[index]);
    const next = applyPrimaryPaperToState(current, updates, tags,
                                          selectedAuthors);
    setAll(next);
    // Re-seed the always-mounted forms from the updated state.
    if (remountForms) remountForms();
    setApplied(missingForPublish(next));
  };

  const anySelected =
    rows.some((row) => selected[row.key]) ||
    Object.values(piSelection).some(Boolean);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Review manuscript import</DialogTitle>
      <DialogContent dividers>
        {applied ? (
          <Fragment>
            <Typography color="secondary" gutterBottom>
              The selected proposals were applied to this paper&rsquo;s
              information. You can keep editing, and Save Draft works even
              while fields are missing.
            </Typography>
            {applied.length > 0 ? (
              <Fragment>
                <Typography color="secondary" sx={{ mt: 1 }}>
                  Still needed before this record can be published:
                </Typography>
                <ul>
                  {applied.map((item) => (
                    <li key={item}>
                      <Typography color="secondary" component="span">
                        {item}
                      </Typography>
                    </li>
                  ))}
                </ul>
              </Fragment>
            ) : (
              <Typography color="secondary">
                All publish requirements look filled in — review the forms and
                publish when ready.
              </Typography>
            )}
          </Fragment>
        ) : result ? (
          <Fragment>
            <Typography variant="body2" color="secondary" gutterBottom>
              Review the proposed values for the paper you are curating.
              Fields that already have a value are unchecked — checking one
              replaces your current value. Applied values go into Publication
              Information for This Paper only, and nothing is published by
              this step.
            </Typography>
            {(result.warnings || []).map((warning) => (
              <Typography key={warning} variant="body2" color="error">
                {warning}
              </Typography>
            ))}
            {result.main_file ? (
              <Typography variant="body2" color="secondary">
                Read from: {result.main_file}
                {(result.included_files || []).length
                  ? ` (+ ${result.included_files.join(", ")})`
                  : ""}
              </Typography>
            ) : null}
            {rows.length === 0 ? (
              <Typography color="secondary" sx={{ mt: 2 }}>
                Nothing new to apply was found.
              </Typography>
            ) : (
              rows.map((row) => (
                <Box
                  key={row.key}
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1,
                    mt: 2,
                  }}
                >
                  <Checkbox
                    checked={Boolean(selected[row.key])}
                    onChange={(event) =>
                      setSelected((currentSel) => ({
                        ...currentSel,
                        [row.key]: event.target.checked,
                      }))
                    }
                    slotProps={{
                      input: { "aria-label": `apply ${row.label}` },
                    }}
                  />
                  <Box sx={{ flexGrow: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography color="secondary" sx={{ fontWeight: "bold" }}>
                        {row.label}
                      </Typography>
                      <Chip label={row.source} size="small" />
                    </Box>
                    <Typography color="secondary">
                      Proposed: {row.proposedText}
                    </Typography>
                    {row.currentText ? (
                      <Typography variant="body2" color="error">
                        Current value kept unless checked: {row.currentText}
                      </Typography>
                    ) : null}
                    {row.alternatives.map((alt) => (
                      <Typography
                        key={alt.source}
                        variant="body2"
                        color="secondary"
                      >
                        Also found ({alt.source}): {displayValue(alt.value)}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ))
            )}
            {(result.proposal && result.proposal.authors || []).length ? (
              <Box sx={{ mt: 3 }}>
                <Typography color="secondary" sx={{ fontWeight: "bold" }}>
                  Add selected paper authors as Principal Investigators
                </Typography>
                <Typography variant="body2" color="secondary">
                  Authors are never added automatically — tick only the ones
                  who are PIs. Selected names are appended to the existing
                  Principal Investigators.
                </Typography>
                {result.proposal.authors.map((author, index) => {
                  const name = [author.firstName, author.middleName,
                                author.lastName]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <FormControlLabel
                      key={`${name}-${index}`}
                      sx={{ display: "block", ml: 0 }}
                      control={
                        <Checkbox
                          checked={Boolean(piSelection[index])}
                          onChange={(event) =>
                            setPiSelection((currentSel) => ({
                              ...currentSel,
                              [index]: event.target.checked,
                            }))
                          }
                          slotProps={{
                            input: {
                              "aria-label":
                                `add author ${name} as principal investigator`,
                            },
                          }}
                        />
                      }
                      label={name}
                    />
                  );
                })}
              </Box>
            ) : null}
            {/* Keyword assistance lives ONLY in Qresp Curation
                Information. A manuscript review is about this paper's
                bibliography; mixing a tags feature in here put the same
                concept in two places and sent manuscript text to the AI from
                a dialog that is not about tags. */}
            {(result.doi_candidates || []).length ? (
              <Typography variant="body2" color="secondary" sx={{ mt: 2 }}>
                DOIs found in the bibliography (references, not necessarily
                this work): {result.doi_candidates.slice(0, 5).join(", ")}
              </Typography>
            ) : null}
          </Fragment>
        ) : null}
      </DialogContent>
      <DialogActions>
        {applied ? (
          <RegularStyledButton onClick={onClose}>Close</RegularStyledButton>
        ) : (
          <Fragment>
            <RegularStyledButton onClick={onClose}>Cancel</RegularStyledButton>
            <RegularStyledButton onClick={apply} disabled={!anySelected}>
              Apply to paper information
            </RegularStyledButton>
          </Fragment>
        )}
      </DialogActions>
    </Dialog>
  );
};

ImportReview.propTypes = {
  open: PropTypes.bool.isRequired,
  result: PropTypes.object,
  onClose: PropTypes.func.isRequired,
};

export default ImportReview;
