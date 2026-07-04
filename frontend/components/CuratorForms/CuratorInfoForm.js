import { useContext } from "react";
import PropTypes from "prop-types";

import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from "yup";

import { Grid } from "@mui/material";

import { TextInputField, NameInputField } from "../Form/InputFields";
import { SubmitAndReset } from "../Form/Util";
import Drawer from "../drawer";

import CuratorContext from "../../Context/Curator/curatorContext";

const CuratorInfoForm = ({ editor }) => {
  const { curatorInfo, setCuratorInfo } = useContext(CuratorContext);

  const nameFields = {
    firstName: "firstName",
    middleName: "middleName",
    lastName: "lastName",
  };

  const schema = Yup.object({
    [nameFields.firstName]: Yup.string().required("Required"),
    [nameFields.middleName]: Yup.string(),
    [nameFields.lastName]: Yup.string().required("Required"),
    emailId: Yup.string().email("Invalid email address").required("Required"),
    affiliation: Yup.string(),
  });

  const { register, handleSubmit, formState: { errors }, setValue } = useForm({
    resolver: yupResolver(schema),
  });

  const onSubmit = (values) => {
    setCuratorInfo(values);
    editor();
  };

  return (
    <Drawer heading="Who is Curating the paper" defaultOpen={true}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid container direction="column" spacing={1}>
          <Grid>
            <NameInputField
              ids={nameFields}
              label="Name"
              required={true}
              id="curatorname"
              register={register}
              errors={errors}
              names={nameFields}
              defaults={{ ...curatorInfo }}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="curatorEmail"
              placeholder="Enter an email address"
              name="emailId"
              helperText="eg. Jane@univ.com"
              label="Email"
              required={true}
              error={errors["emailId"]}
              register={register}
              defaultValue={curatorInfo.emailId}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="curatorAffiliation"
              placeholder="Enter your university/organization"
              name="affiliation"
              helperText="eg. Dept. of Physics, University of XYZ"
              label="Affiliation"
              register={register}
              errore={errors["affiliation"]}
              defaultValue={curatorInfo.affiliation}
            />
          </Grid>
          <Grid>
            <SubmitAndReset submitText="Save" />
          </Grid>
        </Grid>
      </form>
    </Drawer>
  );
};

CuratorInfoForm.propTypes = {
  editor: PropTypes.func.isRequired,
};

export default CuratorInfoForm;
