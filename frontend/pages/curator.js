import { Fragment, useContext, useEffect } from "react";
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
import CuratorContext from "../Context/Curator/curatorContext";
import AlertContext from "../Context/Alert/alertContext";

const CuratorDraftNavigationGuard = ({ editMode }) => {
  const router = useRouter();
  const { hasMeaningfulDraft, saveDraft, resetAll } = useContext(CuratorContext);
  const { setAlert, unsetAlert } = useContext(AlertContext);

  useEffect(() => {
    if (editMode || typeof window === "undefined") return undefined;

    const shouldGuard = () =>
      hasMeaningfulDraft && hasMeaningfulDraft();

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

      const leave = (preserveDraft) => {
        unsetAlert();
        if (preserveDraft) {
          saveDraft();
        } else {
          resetAll({ preserveDraft: false });
        }
        router.push(nextPath);
      };

      setAlert(
        "Save draft before leaving?",
        "You have curator work in this browser. Save it as the browser draft before leaving, or leave without saving it.",
        <Fragment>
          <RegularStyledButton onClick={() => leave(true)}>
            Save Draft and Leave
          </RegularStyledButton>
          <RegularStyledButton onClick={() => leave(false)}>
            Leave Without Saving
          </RegularStyledButton>
          <RegularStyledButton onClick={unsetAlert}>Stay</RegularStyledButton>
        </Fragment>
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [editMode, hasMeaningfulDraft, resetAll, router, saveDraft, setAlert, unsetAlert]);

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
  const autoResumeDraft = router.query.resumeDraft === "1";

  return (
    <CuratorState
      draftKey={editId ? null : CURATOR_DRAFT_KEY}
      autoResumeDraft={!editId && autoResumeDraft}
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
                  {!editMode && (
                    <Box sx={{ mt: 4, mb: 4 }}>
                      <TopActions />
                    </Box>
                  )}
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
