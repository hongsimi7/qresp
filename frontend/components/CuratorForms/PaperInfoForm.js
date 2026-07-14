import { useContext, useEffect } from "react";
import PropTypes from "prop-types";

import { Grid, Tooltip, Typography, IconButton } from "@mui/material";
import {
  AddCircleOutlined,
  RemoveCircleOutlined,
  DescriptionOutlined,
} from "@mui/icons-material";

import { namesUtil } from "../../Utils/utils";

import { RadioInputField, TextInputField } from "../Form/InputFields";
import { SubmitAndReset, FormInputLabel } from "../Form/Util";
import NameInput from "../Form//NameInput";
import Drawer from "../drawer";

import { useForm, useFieldArray } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from "yup";

import CuratorContext from "../../Context/Curator/curatorContext";
import SourceTreeContext from "../../Context/SourceTree/SourceTreeContext";
import PaperImport from "../CuratorElements/PaperImport";

const PaperInfoForm = ({ editor }) => {
  const {
    paperInfo,
    setPaperInfo,
    publicationInfo,
    setPublicationInfo,
    fileServerPath,
    registerDraftFlusher,
  } = useContext(CuratorContext);
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
    // The primary paper's bibliography may be arbitrarily incomplete while
    // drafting — publish validation is the completeness gate, not this form.
    publicationInfo: Yup.object(),
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
      publicationInfo: {
        ...publicationInfo,
        year: publicationInfo.year != null ? String(publicationInfo.year) : "",
      },
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
    const { publicationInfo: ignored, ...paperValues } = values;
    const next = {
      ...paperInfo,
      ...paperValues,
      collections: splitList(paperValues.collections),
      tags: splitList(paperValues.tags),
      PIs: namesUtil.set(paperValues.PIs || []),
    };
    if (next.notebookFile && next.notebookFile.length > 0) {
      next.notebookPath = fileServerPath + next.notebookFile;
    }
    return next;
  };

  const toPublicationInfo = (values) => {
    const pub = values.publicationInfo || {};
    const yearNumber = parseInt(pub.year, 10);
    return {
      ...publicationInfo,
      ...pub,
      year: Number.isNaN(yearNumber) ? null : yearNumber,
    };
  };

  useEffect(() => {
    if (!registerDraftFlusher) return undefined;
    return registerDraftFlusher("paperInfo", () => ({
      paperInfo: toPaperInfo(getValues()),
      publicationInfo: toPublicationInfo(getValues()),
    }));
  }, [getValues, registerDraftFlusher, toPaperInfo, toPublicationInfo]);

  const onSubmit = (values) => {
    // The primary paper's bibliography is owned by THIS section now; the
    // separate cited-work ("Add Reference to your paper") state is never
    // touched from here.
    setPaperInfo(toPaperInfo(values));
    setPublicationInfo(toPublicationInfo(values));
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
    <Drawer heading="Add info about your paper" defaultOpen={true}>
      {/* Primary-paper metadata import (DOI / manuscript source) belongs to
          THIS section; the separate "Add Reference to your paper" workflow
          is never its destination. */}
      <PaperImport />
      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid container direction="column" spacing={1}>
          {/* The PRIMARY paper's bibliographic fields (import target). The
              separate "Add Reference to your paper" section stays the
              cited-work editor and is unrelated to these. */}
          <Grid>
            <RadioInputField
              id="publicationKind"
              name="publicationInfo.kind"
              label="Kind"
              helperText="Preprint, Journal or Dissertation"
              options={[
                { label: "Preprint", value: "preprint" },
                { label: "Journal", value: "journal" },
                { label: "Dissertation", value: "dissertation" },
              ]}
              row={true}
              control={control}
              defVal={publicationInfo.kind}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="publicationTitle"
              placeholder="Enter the title of this paper"
              name="publicationInfo.title"
              helperText="Title of the paper being curated"
              label="Title"
              register={register}
              defaultValue={publicationInfo.title}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="publicationAuthors"
              placeholder="Enter authors, comma separated (e.g. Ada Lovelace, Charles Babbage)"
              name="publicationInfo.authors"
              helperText="Authors of the paper being curated"
              label="Authors"
              register={register}
              defaultValue={publicationInfo.authors}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="publicationDoi"
              placeholder="Enter DOI (e.g. 10.201/jacs.23wbn) if published"
              name="publicationInfo.doi"
              helperText="DOI of the paper being curated, if published"
              label="DOI"
              register={register}
              defaultValue={publicationInfo.doi}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="publicationVenue"
              placeholder="e.g. Journal of Chemical Physics 2016, 12 ,100-110"
              name="publicationInfo.publication"
              helperText="Publication venue as 'Journal YEAR, VOLUME ,PAGES'"
              label="Publication / Venue"
              register={register}
              defaultValue={publicationInfo.publication}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="publicationYear"
              placeholder="Enter publication year"
              name="publicationInfo.year"
              helperText="Year of publication"
              label="Year"
              register={register}
              defaultValue={
                publicationInfo.year != null ? String(publicationInfo.year) : ""
              }
            />
          </Grid>
          <Grid>
            <TextInputField
              id="publicationUrl"
              placeholder="Enter URL of the paper"
              name="publicationInfo.url"
              helperText="Link to the paper, if available"
              label="URL"
              register={register}
              defaultValue={publicationInfo.url}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="publicationAbstract"
              placeholder="Enter abstract"
              name="publicationInfo.abstract"
              helperText="Abstract of the paper being curated"
              label="Abstract"
              register={register}
              multiline
              rows={4}
              defaultValue={publicationInfo.abstract}
            />
          </Grid>
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
