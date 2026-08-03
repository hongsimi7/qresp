import { useEffect, useContext, Fragment } from "react";

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

// Comma-separated text -> a clean list. Empty entries are dropped so a
// trailing comma does not store a blank keyword or URL.
const splitList = (value) =>
  String(value || "")
    .split(",")
    .map((el) => el.trim())
    .filter(Boolean);

const ScriptsInfoForm = () => {
  const { scripts, add, edit } = useContext(CuratorContext);

  const { scriptsHelper, openForm, closeForm, setDefault } = useContext(
    CuratorHelperContext
  );

  const { def, open } = scriptsHelper;

  const { setSaveMethod, openSelector, setMultiple, setTitle } = useContext(
    SourceTreeContext
  );

  const schema = Yup.object({
    files: Yup.string().required("Required"),
    readme: Yup.string().required("Required"),
    // Descriptive tags. A SEPARATE field from URLs: the input below used to
    // be labelled "Keywords" while writing to URLs, so a curator's keywords
    // were stored as links. Both are optional, and neither feeds the other.
    keywords: Yup.string(),
    URLs: Yup.string(),
    extraFields: extraFieldsSchema,
  });

  // RHF v7 only knows values present in defaultValues or touched by the
  // user; visually prefilled inputs are NOT registered otherwise. This
  // form's useForm outlives the dialog, so it is re-seeded on every open.
  const itemFormDefaults = (item) => ({
    files: (item && item.files && item.files.join(", ")) || "",
    readme: (item && item.readme) || "",
    keywords:
      (item &&
        item.keywords &&
        (Array.isArray(item.keywords)
          ? item.keywords.join(", ")
          : item.keywords)) ||
      "",
    URLs:
      (item &&
        item.URLs &&
        (Array.isArray(item.URLs) ? item.URLs.join(", ") : item.URLs)) ||
      "",
    extraFields: cleanExtraFields(item && item.extraFields),
  });

  const { register, handleSubmit, formState: { errors }, control, setValue, reset } = useForm({
    resolver: yupResolver(schema),
    defaultValues: itemFormDefaults(def),
  });

  useEffect(() => {
    if (open) reset(itemFormDefaults(def));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, open]);

  const onSubmit = (values) => {
    values.files = values.files.split(",").map((el) => el.trim());
    values.keywords = splitList(values.keywords);
    values.URLs = splitList(values.URLs);
    const extraFields = cleanExtraFields(values.extraFields);
    values.extraFields = extraFields;
    if (def && scripts.find((el) => el.id == def.id)) {
      edit("script", { ...def, ...values, extraFields: extraFields });
    } else {
      values["id"] = `s${scripts.length}`;
      add("script", values);
    }
    closeForm("script");
  };

  const openFileSelector = () => {
    setTitle("Choose files/folder containing the script");
    setMultiple(true);
    setSaveMethod((val) => setValue("files", val));
    openSelector();
  };

  const updating = def && scripts.find((el) => el.id == def.id) != undefined;

  return (
    <Fragment>
      <Tooltip
        title={<Typography variant="subtitle2">Add a new script</Typography>}
        arrow
      >
        <RegularStyledButton
          fullWidth
          endIcon={<AddCircleOutlined />}
          onClick={() => {
            setDefault("script", null);
            openForm("script");
          }}
        >
          Add a Script
        </RegularStyledButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => closeForm("script")}
        maxWidth="md"
        transitionDuration={150}
        fullWidth
        disableEscapeKeyDown
      >
        <DialogTitle>
          <Grid container direction="row" spacing={1} alignItems="center">
            <Grid size={11}>
              {!updating ? "Add a new script" : "Update the script"}
            </Grid>
            <Grid size={1}>
              <RegularStyledButton
                onClick={() => {
                  closeForm("script");
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
                  id="scriptFiles"
                  placeholder="Enter files for the scripts"
                  name="files"
                  helperText="Enter file name(s) to identify the script. Use the file picker (the file icon above). If you choose a folder, all contents of the folder will be considered a part of the script"
                  label="Files"
                  error={errors.files}
                  register={register}
                  action={
                    <IconButton size="small" onClick={openFileSelector}>
                      <DescriptionOutlined color="primary" />
                    </IconButton>
                  }
                  defaultValue={def && def.files && def.files.join(", ")}
                  required
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="scriptDescription"
                  placeholder="Enter descriptions for script"
                  name="readme"
                  helperText="Enter a summary about the context of the script"
                  label="Description"
                  error={errors.readme}
                  register={register}
                  defaultValue={def && def.readme}
                  required
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="scriptKeywords"
                  placeholder="Enter keywords for the script"
                  name="keywords"
                  helperText="Enter keyword(s) describing the script, if useful. (Comma seperated)"
                  label="Keywords"
                  error={errors.keywords}
                  register={register}
                  defaultValue={
                    def && def.keywords && def.keywords.join(", ")
                  }
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="scriptUrls"
                  placeholder="Enter URLs for the scripts"
                  name="URLs"
                  helperText="Enter link(s)/URLs of the script, if available. (Comma seperated)"
                  label="URLs"
                  error={errors.URLs}
                  register={register}
                  defaultValue={def && def.URLs && def.URLs.join(", ")}
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
                  {updating ? "Update" : "Save"}
                </RegularStyledButton>
              </Grid>
            </Grid>
          </form>
        </DialogContent>
      </Dialog>
    </Fragment>
  );
};

export default ScriptsInfoForm;
