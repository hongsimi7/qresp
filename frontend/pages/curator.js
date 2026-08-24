import { Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Container,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useRouter } from "next/router";

import CuratorState from "../Context/Curator/CuratorState";
import CuratorHelperState from "../Context/CuratorHelpers/curatorHelperState";
import SourceTreeState from "../Context/SourceTree/SourceTreeState";

import SEO from "../components/seo";
import TopActions from "../components/CuratorElements/TopActions";
import { RegularStyledButton } from "../components/button";
import CuratorElement from "../components/CuratorElements/CuratorElement";
import FileServerElement from "../components/CuratorElements/FileServerElement";
import PaperInfoElement from "../components/CuratorElements/PaperInfoElement";
import ReferenceInfoElement from "../components/CuratorElements/ReferenceElement";
import FigureWorkspace from "../components/CuratorElements/FigureWorkspace";
import DocumentationInfoElement from "../components/CuratorElements/DocumentationElement";
import WorkflowInfoElement from "../components/CuratorElements/WorkflowElement";
import LicenseInfoElement from "../components/CuratorElements/LicenseElement";
import FileTree from "../components/FileTree";
import Publish from "../components/CuratorElements/Publish";
import EditModeController from "../components/CuratorElements/EditMode";
import { CURATOR_DRAFT_KEY } from "../Utils/browserDraft";
import { fetchServerDraft } from "../Utils/serverDrafts";
import CuratorContext from "../Context/Curator/curatorContext";
import AlertContext from "../Context/Alert/alertContext";
import AuthContext from "../Context/Auth/authContext";

// Loads an account draft (?draft=<id>) into the curator form. The loaded
// draft id stays active so Save Draft updates it instead of duplicating it.
const ServerDraftLoader = ({ draftId }) => {
  const { applyServerDraft } = useContext(CuratorContext);
  const { setAlert } = useContext(AlertContext);
  const attemptedRef = useRef(null);

  useEffect(() => {
    if (!draftId || attemptedRef.current === draftId) return;
    attemptedRef.current = draftId;
    fetchServerDraft(draftId)
      .then((draft) => applyServerDraft(draft))
      .catch(() => {
        setAlert(
          "Draft not found",
          "This draft could not be loaded. It may have been deleted, or you may need to sign in with the account that owns it.",
          null
        );
      });
    // applyServerDraft/setAlert are stable enough for this one-shot fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  return null;
};

// Remounts the curator form tree whenever the context is reset. Without
// this, uncontrolled form inputs keep showing their old values after
// "Start from Scratch" even though the context state is blank.
const CuratorFormsRemounter = ({ children }) => {
  const { resetVersion } = useContext(CuratorContext);
  return <Fragment key={resetVersion}>{children}</Fragment>;
};

// Resolve a document click into an in-app navigation target, or null when the
// click must not be guarded: modified/aux clicks, downloads, new-tab targets,
// external origins, and same-path links. Shared by both navigation guards.
const resolveGuardedNavTarget = (event, router) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }
  const anchor = event.target.closest && event.target.closest("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  let url;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch (e) {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  if (nextPath === router.asPath) return null;
  return nextPath;
};

// Edit mode's unsaved-changes guard: no draft saving here (drafts are a
// create-mode concept) — just warn before losing edits. Uses
// hasUnsavedDraftChanges, which also snapshots OPEN section forms via the
// registered flushers, so unsaved-but-typed values count as changes.
const CuratorEditNavigationGuard = () => {
  const router = useRouter();
  const { hasUnsavedDraftChanges } = useContext(CuratorContext);
  const { setAlert, unsetAlert } = useContext(AlertContext);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const shouldGuard = () =>
      hasUnsavedDraftChanges && hasUnsavedDraftChanges();

    const handleBeforeUnload = (event) => {
      if (!shouldGuard()) return undefined;
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    const handleDocumentClick = (event) => {
      if (!shouldGuard()) return;
      const nextPath = resolveGuardedNavTarget(event, router);
      if (!nextPath) return;

      event.preventDefault();
      event.stopPropagation();

      setAlert(
        "Leave without saving?",
        "You have unsaved changes to this record. They will be lost if you leave — use Save Changes to keep them.",
        <Fragment>
          <RegularStyledButton
            onClick={() => {
              unsetAlert();
              router.push(nextPath);
            }}
          >
            Leave Without Saving
          </RegularStyledButton>
          <RegularStyledButton onClick={unsetAlert}>Stay</RegularStyledButton>
        </Fragment>,
        { hideDismiss: true }
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedDraftChanges, router, setAlert, unsetAlert]);

  return null;
};

const CuratorDraftNavigationGuard = ({ editMode }) => {
  const router = useRouter();
  const {
    getDraftTitle,
    hasMeaningfulDraft,
    hasUnsavedDraftChanges,
    saveDraft,
    draftDirty,
    saveDraftToServer,
  } = useContext(CuratorContext);
  const { setAlert, unsetAlert } = useContext(AlertContext);
  const { authenticated } = useContext(AuthContext);
  const [leaveDraftDialog, setLeaveDraftDialog] = useState({
    open: false,
    nextPath: "",
    title: "",
  });

  const closeLeaveDraftDialog = () =>
    setLeaveDraftDialog((current) => ({ ...current, open: false }));

  const openLeaveDraftDialog = useCallback(
    (nextPath) => {
      unsetAlert();
      setLeaveDraftDialog({
        open: true,
        nextPath,
        title:
          (getDraftTitle && getDraftTitle()) ||
          "Untitled draft",
      });
    },
    [getDraftTitle, unsetAlert]
  );

  const saveNamedDraftAndLeave = () => {
    const title = leaveDraftDialog.title.trim() || "Untitled draft";
    saveDraftToServer(title)
      .then(() => {
        const { nextPath } = leaveDraftDialog;
        setLeaveDraftDialog({ open: false, nextPath: "", title: "" });
        router.push(nextPath);
      })
      .catch(() => {
        setLeaveDraftDialog((current) => ({ ...current, open: false }));
        setAlert(
          "Error",
          "Your draft could not be saved, so you are still on the curator. Please check that you are still signed in and try again.",
          null
        );
      });
  };

  useEffect(() => {
    if (editMode || typeof window === "undefined") return undefined;

    const shouldGuard = () =>
      hasUnsavedDraftChanges
        ? hasUnsavedDraftChanges()
        : hasMeaningfulDraft && hasMeaningfulDraft() && draftDirty;

    const handleBeforeUnload = (event) => {
      if (!shouldGuard()) return undefined;
      if (saveDraft) saveDraft();
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    const handleDocumentClick = (event) => {
      if (!shouldGuard()) return;
      const nextPath = resolveGuardedNavTarget(event, router);
      if (!nextPath) return;

      event.preventDefault();
      event.stopPropagation();

      const leaveWithoutSaving = () => {
        // The local recovery copy (autosave) stays behind; only account
        // drafts count as "saved".
        unsetAlert();
        router.push(nextPath);
      };

      setAlert(
        "Save draft before leaving?",
        authenticated
          ? "You have unsaved curator changes. Save them as a draft in your account before leaving, or leave without saving."
          : "You have unsaved curator changes. Sign in to save them as an account draft, or leave without saving (a local recovery copy stays in this browser).",
        <Fragment>
          {authenticated ? (
            <RegularStyledButton onClick={() => openLeaveDraftDialog(nextPath)}>
              Save Draft and Leave
            </RegularStyledButton>
          ) : null}
          <RegularStyledButton onClick={leaveWithoutSaving}>
            Leave Without Saving
          </RegularStyledButton>
          <RegularStyledButton onClick={unsetAlert}>Stay</RegularStyledButton>
        </Fragment>,
        { hideDismiss: true }
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [
    authenticated,
    draftDirty,
    editMode,
    getDraftTitle,
    hasUnsavedDraftChanges,
    hasMeaningfulDraft,
    openLeaveDraftDialog,
    router,
    saveDraft,
    saveDraftToServer,
    setAlert,
    unsetAlert,
  ]);

  return (
    <Dialog
      open={leaveDraftDialog.open}
      onClose={closeLeaveDraftDialog}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Save draft before leaving</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          label="Draft name"
          value={leaveDraftDialog.title}
          onChange={(event) =>
            setLeaveDraftDialog((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
          fullWidth
          helperText="Drafts can be incomplete. Required fields are checked when you publish."
        />
      </DialogContent>
      <DialogActions>
        <RegularStyledButton onClick={closeLeaveDraftDialog}>
          Cancel
        </RegularStyledButton>
        <RegularStyledButton onClick={saveNamedDraftAndLeave}>
          Save Draft and Leave
        </RegularStyledButton>
      </DialogActions>
    </Dialog>
  );
};

const curator = () => {
  const curatorDescription =
    "The curator guides the user in creating metadata from the data associated to a scientific paper. The metadata after being published becomes availabe in a ";

  // Edit mode (?edit=<paperId>&server=<origin>): same forms and state, but
  // the record is loaded from the backend and saved back with PUT instead of
  // the publish/email flow. Create mode is completely unchanged.
  const router = useRouter();
  const editId =
    typeof router.query.edit === "string" && router.query.edit.length > 0
      ? router.query.edit
      : null;
  const returnServer =
    typeof router.query.server === "string" ? router.query.server : "";
  const draftId =
    !editId && typeof router.query.draft === "string" && router.query.draft.length > 0
      ? router.query.draft
      : null;
  const autoResumeDraft = router.query.resumeDraft === "1";

  return (
    <CuratorState
      draftKey={editId ? null : CURATOR_DRAFT_KEY}
      autoResumeDraft={!editId && !draftId && autoResumeDraft}
    >
      <CuratorHelperState>
        <SourceTreeState>
          <SEO title={"Qresp | Curator"} description={curatorDescription} />
          <FileTree />
          <Container>
            <EditModeController editId={editId} server={returnServer}>
              {(editMode) => (
                <Fragment>
                  <CuratorDraftNavigationGuard editMode={editMode} />
                  {editMode && <CuratorEditNavigationGuard />}
                  {!editMode && <ServerDraftLoader draftId={draftId} />}
                  {!editMode && (
                    <Box sx={{ mt: 4, mb: 4 }}>
                      <TopActions />
                    </Box>
                  )}
                  <CuratorFormsRemounter>
                    <CuratorElement />
                    <FileServerElement />
                    <PaperInfoElement />
                    <ReferenceInfoElement />
                    {/* ONE section, replacing four. Add Charts / Tools /
                        Datasets / Scripts asked a curator to think in Qresp's
                        storage categories and then connect them separately;
                        nobody curating a paper thinks that way. The figure is
                        the root and the rest hangs off it. Same models, same
                        forms, same validation -- only the way in changed. */}
                    <FigureWorkspace />
                    <DocumentationInfoElement />
                    <WorkflowInfoElement />
                    <LicenseInfoElement />
                    {!editMode && <Publish />}
                  </CuratorFormsRemounter>
                </Fragment>
              )}
            </EditModeController>
          </Container>
        </SourceTreeState>
      </CuratorHelperState>
    </CuratorState>
  );
};

export { CuratorDraftNavigationGuard, CuratorEditNavigationGuard };
export default curator;
