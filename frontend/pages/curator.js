import { Fragment, useContext, useEffect, useRef } from "react";
import { Container, Box } from "@mui/material";
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
import ChartsInfoElement from "../components/CuratorElements/ChartsElement";
import ToolsInfoElement from "../components/CuratorElements/ToolsElement";
import DatasetsInfoElement from "../components/CuratorElements/DatasetsElement";
import ScriptsInfoElement from "../components/CuratorElements/ScriptsElement";
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

const CuratorDraftNavigationGuard = ({ editMode }) => {
  const router = useRouter();
  const { hasMeaningfulDraft, saveDraft, draftDirty, saveDraftToServer } =
    useContext(CuratorContext);
  const { setAlert, unsetAlert } = useContext(AlertContext);
  const { authenticated } = useContext(AuthContext);

  useEffect(() => {
    if (editMode || typeof window === "undefined") return undefined;

    const shouldGuard = () =>
      hasMeaningfulDraft && hasMeaningfulDraft() && draftDirty;

    const handleBeforeUnload = (event) => {
      if (!shouldGuard()) return undefined;
      if (saveDraft) saveDraft();
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    const handleDocumentClick = (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !shouldGuard()
      ) {
        return;
      }

      const anchor = event.target.closest && event.target.closest("a[href]");
      if (!anchor || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch (e) {
        return;
      }

      if (url.origin !== window.location.origin) return;

      const nextPath = `${url.pathname}${url.search}${url.hash}`;
      if (nextPath === router.asPath) return;

      event.preventDefault();
      event.stopPropagation();

      const leaveWithoutSaving = () => {
        // The local recovery copy (autosave) stays behind; only account
        // drafts count as "saved".
        unsetAlert();
        router.push(nextPath);
      };

      const saveAndLeave = () => {
        saveDraftToServer()
          .then(() => {
            unsetAlert();
            router.push(nextPath);
          })
          .catch(() => {
            setAlert(
              "Error",
              "Your draft could not be saved, so you are still on the curator. Please check that you are still signed in and try again.",
              null
            );
          });
      };

      setAlert(
        "Save draft before leaving?",
        authenticated
          ? "You have unsaved curator changes. Save them as a draft in your account before leaving, or leave without saving."
          : "You have unsaved curator changes. Sign in to save them as an account draft, or leave without saving (a local recovery copy stays in this browser).",
        <Fragment>
          {authenticated ? (
            <RegularStyledButton onClick={saveAndLeave}>
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
    hasMeaningfulDraft,
    router,
    saveDraft,
    saveDraftToServer,
    setAlert,
    unsetAlert,
  ]);

  return null;
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
                    <ChartsInfoElement />
                    <ToolsInfoElement />
                    <DatasetsInfoElement />
                    <ScriptsInfoElement />
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

export default curator;
