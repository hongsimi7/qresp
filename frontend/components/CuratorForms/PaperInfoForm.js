import { useContext, useEffect } from "react";
import PropTypes from "prop-types";

import { Grid, Tooltip, Typography, IconButton } from "@mui/material";
import {
  AddCircleOutlined,
  RemoveCircleOutlined,
  DescriptionOutlined,
} from "@mui/icons-material";

import { namesUtil } from "../../Utils/utils";

import { TextInputField } from "../Form/InputFields";
import { SubmitAndReset, FormInputLabel } from "../Form/Util";
import NameInput from "../Form//NameInput";
import Drawer from "../drawer";

import { useForm, useFieldArray } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from "yup";

import CuratorContext from "../../Context/Curator/curatorContext";
import SourceTreeContext from "../../Context/SourceTree/SourceTreeContext";
import KeywordAssist from "../CuratorElements/KeywordAssist";

const PaperInfoForm = ({ editor }) => {
  // Qresp curation metadata ONLY (PIs, PaperStack, keywords, notebook).
  // The primary paper's bibliography lives in the separate
  // "Publication Information for This Paper" section (referenceInfo).
  const { paperInfo, setPaperInfo, fileServerPath, registerDraftFlusher } =
    useContext(CuratorContext);
  const { setSaveMethod, openSelector, HideSelector } = useContext(
    SourceTreeContext
  );

  const schema = Yup.object({
    PIs: Yup.array()
      .of(
        Yup.object().shape({
          firstName: Yup.string().required("Required"),
          middleName: Yup.string(),
          lastName: Yup.string().required("Required"),
        })
      )
      .required("Required")
      .min(1, "Minimum of 1 PrincipalInvestigator"),
    collections: Yup.string().required("Required"),
    tags: Yup.string().required("Required"),
    notebookFile: Yup.string(),
  });

  const formattedNames = namesUtil.get(paperInfo.PIs);
  const { register, handleSubmit, formState: { errors }, watch, control, setValue, getValues } = useForm({
    resolver: yupResolver(schema),
    defaultValues: {
      ...paperInfo,
      PIs: formattedNames,
      // State keeps tags/collections as arrays; this form edits them as
      // comma-separated strings (split again in onSubmit). collections was
      // missing the join, so re-editing a saved section — and curator edit
      // mode loading ["MICCOM"] — failed yup's string check.
      tags: (paperInfo.tags || []).join(", "),
      collections: (paperInfo.collections || []).join(", "),
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "PIs",
  });

  const splitList = (value) =>
    String(value || "")
      .split(",")
      .map((el) => el.trim())
      .filter(Boolean);

  const toPaperInfo = (values) => {
    const next = {
      ...paperInfo,
      ...values,
      collections: splitList(values.collections),
      tags: splitList(values.tags),
      PIs: namesUtil.set(values.PIs || []),
    };
    if (next.notebookFile && next.notebookFile.length > 0) {
      next.notebookPath = fileServerPath + next.notebookFile;
    }
    return next;
  };

  useEffect(() => {
    if (!registerDraftFlusher) return undefined;
    return registerDraftFlusher("paperInfo", () => ({
      paperInfo: toPaperInfo(getValues()),
    }));
  }, [getValues, registerDraftFlusher, toPaperInfo]);

  const onSubmit = (values) => {
    setPaperInfo(toPaperInfo(values));
    editor();
  };

  const onOpenFileSelector = () => {
    setSaveMethod((val) => setValue("notebookFile", val));
    openSelector();
  };

  const pId = {
    get: (index) => {
      return {
        firstName: `PIs.${index}.firstName`,
        middleName: `PIs.${index}.middleName`,
        lastName: `PIs.${index}.lastName`,
      };
    },
  };

  return (
    <Drawer heading="Qresp Curation Information" defaultOpen={true}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid container direction="column" spacing={1}>
          <Grid>
            <Grid
              container
              justifyContent="flex-start"
              alignItems="center"
              spacing={1}
            >
              <Grid>
                <FormInputLabel label="Principal Investigators" forId="pis" />
              </Grid>
              <Grid>
                <Tooltip
                  title={
                    <Typography variant="subtitle2">
                      Add a principle investigator
                    </Typography>
                  }
                  placement="right"
                  arrow
                >
                  <IconButton
                    onClick={() =>
                      append({
                        firstName: "",
                        middleName: "",
                        lastName: "",
                      })
                    }
                    style={{ padding: 0 }}
                  >
                    <AddCircleOutlined color="primary" />
                  </IconButton>
                </Tooltip>
              </Grid>
            </Grid>
            {/* Column container restores vertical gutters between PI
                rows (MUI v9 grids no longer pad plain nested items),
                keeping shrunk labels clear of the row above. */}
            <Grid container direction="column" spacing={2} sx={{ mt: 0.5 }}>
              {fields.map((pi, index) => {
              return (
                <Grid key={index}>
                  <NameInput
                    ids={pId.get(index)}
                    names={pId.get(index)}
                    key={index}
                    id={`pi${index}`}
                    register={register}
                    errors={errors.PIs && errors.PIs[index]}
                    defaults={formattedNames[index]}
                    remove={
                      <Tooltip
                        title={
                          <Typography variant="subtitle2">
                            {fields.length == 1
                              ? "Required (minimum one P.I.)"
                              : "Remove principle investigator"}
                          </Typography>
                        }
                        placement="right"
                        arrow
                      >
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (fields.length > 1) {
                              remove(index);
                            }
                          }}
                          style={{ padding: 0 }}
                        >
                          <RemoveCircleOutlined
                            color={fields.length == 1 ? "disabled" : "primary"}
                          />
                        </IconButton>
                      </Tooltip>
                    }
                  />
                </Grid>
              );
            })}
            </Grid>
          </Grid>
          <Grid>
            <TextInputField
              id="paperstack"
              placeholder="Enter collection to which project belongs to"
              name="collections"
              helperText="Enter names(s) defining group of papers (eg. according to the source of fundings)"
              label="PaperStack"
              required
              register={register}
              error={errors.collections}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="tags"
              placeholder="Ener tags for the project"
              name="tags"
              helperText="Enter keywords(s) (e.g. DFT, oragnic materials, charge transfer)"
              label="Keywords"
              required
              register={register}
              error={errors.tags}
            />
            {/* Suggestions only, and they APPEND: what the curator already
                typed is never replaced, and applying does not save the
                section. */}
            <KeywordAssist
              onApply={(keywords) => {
                const current = splitList(getValues("tags"));
                const existing = current.map((tag) => tag.toLowerCase());
                const fresh = [];
                keywords.forEach((keyword) => {
                  const key = keyword.toLowerCase();
                  if (existing.includes(key)) return;
                  existing.push(key);
                  fresh.push(keyword);
                });
                setValue("tags", [...current, ...fresh].join(", "));
              }}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="mainNotebookFile"
              placeholder="Enter main notebook filename"
              name="notebookFile"
              helperText="Enter name of a notebook file, thid file may serve as a table of contents and may contain links to all datasets, charts, scripts, tools and documentation. Use the file picker button to fill this field. "
              label="Main Notebook File"
              action={
                <IconButton size="small" onClick={onOpenFileSelector}>
                  <DescriptionOutlined color="primary" />
                </IconButton>
              }
              register={register}
              error={errors.notebookFile}
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

PaperInfoForm.propTypes = {
  editor: PropTypes.func.isRequired,
};

export default PaperInfoForm;
