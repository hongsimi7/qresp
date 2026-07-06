import { Fragment } from "react";
import { Container, Box } from "@mui/material";
import { useRouter } from "next/router";

import CuratorState from "../Context/Curator/CuratorState";
import CuratorHelperState from "../Context/CuratorHelpers/curatorHelperState";
import SourceTreeState from "../Context/SourceTree/SourceTreeState";

import SEO from "../components/seo";
import TopActions from "../components/CuratorElements/TopActions";
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

  return (
    <CuratorState>
      <CuratorHelperState>
        <SourceTreeState>
          <SEO title={"Qresp | Curator"} description={curatorDescription} />
          <FileTree />
          <Container>
            <EditModeController editId={editId} server={returnServer}>
              {(editMode) => (
                <Fragment>
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
