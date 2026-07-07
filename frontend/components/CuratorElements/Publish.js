import { useContext, Fragment } from "react";
import axios from "axios";
import { Box } from "@mui/material";

import Ajv from "ajv";

import StyledButton from "../button";
import { convertStatetoReqSchema } from "../../Utils/model";
import { getServer } from "../../Utils/utils";

import Schema from "../../public/schema_v1.2.json";
import CuratorContext from "../../Context/Curator/curatorContext";
import CuratorHelperContext from "../../Context/CuratorHelpers/curatorHelperContext";
import ServerContext from "../../Context/Servers/serverContext";
import AlertContext from "../../Context/Alert/alertContext";
import LoadingContext from "../../Context/Loading/loadingContext";

const variableTotext = {
  curatorInfo: "Curator Information",
  paperInfo: "Paper Information",
  fileServerPathInfo: "File Server Information",
  referenceInfo: "Reference Information",
  documentationInfo: "Documentation Information",
  licenseInfo: "License Information",
  workflowInfo: "Workflow Graph",
};

const validate = (editing, metadata) => {
  /*
  Validate before sending a publish request
    1. Check if any of the sections are in edit mode 
    2. Check if there any charts and datasets
    3. Use the json schema validator for sanity check (each individual section was fixed before only) 
  */

  const errors = [];
  const { charts, datasets } = metadata;

  const incomplete = Object.keys(editing)
    .map((el) => (editing[el] ? el : null))
    .filter((el) => el != null && el != "documentationInfo");

  if (incomplete.length > 0) {
    errors.push(
      <Fragment>
        <strong>
          The following required sections are not saved, please complete them
          (if not already) and save them:
        </strong>
        <ul>
          {incomplete.map((el, i) => (
            <li key={i}>{variableTotext[el]}</li>
          ))}
        </ul>
      </Fragment>
    );
  }

  if (charts.length == 0 || datasets.length == 0) {
    let str = "";
    if (errors.length == 0) {
      str += "Also, you ";
    } else {
      str += "You ";
    }
    str +=
      "need atleast one item in each of the sections below to publish on Qresp:";
    errors.push(
      <Fragment>
        <strong>{str}</strong>
        <ul>
          {charts.length == 0 && <li>Charts</li>}
          {datasets.length == 0 && <li>Datasets</li>}
        </ul>
      </Fragment>
    );
  }
  if (errors.length > 0) return { valid: false, errors: errors };

  // Ajv 8: strict mode is off to accept the legacy schema, but compilation
  // can still THROW — the schema's duplicate draft-04-style `id` anchors make
  // "#/properties/collections/items" ambiguous. The backend re-validates
  // every publish/update payload anyway, so a schema-compile failure must
  // not block (or crash) the user; skip the client-side sanity check instead.
  try {
    const ajv = new Ajv({ strict: false });
    const validateSchema = ajv.compile(Schema);
    const valid = validateSchema(metadata);
    if (!valid) return { valid: false, errors: errors };
  } catch (e) {
    console.error("Client-side schema validation skipped:", e);
  }

  return { valid: true, errors: errors };
};

// Reused by the edit flow (EditMode.js) so create and edit validate alike.
export { validate };

const makePublishRequest = (paper, setAlert, showLoader, hideLoader) => {
  showLoader();
  axios
    .post(getServer() + "/api/publish", paper)
    .then(() =>
      setAlert(
        "Success",
        <p style={{ textAlign: "justify" }}>
          We've sent you an email with a link to publish the paper. Check the
          email you provided, just click the link in there to publish the paper.
          <br /> If you have any questions or issues, please feel free to write
          to us.
          <br />
          <br /> Thank You
        </p>,
        null
      )
    )
    .catch((err) => {
      console.error(err);
      setAlert(
        "Error !",
        <p>
          We're very sorry but there was an error publishing the paper!, Please
          try again
          <br />
          {err.response &&
            err.response.data &&
            err.response.data.msg &&
            `Error Message:${err.response.data.msg}`}
        </p>,
        null
      );
    })
    .finally(() => hideLoader());
};

const Publish = () => {
  const { metadata } = useContext(CuratorContext);

  const { editing } = useContext(CuratorHelperContext);
  const { selectedHttp } = useContext(ServerContext);
  const { setAlert } = useContext(AlertContext);
  const { showLoader, hideLoader } = useContext(LoadingContext);

  const onClick = () => {
    const paper = convertStatetoReqSchema(metadata, selectedHttp);
    const isValid = validate(editing, paper);
    if (!isValid.valid) {
      setAlert(
        "Something's Missing",
        <Fragment>
          {isValid.errors.map((el, i) => (
            <div key={i}>{el}</div>
          ))}
        </Fragment>,
        null
      );
      return;
    }

    makePublishRequest(paper, setAlert, showLoader, hideLoader);
  };

  return (
    <Fragment>
      <Box sx={{ my: 3 }}>
        <StyledButton fullWidth onClick={onClick}>
          Publish
        </StyledButton>
      </Box>
    </Fragment>
  );
};

export default Publish;
