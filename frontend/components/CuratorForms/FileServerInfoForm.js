import PropTypes from "prop-types";

import { useContext, useEffect, useState } from "react";
import { Box, Grid, Typography } from "@mui/material";

import Drawer from "../drawer";
import FolderAnalysis from "../CuratorElements/FolderAnalysis";
import FolderGuide from "../CuratorElements/FolderGuide";
import RadioInput from "../Form/RadioInput";
import { SelectInputField, TextInputField } from "../Form/InputFields";
import { SubmitAndReset } from "../Form/Util";
import { RegularStyledButton } from "../button";

import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";

import { getList } from "../../Utils/Scraper";

import * as Yup from "yup";

import ServerContext from "../../Context/Servers/serverContext";
import AlertContext from "../../Context/Alert/alertContext";
import SourceTreeContext from "../../Context/SourceTree/SourceTreeContext";
import LoadingContext from "../../Context/Loading/loadingContext";
import CuratorContext from "../../Context/Curator/curatorContext";

// Two distinct steps, deliberately separated:
//   Search  — browse a file server and PICK a folder (nothing is committed)
//   Save    — commit the picked folder to Curator state and close the section
// Picking a folder in the file tree only fills in the selection here, so the
// curator can see what they chose, analyze it, or pick again before saving.

const FileServerInfoForm = ({ editor }) => {
  const schema = Yup.object({
    connectionType: Yup.string().required("Required"),
    dataServer: Yup.string()
      .required("Required")
      .url("Please enter a valid url"),
  });

  const {
    httpServers,
    setSelectedHttp,
  } = useContext(ServerContext);
  const { setAlert } = useContext(AlertContext);
  const { setTree, openSelector, setSaveMethod, setConfirmLabel } = useContext(
    SourceTreeContext
  );
  const { showLoader, hideLoader } = useContext(LoadingContext);
  const { fileServerPath, setFileServerPath, registerDraftFlusher } =
    useContext(CuratorContext);

  // The folder the curator has picked but not yet committed. Seeded from the
  // saved path so editing an existing selection never looks empty, and a
  // failed or abandoned search never blanks what was already saved.
  const [selectedFolder, setSelectedFolder] = useState(fileServerPath || "");

  // Pre-select the root the saved folder lives under, so the search field is
  // not empty when the curator reopens the section to change the folder.
  const savedRoot = (httpServers || [])
    .map((server) => server.value)
    .filter((value) => value && (fileServerPath || "").startsWith(value))
    .sort((a, b) => b.length - a.length)[0];

  const { register, handleSubmit, formState: { errors }, watch, control, getValues } = useForm({
    resolver: yupResolver(schema),
    defaultValues: {
      connectionType: (fileServerPath || "").includes("zenodo")
        ? "zenodo"
        : "http",
      dataServer: savedRoot || "",
    },
  });

  // The file tree's confirmation button lands here. It ONLY records the
  // choice: no Curator state is written and the section stays open, so the
  // curator can review the path, analyze it, or search again.
  const selectFolder = (server) => setSelectedFolder(server);

  const onSubmit = (values) => {
    setSaveMethod(selectFolder);
    if (setConfirmLabel) {
      // Short enough to stay on one line in the selector's narrow header.
      setConfirmLabel("Use Folder");
    }
    showLoader();
    // Deliberately NOT clearing fileServerPath or the current selection: a
    // search that is cancelled or fails must leave what the curator already
    // had intact.
    getList(values.dataServer, values.connectionType, true, null)
      .then((el) => {
        setSelectedHttp(el.details);
        setTree(el.files);
        openSelector();
      })
      .catch((err) => {
        console.error(err);
        setAlert(
          "Error",
          "There was an error retrieving data from the url provided, please check the URL and try again",
          null
        );
      })
      .finally(() => hideLoader());
  };

  // The only action that commits the selection.
  const saveFileServer = () => {
    if (!selectedFolder) {
      return;
    }
    setFileServerPath(selectedFolder);
    editor();
  };

  const watchConnectionType = watch("connectionType");

  const options = [
    {
      label: "File Server",
      value: "http",
    },
    {
      label: "Zenodo",
      value: "zenodo",
    },
  ];

  useEffect(() => {
    if (!registerDraftFlusher) return undefined;
    // A picked-but-unsaved folder is still worth keeping in a draft; the
    // search field holds a ROOT, not the folder, so it is never used here.
    return registerDraftFlusher("fileServerPath", () => ({
      fileServerPath: selectedFolder || fileServerPath || "",
    }));
  }, [fileServerPath, selectedFolder, getValues, registerDraftFlusher]);

  return (
    <Drawer heading="Where is the paper" defaultOpen={true}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid direction="column" container spacing={1}>
          <Grid>
            <RadioInput
              name="connectionType"
              helperText="Select location type of the data source"
              options={options}
              row={true}
              control={control}
              error={errors.connectionType}
              defVal="http"
              id="connectionTypeRadio"
            />
          </Grid>
          <Grid>
            {watchConnectionType == "http" ? (
              <SelectInputField
                id="dataServer"
                placeholder="Select a server from a list  or enter one"
                helperText="Select URL of remote server where paper content is organized and located. e.g. https://notebook.rcc.uchicago.edu/files/"
                label="File Server"
                options={httpServers}
                required={true}
                name="dataServer"
                error={errors.dataServer}
                control={control}
              />
            ) : (
              <TextInputField
                id="dataServer"
                placeholder="Enter zenodo record URL"
                name="dataServer"
                helperText="eg. https://zenodo.org/record/3981451"
                label="Zenodo"
                required={true}
                error={errors.dataServer}
                register={register}
              />
            )}
          </Grid>
          <Grid>
            <SubmitAndReset submitText="Search" />
          </Grid>
        </Grid>
      </form>

      {/* Compact read-only preview. The exact URL stays selectable and
          copyable, but it is confined to its own scrollable strip instead of
          running across the section. */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="overline" color="text.secondary" component="div">
          Selected folder
        </Typography>
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            px: 1.5,
            py: 1,
            bgcolor: "action.hover",
            maxWidth: "100%",
            overflowX: "auto",
          }}
        >
          <Typography
            variant="body2"
            component="div"
            data-testid="selected-folder"
            color={selectedFolder ? "text.primary" : "text.secondary"}
            sx={{
              fontFamily: "monospace",
              whiteSpace: "nowrap",
              fontStyle: selectedFolder ? "normal" : "italic",
            }}
          >
            {selectedFolder || "None yet"}
          </Typography>
        </Box>
      </Box>

      {/* Deliberate action row: the two things a curator does with a
          selection, side by side and nothing else. Assisted curation runs on
          the CURRENT selection, before it is committed, and adds nothing on
          its own; there is no second URL box, so no browser-supplied location
          can be fetched. */}
      <Box
        data-testid="fileserver-actions"
        sx={{ mt: 2, display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}
      >
        <FolderAnalysis path={selectedFolder} />
        <RegularStyledButton
          type="button"
          onClick={saveFileServer}
          disabled={!selectedFolder}
        >
          Save File Server
        </RegularStyledButton>
        {/* Advice only — it validates nothing and changes no behavior. */}
        <FolderGuide />
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        sx={{ mt: 1 }}
      >
        {selectedFolder
          ? "Analyze proposes charts, datasets, scripts and tools for you to " +
            "review — nothing is saved or published. Save File Server commits " +
            "this path to the paper."
          : "Search above, then pick one folder in the file tree to analyze or " +
            "save it."}
      </Typography>
    </Drawer>
  );
};

FileServerInfoForm.propTypes = {
  editor: PropTypes.func.isRequired,
};

export default FileServerInfoForm;
