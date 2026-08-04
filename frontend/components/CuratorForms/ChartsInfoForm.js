import { useEffect, useState, useContext, Fragment } from "react";

import {
  Grid,
  Tooltip,
  Typography,
  IconButton,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { AddCircleOutlined, DescriptionOutlined } from "@mui/icons-material";

import { TextInputField } from "../Form/InputFields";
import ExtraFieldInput, {
  cleanExtraFields,
  extraFieldsSchema,
} from "../Form/ExtraFieldInput";
import { RegularStyledButton } from "../button";

import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from "yup";

import CuratorContext from "../../Context/Curator/curatorContext";
import SourceTreeContext from "../../Context/SourceTree/SourceTreeContext";
import CuratorHelperContext from "../../Context/CuratorHelpers/curatorHelperContext";

const ChartsInfoForm = () => {
  const { charts, add, edit } = useContext(CuratorContext);

  const { chartsHelper, openForm, closeForm, setDefault } = useContext(
    CuratorHelperContext
  );

  const { def, open } = chartsHelper;

  const { setSaveMethod, openSelector, setMultiple } = useContext(
    SourceTreeContext
  );

  const schema = Yup.object({
    caption: Yup.string().required("Required"),
    number: Yup.number().required("Required"),
    files: Yup.string(),
    imageFile: Yup.string().required("Required"),
    notebookFile: Yup.string(),
    properties: Yup.string().required("Required"),
    extraFields: extraFieldsSchema,
  });

  // RHF v7 only knows values present in defaultValues or touched by the
  // user; visually prefilled inputs are NOT registered otherwise. This
  // form's useForm outlives the dialog, so it is re-seeded on every open.
  const chartFormDefaults = (chart) => ({
    caption: (chart && chart.caption) || "",
    number: (chart && chart.number) || charts.length,
    properties:
      (chart && chart.properties && chart.properties.join(", ")) || "",
    files: (chart && chart.files && chart.files.join(", ")) || "",
    imageFile: (chart && chart.imageFile) || "",
    notebookFile: (chart && chart.notebookFile) || "",
    extraFields: cleanExtraFields(chart && chart.extraFields),
  });

  const { register, handleSubmit, formState: { errors }, control, setValue, reset } = useForm({
    resolver: yupResolver(schema),
    defaultValues: chartFormDefaults(def),
  });

  useEffect(() => {
    if (open) reset(chartFormDefaults(def));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, open]);

  const onSubmit = (values) => {
    values.properties = values.properties.split(",").map((el) => el.trim());
    values.files = values.files.split(",").map((el) => el.trim());
    const extraFields = cleanExtraFields(values.extraFields);
    values.extraFields = extraFields;
    if (def && charts.find((el) => el.id == def.id)) {
      edit("chart", { ...def, ...values, extraFields: extraFields });
    } else {
      values["id"] = `c${charts.length}`;
      add("chart", values);
    }
    closeForm("chart");
  };

  const onOpenFileSelector = (type) => {
    if (type == "imageFile") {
      setMultiple(false);
      setSaveMethod((val) => setValue("imageFile", val));
    } else if (type == "notebookFile") {
      setMultiple(false);
      setSaveMethod((val) => setValue("notebookFile", val));
    } else {
      setMultiple(true);
      setSaveMethod((val) => setValue("files", val));
    }

    openSelector();
  };

  return (
    <Fragment>
      <Tooltip
        title={<Typography variant="subtitle2">Add a new chart</Typography>}
        arrow
      >
        <RegularStyledButton
          fullWidth
          endIcon={<AddCircleOutlined />}
          onClick={() => {
            setDefault("chart", null);
            openForm("chart");
          }}
        >
          Add a Chart
        </RegularStyledButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => closeForm("chart")}
        maxWidth="md"
        transitionDuration={150}
        fullWidth
        disableEscapeKeyDown
      >
        <DialogTitle>
          <Grid container direction="row" spacing={1} alignItems="center">
            <Grid size={11}>
              Add a new chart
            </Grid>
            <Grid size={1}>
              <RegularStyledButton
                onClick={() => {
                  closeForm("chart");
                }}
                fullWidth
              >
                Cancel
              </RegularStyledButton>
            </Grid>
          </Grid>
        </DialogTitle>
        <DialogContent dividers>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Grid container direction="column" spacing={1}>
              <Grid>
                <TextInputField
                  id="caption"
                  placeholder="Enter the figure caption"
                  name="caption"
                  helperText="Use the paper's caption for this figure. If the
                    figure has no published caption, write a concise
                    description of what it shows."
                  label="Figure Caption"
                  error={errors.caption}
                  register={register}
                  defaultValue={def && def.caption}
                  required
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="number"
                  placeholder="Enter the figure number"
                  name="number"
                  helperText="The figure's number in the paper (e.g. 2, S1)"
                  label="Figure Number"
                  error={errors.number}
                  register={register}
                  defaultValue={(def && def.number) || charts.length}
                  required
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="files"
                  placeholder="Enter file names used to contruct the chart"
                  name="files"
                  helperText="Enter file name(s) containing the data displayed in the chart (e.g. a file in CSV format), or supporting images that belong with it. Use the file picker button to pick files"
                  label="Input / Supporting Files"
                  error={errors.files}
                  register={register}
                  action={
                    <IconButton
                      size="small"
                      onClick={() => onOpenFileSelector("files")}
                    >
                      <DescriptionOutlined color="primary" />
                    </IconButton>
                  }
                  defaultValue={def && def.files && def.files.join(", ")}
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="imageFile"
                  placeholder="Enter chart image file name"
                  name="imageFile"
                  helperText="Enter the file name of the image for this figure — one image per Chart. Use the file picker button to pick files. Formats Allowed: jpeg, jpg, png, gif"
                  label="Figure Image"
                  error={errors.imageFile}
                  register={register}
                  action={
                    <IconButton
                      size="small"
                      onClick={() => onOpenFileSelector("imageFile")}
                    >
                      <DescriptionOutlined color="primary" />
                    </IconButton>
                  }
                  defaultValue={def && def.imageFile}
                  required
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="notebookFile"
                  placeholder="Enter notebook file"
                  name="notebookFile"
                  helperText="Enter the file name of the notebook that reproduces this figure. Use the file picker button to pick files. Formats Allowed: ipynb"
                  label="Reproduction Notebook"
                  error={errors.notebookFile}
                  action={
                    <IconButton
                      size="small"
                      onClick={() => onOpenFileSelector("notebookFile")}
                    >
                      <DescriptionOutlined color="primary" />
                    </IconButton>
                  }
                  register={register}
                  defaultValue={def && def.notebookFile}
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="chartproperties"
                  placeholder="Enter keywords"
                  name="properties"
                  helperText="Enter keyword(s) for the content displayed in the figure. e.g. potential energy surface, band gap. (Comma separated values)"
                  label="Keywords"
                  error={errors.properties}
                  register={register}
                  defaultValue={
                    def && def.properties && def.properties.join(", ")
                  }
                  required
                />
              </Grid>
              <Grid>
                <ExtraFieldInput
                  control={control}
                  register={register}
                  errors={errors && errors.extraFields}
                  defaults={def && def.extraFields}
                />
              </Grid>
              <Grid>
                <RegularStyledButton fullWidth type="submit">
                  {def && charts.find((el) => el.id == def.id) != undefined
                    ? "Update"
                    : "Save"}
                </RegularStyledButton>
              </Grid>
            </Grid>
          </form>
        </DialogContent>
      </Dialog>
    </Fragment>
  );
};

export default ChartsInfoForm;
