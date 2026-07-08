import { useState, useContext, Fragment } from "react";

import {
  Grid,

  Dialog,
  DialogActions,
  DialogTitle,
  DialogContent,
  TextField,
} from "@mui/material";

import { GetApp, Visibility } from "@mui/icons-material";

import axios from "axios";

import { useRouter } from "next/router";

import { convertStateToViewSchema } from "../../Utils/model";

import { getServer } from "../../Utils/utils";
import StyledTooltip from "../tooltip";
import { RegularStyledButton } from "../button";

import CuratorContext from "../../Context/Curator/curatorContext";
import AlertContext from "../../Context/Alert/alertContext";
import ServerContext from "../../Context/Servers/serverContext";
import AuthContext from "../../Context/Auth/authContext";

const preview = (metadata, setAlert, router) => {
  axios
    .post(getServer() + "/api/preview", convertStateToViewSchema(metadata))
    .then((res) => res.data)
    .then((res) =>
      router.push("/paperdetails/[id]", {
        pathname: `/paperdetails/${res}`,
        query: { server: getServer() },
      })
    )
    .catch((err) => {
      console.error(err);
      setAlert(
        "Error",
        "There was an error generating your preview, please talk to the administrators if the issue persists",
        null
      );
    });
};

const TopActions = () => {
  const {
    metadata,
    setAll,
    resetAll,
    hasMeaningfulDraft,
    getDraftTitle,
    saveDraftToServer,
  } = useContext(CuratorContext);
  const { setAlert, unsetAlert } = useContext(AlertContext);
  const { setSelectedHttp, selectedHttp } = useContext(ServerContext);
  const { authenticated } = useContext(AuthContext);
  const [mdata, setMdata] = useState("");
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [draftDialog, setDraftDialog] = useState({
    open: false,
    mode: "save",
    title: "",
  });

  const router = useRouter();
  const dialogButtonSx = {
    minWidth: { xs: "100%", sm: 0 },
    whiteSpace: "nowrap",
  };

  const openDraftDialog = (mode = "save") => {
    setDraftDialog({
      open: true,
      mode,
      title:
        (getDraftTitle && getDraftTitle()) ||
        (metadata.referenceInfo && metadata.referenceInfo.title) ||
        "Untitled draft",
    });
  };

  const closeDraftDialog = () =>
    setDraftDialog((current) => ({ ...current, open: false }));

  const saveNamedDraft = () => {
    const title = draftDialog.title.trim() || "Untitled draft";
    saveDraftToServer(title)
      .then(() => {
        closeDraftDialog();
        if (draftDialog.mode === "scratch") {
          resetAll({ preserveDraft: false });
          unsetAlert();
          return;
        }
        setAlert(
          "Draft saved",
          "Your draft was saved to your account. Resume it any time from Account > My drafts.",
          null
        );
      })
      .catch(() => {
        setAlert(
          "Error",
          "Your draft could not be saved. Please check that you are still signed in and try again.",
          null
        );
      });
  };

  const onClicks = {
    saveDraft: () => {
      if (!authenticated) {
        setAlert(
          "Sign in required",
          "Sign in to save drafts to your account. Account drafts can be resumed from any browser via the Account page.",
          null
        );
        return;
      }
      openDraftDialog("save");
    },
    resume: () => {
      setResumeDialogOpen(true);
    },
    scratch: () => {
      const hasCurrentWork = hasMeaningfulDraft ? hasMeaningfulDraft() : false;
      const discardAndReset = () => {
        resetAll({ preserveDraft: false });
        unsetAlert();
      };
      const saveAndReset = () => {
        unsetAlert();
        openDraftDialog("scratch");
      };
      setAlert(
        "Start from scratch?",
        hasCurrentWork
          ? authenticated
            ? "Save this work as a draft in your account before clearing the form, or discard it and start fresh."
            : "This will clear the current curator form. Sign in first if you want to save this work as an account draft."
          : "This will clear the current curator form.",
        <Fragment>
          <RegularStyledButton sx={dialogButtonSx} onClick={unsetAlert}>
            Cancel
          </RegularStyledButton>
          {authenticated && hasCurrentWork ? (
            <RegularStyledButton sx={dialogButtonSx} onClick={saveAndReset}>
              Save Draft and Start Fresh
            </RegularStyledButton>
          ) : null}
          <RegularStyledButton sx={dialogButtonSx} onClick={discardAndReset}>
            Discard and Start Fresh
          </RegularStyledButton>
        </Fragment>,
        { hideDismiss: true }
      );
    },
    download: (metadata) => {
      return { ...metadata, selectedHttp: selectedHttp };
    },
    preview: (e) => {
      e.preventDefault();
      preview(metadata, setAlert, router);
    },
  };

  const buttons = {
    saveDraft: (fullWidth = false) => (
      <StyledTooltip title="Save this work as a draft in your account">
        <RegularStyledButton fullWidth={fullWidth} onClick={onClicks.saveDraft}>
          Save Draft
        </RegularStyledButton>
      </StyledTooltip>
    ),
    resume: (fullWidth = false) => (
      <StyledTooltip title="Continue with an existing metadata file (json)">
        <RegularStyledButton fullWidth={fullWidth} onClick={onClicks.resume}>
          Upload Metadata
        </RegularStyledButton>
      </StyledTooltip>
    ),
    scratch: (fullWidth = false) => (
      <StyledTooltip title="Clear the session and start afresh">
        <RegularStyledButton fullWidth={fullWidth} onClick={onClicks.scratch}>
          Start from Scratch
        </RegularStyledButton>
      </StyledTooltip>
    ),
    download: (fullWidth = false) => (
      <StyledTooltip title="Export metadata of the paper being curated">
        <RegularStyledButton
          fullWidth={fullWidth}
          endIcon={<GetApp />}
          href={`data:text/json;charset=utf-8,${encodeURIComponent(
            JSON.stringify(onClicks.download(metadata), null, 2)
          )}`}
          download="metadata.json"
        >
          Export Metadata
        </RegularStyledButton>
      </StyledTooltip>
    ),
    preview: (fullWidth = false) => (
      <StyledTooltip title="Preview the curated paper">
        <RegularStyledButton
          fullWidth={fullWidth}
          endIcon={<Visibility />}
          onClick={onClicks.preview}
        >
          Preview
        </RegularStyledButton>
      </StyledTooltip>
    ),
  };

  const onFileUpload = async (e) => {
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setMdata(ev.target.result);
    };
    reader.readAsText(e.target.files[0]);
  };

  const useMetadata = () => {
    try {
      const values = JSON.parse(mdata);
      setSelectedHttp(values.selectedHttp);
      delete values.selectedHttp;
      setAll(values);
      setResumeDialogOpen(false);
    } catch (e) {
      console.error(e);
      setAlert(
        "Error",
        " There was an error parsing your file, please provide a valid json file.",
        null
      );
    }
  };

  return (
    <Fragment>
      <Grid container direction="row" spacing={1}>
        {/* MUI v6+ removed <Hidden>; responsive display lives on each item so
            the Grid container keeps its direct Grid children. */}
        <Grid container direction="row" spacing={1} size={{ xs: 12, sm: 6 }}>
          <Grid sx={{ display: { xs: "none", sm: "block" } }}>
            {buttons.saveDraft()}
          </Grid>
          <Grid sx={{ display: { xs: "none", sm: "block" } }}>
            {buttons.resume()}
          </Grid>
          <Grid sx={{ display: { xs: "none", sm: "block" } }}>
            {buttons.scratch()}
          </Grid>
          <Grid sx={{ display: { xs: "block", sm: "none" } }} size={12}>
            {buttons.saveDraft(true)}
          </Grid>
          <Grid sx={{ display: { xs: "block", sm: "none" } }} size={5}>
            {buttons.resume(true)}
          </Grid>
          <Grid sx={{ display: { xs: "block", sm: "none" } }} size={7}>
            {buttons.scratch(true)}
          </Grid>
        </Grid>
        <Grid container direction="row-reverse" spacing={1} size={{ xs: 12, sm: 6 }}>
          <Grid sx={{ display: { xs: "none", sm: "block" } }}>
            {buttons.preview()}
          </Grid>
          <Grid sx={{ display: { xs: "none", sm: "block" } }}>
            {buttons.download()}
          </Grid>
          <Grid sx={{ display: { xs: "block", sm: "none" } }} size={6}>
            {buttons.preview(true)}
          </Grid>
          <Grid sx={{ display: { xs: "block", sm: "none" } }} size={6}>
            {buttons.download(true)}
          </Grid>
        </Grid>
      </Grid>
      <Dialog
        open={resumeDialogOpen}
        onClose={() => setResumeDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Proceed</DialogTitle>
        <DialogContent dividers>
          <input
            accept="application/json"
            id="uploadJSON"
            type="file"
            style={{ display: "none" }}
            onChange={onFileUpload}
          />
          <label htmlFor="uploadJSON">
            <RegularStyledButton
              variant="contained"
              color="primary"
              component="span"
              fullWidth
            >
              Upload
            </RegularStyledButton>
          </label>
          <TextField
            value={mdata}
            label="Metadata"
            placeholder="Paste your metadata here"
            variant="outlined"
            multiline
            rows={24}
            fullWidth
            style={{ marginTop: "1em" }}
            onChange={(e) => setMdata(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <RegularStyledButton onClick={useMetadata}>
            Use this metadata
          </RegularStyledButton>
          <RegularStyledButton onClick={() => setResumeDialogOpen(false)}>
            Cancel
          </RegularStyledButton>
        </DialogActions>
      </Dialog>
      <Dialog
        open={draftDialog.open}
        onClose={closeDraftDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {draftDialog.mode === "scratch"
            ? "Save draft before starting fresh"
            : "Save draft"}
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            autoFocus
            label="Draft name"
            value={draftDialog.title}
            onChange={(event) =>
              setDraftDialog((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            fullWidth
            helperText="Drafts can be incomplete. Required fields are checked when you publish."
          />
        </DialogContent>
        <DialogActions>
          <RegularStyledButton onClick={closeDraftDialog}>
            Cancel
          </RegularStyledButton>
          <RegularStyledButton onClick={saveNamedDraft}>
            {draftDialog.mode === "scratch"
              ? "Save Draft and Start Fresh"
              : "Save Draft"}
          </RegularStyledButton>
        </DialogActions>
      </Dialog>
    </Fragment>
  );
};

export { preview };
export default TopActions;
