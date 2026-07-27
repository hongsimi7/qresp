import { Fragment, useContext, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import CuratorContext from "../../Context/Curator/curatorContext";

// "Suggest Keywords with AI" — opt-in keyword suggestions inside the Qresp
// Curation Information section. Sends ONLY the primary paper's bibliographic
// metadata (title/abstract/venue/DOI) to the BACKEND assist endpoint, which
// is the only thing that ever talks to the provider (Gemini) — no key, no
// endpoint, no provider config exists client-side. The manuscript-excerpt
// variant lives in the import review behind its own consent checkbox. Every
// suggestion starts UNCHECKED and nothing is applied until the curator
// selects tags and clicks Apply — selected tags are handed to the host form,
// which APPENDS them to Keywords.

const KeywordAssist = ({ onApply }) => {
  const { collectDraftState, referenceInfo, liveBiblio, sourceFile } =
    useContext(CuratorContext) || {};

  // Conservative eligibility: suggestions need SOME useful input. A title or
  // abstract CURRENTLY TYPED in the publication form (liveBiblio, reported
  // via the form's watch — no Save needed) counts, as does a saved/fetched/
  // imported one, as does a manuscript source the curator selected in
  // Publication Information. While ineligible the action is disabled and no
  // request is ever made.
  const saved = referenceInfo || {};
  const live = liveBiblio || {};
  const hasMetadata = Boolean(
    (live.title || "").trim() ||
      (live.abstract || "").trim() ||
      (saved.title || "").trim() ||
      (saved.abstract || "").trim()
  );
  const hasSource = Boolean(sourceFile && sourceFile.file);
  const eligible = hasMetadata || hasSource;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [selected, setSelected] = useState({});
  // Full-source analysis is a SEPARATE, always-unchecked opt-in: selecting a
  // source never sends anything by itself.
  const [sourceConsent, setSourceConsent] = useState(false);

  // With a source but no metadata there is nothing to analyze unless the
  // curator consents to sending the manuscript text.
  const canRequest = hasMetadata || (hasSource && sourceConsent);

  const close = () => {
    setOpen(false);
    setLoading(false);
    setError("");
    setSuggestions(null);
    setSelected({});
    setSourceConsent(false);
  };

  // Read the selected file fresh at request time; it is never cached in a
  // draft, in localStorage, or anywhere outside this page session.
  const readSourceAsBase64 = () =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("unreadable"));
      reader.readAsDataURL(sourceFile.file);
    });

  const fetchSuggestions = () => {
    const state = collectDraftState ? collectDraftState() : {};
    const biblio = state.referenceInfo || {};
    const payload = {
      title: biblio.title || "",
      abstract: biblio.abstract || "",
      venue: biblio.publication || "",
      doi: biblio.doi || "",
    };
    setLoading(true);
    setError("");
    // The manuscript source is attached ONLY when the curator ticked the
    // full-source box; otherwise this stays a metadata-only request.
    const withSource =
      hasSource && sourceConsent
        ? readSourceAsBase64().then((content) => ({
            ...payload,
            filename: sourceFile.name,
            content_base64: content,
          }))
        : Promise.resolve(payload);

    withSource
      .then((body) => axios.post("/api/assist/keywords", body))
      .then((res) => {
        setSuggestions(res.data.keywords || []);
        setSelected({});
      })
      .catch((err) => {
        const res = err && err.response;
        setError(
          (res && res.data && res.data.error) ||
            "Keyword suggestions are unavailable right now, please try again."
        );
        setSuggestions(null);
      })
      .finally(() => setLoading(false));
  };

  // Opening the dialog never sends anything: the curator picks metadata-only
  // or (after consent) full-source, then asks for suggestions.
  const openDialog = () => {
    if (!eligible) return;
    setOpen(true);
  };

  const apply = () => {
    const chosen = (suggestions || []).filter((_, index) => selected[index]);
    if (chosen.length && onApply) {
      onApply(chosen);
    }
    close();
  };

  const anySelected = (suggestions || []).some(
    (_, index) => selected[index]
  );

  return (
    <Fragment>
      <Button
        size="small"
        variant="outlined"
        onClick={openDialog}
        disabled={!eligible}
      >
        Suggest Keywords with AI
      </Button>
      <Typography
        variant="body2"
        color="secondary"
        sx={{ mt: 0.5 }}
      >
        Keyword suggestions use this paper&rsquo;s title, abstract, venue,
        and DOI. Fetch a DOI, import a manuscript source, or complete the
        title or abstract first.
      </Typography>
      {!eligible ? (
        <Typography variant="body2" color="error">
          Add a title or abstract, fetch a DOI, or import a manuscript
          source to request keyword suggestions.
        </Typography>
      ) : null}
      {hasSource ? (
        <Typography variant="body2" color="secondary">
          Manuscript source selected: {sourceFile.name}. Its text is sent only
          if you tick the full-source box in the dialog.
        </Typography>
      ) : null}
      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>Suggest Keywords with AI</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="secondary" gutterBottom>
            Continuing sends this paper&rsquo;s title, abstract, venue and DOI
            — and nothing else — to Gemini, the configured AI provider, to
            generate suggestions. They are only suggestions: nothing is added
            until you select keywords and click Apply, and applied keywords
            are appended to your existing ones — never replacing them.
          </Typography>
          <Typography variant="body2" color="secondary" gutterBottom>
            <strong>Metadata-only analysis</strong> uses just those four
            fields. For richer suggestions you can additionally analyze the
            full manuscript source you selected in Publication Information
            (.tex, Overleaf .zip, or .pdf).
          </Typography>
          {hasSource ? (
            <Fragment>
              <FormControlLabel
                sx={{ display: "block", ml: 0 }}
                control={
                  <Checkbox
                    checked={sourceConsent}
                    onChange={(event) =>
                      setSourceConsent(event.target.checked)
                    }
                    slotProps={{
                      input: {
                        "aria-label":
                          "analyze the selected manuscript source with ai",
                      },
                    }}
                  />
                }
                label={`Full-source analysis: also send text extracted from ${sourceFile.name}`}
              />
              <Typography variant="body2" color="secondary" gutterBottom>
                Bounded excerpts of the extracted text (bibliography removed —
                not the full document, and never the file itself) are sent to
                Gemini only after you tick this box. Nothing is stored, and
                suggestions are never applied automatically.
              </Typography>
            </Fragment>
          ) : (
            <Typography variant="body2" color="secondary" gutterBottom>
              No manuscript source is selected. Use Import Manuscript Source
              in Publication Information to add one — its text is only ever
              sent after you consent here.
            </Typography>
          )}
          {!canRequest ? (
            <Typography variant="body2" color="error" gutterBottom>
              Tick full-source analysis to request suggestions: there is no
              title or abstract to analyze on its own yet.
            </Typography>
          ) : null}
          <RegularStyledButton
            onClick={fetchSuggestions}
            disabled={loading || !canRequest}
          >
            {hasSource && sourceConsent
              ? "Get suggestions from metadata + source"
              : "Get suggestions from metadata"}
          </RegularStyledButton>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", my: 2 }}>
              <CircularProgress size={28} />
            </Box>
          ) : null}
          {error ? (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {error}
            </Typography>
          ) : null}
          {suggestions && suggestions.length === 0 && !error ? (
            <Typography color="secondary" sx={{ mt: 1 }}>
              No keyword suggestions were returned.
            </Typography>
          ) : null}
          {(suggestions || []).map((keyword, index) => (
            <FormControlLabel
              key={keyword}
              sx={{ display: "block", ml: 0 }}
              control={
                <Checkbox
                  checked={Boolean(selected[index])}
                  onChange={(event) =>
                    setSelected((currentSel) => ({
                      ...currentSel,
                      [index]: event.target.checked,
                    }))
                  }
                  slotProps={{
                    input: { "aria-label": `apply keyword ${keyword}` },
                  }}
                />
              }
              label={keyword}
            />
          ))}
        </DialogContent>
        <DialogActions>
          <RegularStyledButton onClick={close}>Cancel</RegularStyledButton>
          <RegularStyledButton onClick={apply} disabled={!anySelected}>
            Apply selected keywords
          </RegularStyledButton>
        </DialogActions>
      </Dialog>
    </Fragment>
  );
};

KeywordAssist.propTypes = {
  onApply: PropTypes.func.isRequired,
};

export default KeywordAssist;
