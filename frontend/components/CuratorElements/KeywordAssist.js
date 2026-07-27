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
  const { collectDraftState, referenceInfo, liveBiblio } =
    useContext(CuratorContext) || {};

  // Conservative eligibility: suggestions need SOME useful primary-paper
  // metadata. A title or abstract CURRENTLY TYPED in the publication form
  // (liveBiblio, reported via the form's watch — no Save needed) counts,
  // as does a saved/fetched/imported one. While ineligible the action is
  // disabled and no request is ever made.
  const saved = referenceInfo || {};
  const live = liveBiblio || {};
  const eligible = Boolean(
    (live.title || "").trim() ||
      (live.abstract || "").trim() ||
      (saved.title || "").trim() ||
      (saved.abstract || "").trim()
  );

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [selected, setSelected] = useState({});

  const close = () => {
    setOpen(false);
    setLoading(false);
    setError("");
    setSuggestions(null);
    setSelected({});
  };

  const fetchSuggestions = () => {
    const state = collectDraftState ? collectDraftState() : {};
    const biblio = state.referenceInfo || {};
    setLoading(true);
    setError("");
    axios
      .post("/api/assist/keywords", {
        title: biblio.title || "",
        abstract: biblio.abstract || "",
        venue: biblio.publication || "",
        doi: biblio.doi || "",
      })
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

  const openAndFetch = () => {
    if (!eligible) return;
    setOpen(true);
    fetchSuggestions();
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
        onClick={openAndFetch}
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
            For richer suggestions, import a .tex file or Overleaf .zip from
            Publication Information. Manuscript excerpts are sent to Gemini
            only after explicit consent there — this action never sends them.
          </Typography>
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
