import PropTypes from "prop-types";

import { useContext, useEffect } from "react";
import { Grid } from "@mui/material";

import Drawer from "../drawer";
import RadioInput from "../Form/RadioInput";
import { SelectInputField, TextInputField } from "../Form/InputFields";
import { SubmitAndReset } from "../Form/Util";

import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";

import { getList } from "../../Utils/Scraper";

import * as Yup from "yup";

import ServerContext from "../../Context/Servers/serverContext";
import AlertContext from "../../Context/Alert/alertContext";
import SourceTreeContext from "../../Context/SourceTree/SourceTreeContext";
import LoadingContext from "../../Context/Loading/loadingContext";
import CuratorContext from "../../Context/Curator/curatorContext";

const FileServerInfoForm = ({ editor }) => {
  const schema = Yup.object({
    connectionType: Yup.string().required("Required"),
    dataServer: Yup.string()
      .required("Required")
      .url("Please enter a valid url"),
  });

  const { register, handleSubmit, formState: { errors }, watch, control, getValues } = useForm({
    resolver: yupResolver(schema),
    defaultValues: { connectionType: "http", dataServer: "" },
  });

  const saveMethod = (server) => {
    setFileServerPath(server);
    editor();
  };

  const onSubmit = (values) => {
    setSaveMethod(saveMethod);
    showLoader();
    setFileServerPath("");
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

  const { httpServers, setSelectedHttp } = useContext(ServerContext);
  const { setAlert } = useContext(AlertContext);
  const { setTree, openSelector, setSaveMethod } = useContext(
    SourceTreeContext
  );
  const { showLoader, hideLoader } = useContext(LoadingContext);
  const { fileServerPath, setFileServerPath, registerDraftFlusher } =
    useContext(CuratorContext);

  useEffect(() => {
    if (!registerDraftFlusher) return undefined;
    return registerDraftFlusher("fileServerPath", () => {
      const values = getValues();
      return {
        fileServerPath: values.dataServer || fileServerPath || "",
      };
    });
  }, [fileServerPath, getValues, registerDraftFlusher]);

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
    </Drawer>
  );
};

FileServerInfoForm.propTypes = {
  editor: PropTypes.func.isRequired,
};

export default FileServerInfoForm;
