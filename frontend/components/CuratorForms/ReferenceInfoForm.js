import { useEffect, useContext } from "react";
import PropTypes from "prop-types";

import { Grid, Tooltip, Typography, IconButton } from "@mui/material";
import { AddCircleOutlined, RemoveCircleOutlined } from "@mui/icons-material";

import { RegularStyledButton } from "../button";
import { TextInputField, RadioInputField } from "../Form/InputFields";
import { SubmitAndReset, FormInputLabel } from "../Form/Util";
import { namesUtil, referenceUtil } from "../../Utils/utils";
import { doiUtil, DOI_PATTERN } from "../../Utils/doi";
import NameInput from "../Form//NameInput";
import Drawer from "../drawer";

import { useForm, useFieldArray } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from "yup";

import CuratorContext from "../../Context/Curator/curatorContext";
import AlertContext from "../../Context/Alert/alertContext";
import LoadingContext from "../../Context/Loading/loadingContext";
import PaperImport from "../CuratorElements/PaperImport";
import PublicationAssist from "../CuratorElements/PublicationAssist";

const ReferenceInfoForm = ({ editor }) => {
  const { referenceInfo, setReferenceInfo, registerDraftFlusher,
          reportLiveBiblio, sourceFile } = useContext(CuratorContext);
  const { setAlert } = useContext(AlertContext);
  const { showLoader, hideLoader } = useContext(LoadingContext);

  const schema = Yup.object({
    kind: Yup.string().required("Required"),
    // Optional field. Accepted DOI shapes (bare, `doi:`-labelled, or a
    // doi.org/dx.doi.org resolver URL) are normalized to the bare DOI BEFORE
    // the format check, so a pasted resolver URL is no longer rejected; an
    // empty value (registered via defaultValues below) skips the check, and
    // non-DOI input still fails it.
    doi: Yup.string()
      .transform((value, original) => {
        const normalized = doiUtil.normalize(original);
        return normalized === "" ? undefined : normalized;
      })
      .matches(DOI_PATTERN, "Please enter a valid DOI"),
    authors: Yup.array()
      .of(
        Yup.object().shape({
          firstName: Yup.string().required("Required"),
          middleName: Yup.string(),
          lastName: Yup.string().required("Required"),
        })
      )
      .required("Required")
      .min(1, "Minimum of 1 PrincipalInvestigator"),
    title: Yup.string().required("Required"),
    // Journal Name is required only for a journal article. A preprint or a
    // dissertation has no journal, and requiring one here blocked those
    // records at a field they can never legitimately fill. This mirrors the
    // publish schema exactly (backend/project/schema.json) — the two layers
    // have to agree, or the form calls a record complete and publish rejects
    // it.
    journal: Yup.string().when("kind", {
      is: "journal",
      then: (s) => s.required("Required for a journal article"),
      otherwise: (s) => s,
    }),
    // Optional for every kind: an article number, an accepted-but-unpaginated
    // paper, a preprint and a dissertation all legitimately lack these.
    page: Yup.string(),
    abstract: Yup.string().required("Required"),
    volume: Yup.number()
      .transform((value, original) =>
        original === "" || original === null ? undefined : value
      )
      .min(1, "Minimum volume number is 1")
      .notRequired(),
    year: Yup.number()
      .min(1750, "Cannot be less than 1700")
      .integer("Plese enter a valid year")
      .required("Required"),
    url: Yup.string()
      .transform((value, original) => (original === "" ? undefined : value))
      .url("Please enter a valid url"),
  });

  // react-hook-form v7 only knows values listed here or touched by the
  // user; visually prefilled inputs (defaultValue attrs, RadioGroup
  // selection) are NOT registered. Without kind/title/doi/url/abstract in
  // defaultValues, saving an untouched prefilled reference failed its
  // required checks.
  const defaults = {
    authors: namesUtil.get(referenceInfo.authors),
    ...referenceUtil.get(referenceInfo.publication),
    kind: referenceInfo.kind || "",
    title: referenceInfo.title || "",
    doi: referenceInfo.doi || "",
    url: referenceInfo.url || "",
    abstract: referenceInfo.abstract || "",
  };

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    watch,
    formState,
  } = useForm({
    resolver: yupResolver(schema),
    defaultValues: {
      ...defaults,
    },
  });

  // Signal the CURRENTLY TYPED title/abstract (before Save) so features like
  // "Suggest Keywords with AI" can enable immediately. Signal only — saving
  // still happens exclusively through this form's Save button, and snapshots
  // still come from the registered draft flusher below.
  const watchedTitle = watch("title");
  const watchedAbstract = watch("abstract");
  useEffect(() => {
    if (!reportLiveBiblio) return;
    reportLiveBiblio({ title: watchedTitle, abstract: watchedAbstract });
  }, [watchedTitle, watchedAbstract, reportLiveBiblio]);
  // react-hook-form v7: errors moved onto formState.
  const { errors } = formState;

  // Which fields are required depends on what kind of work this is, so the
  // asterisks have to follow the selected kind rather than be painted on
  // every bibliographic field.
  const kind = watch("kind");
  const journalRequired = kind === "journal";

  const { fields, append, remove } = useFieldArray({
    control,
    name: "authors",
  });

  const fetchFromDOI = (event) => {
    // This action only fills the open form. Without an explicit button type,
    // a click inside the form follows the Save submit path and closes it.
    event?.preventDefault();
    event?.stopPropagation();
    // Resolve whatever shape was pasted down to the bare DOI first: the
    // registry is queried with it, and the field is rewritten to it so what
    // the curator sees matches what will be saved.
    const normalizedDoi = doiUtil.normalize(getValues("doi"));
    if (!DOI_PATTERN.test(normalizedDoi)) {
      setAlert("Error", "Please enter a valid doi", null);
      return;
    }
    setValue("doi", normalizedDoi);
    showLoader();
    doiUtil
      .get(normalizedDoi)
      .then((res) => doiUtil.set(res, setValue))
      .catch((err) => {
        console.error(err);
        setAlert(
          "Error",
          "There was an error getting data usig the doi, please contact the admin if problems persist",
          null
        );
      })
      .finally(() => hideLoader());
  };

  const toReferenceInfo = (values) => {
    const hasPublication = ["journal", "year", "volume", "page"].some((key) =>
      String(values[key] || "").trim()
    );
    return {
      authors: namesUtil.set(values.authors || []),
      publication: hasPublication
        ? referenceUtil.set({
            journal: values.journal || "",
            year: values.year || "",
            volume: values.volume || "",
            page: values.page || "",
          })
        : "",
      // Store ONE normalized bare DOI regardless of the shape pasted.
      doi: doiUtil.normalize(values.doi),
      kind: values.kind,
      title: values.title,
      year: values.year,
      url: values.url,
      abstract: values.abstract,
    };
  };

  useEffect(() => {
    if (!registerDraftFlusher) return undefined;
    return registerDraftFlusher("referenceInfo", () => ({
      referenceInfo: {
        ...referenceInfo,
        ...toReferenceInfo(getValues()),
      },
    }));
  }, [getValues, referenceInfo, registerDraftFlusher]);

  const onSubmit = (values) => {
    setReferenceInfo(toReferenceInfo(values));
    editor();
  };

  const nameid = {
    get: (index) => {
      return {
        firstName: `authors.${index}.firstName`,
        middleName: `authors.${index}.middleName`,
        lastName: `authors.${index}.lastName`,
      };
    },
  };

  const radioOptions = [
    { label: "Preprint", value: "preprint" },
    { label: "Journal", value: "journal" },
    { label: "Dissertation", value: "dissertation" },
  ];

  useEffect(() => {
    const newNames = namesUtil.get(referenceInfo.authors);
    if (!("author" in formState.dirtyFields || "author" in formState.touchedFields))
      setValue("authors", newNames);
  }, [referenceInfo.authors]);

  return (
    <Drawer heading="Publication Information for This Paper" defaultOpen={true}>
      {/* This section IS the primary paper's bibliography (the record's
          `reference` block) — including DOI fetch and manuscript-source
          import. It is not a cited-works list. */}
      <PaperImport />
      {/* Bibliography only. Keyword assistance stays in Qresp Curation
          Information; Fetch DOI stays the preferred deterministic action and
          this fills what is still missing after it. */}
      <PublicationAssist
        reference={referenceInfo}
        sourceText={(sourceFile && sourceFile.extractedText) || ""}
        sourceFilename={(sourceFile && sourceFile.name) || ""}
      />
      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid container direction="column" spacing={1}>
          <Grid>
            <RadioInputField
              id="kind"
              name="kind"
              label="Kind"
              helperText="Select Preprint, Dissertation or Journal"
              error={errors.kind}
              required={true}
              options={radioOptions}
              row={true}
              control={control}
              defVal={referenceInfo.kind}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="doi"
              placeholder="Enter doi of the paper"
              name="doi"
              helperText="Enter DOI of the paper (e.g. 10.201/jacs.23wbn) if published"
              label="DOI"
              defaultValue={referenceInfo.doi}
              action={
                <Tooltip
                  title={
                    <Typography variant="subtitle2">
                      Get values for the fields below using the DOI
                    </Typography>
                  }
                  placement="right"
                  arrow
                >
                  <RegularStyledButton
                    type="button"
                    size="small"
                    style={{ padding: "2px", margin: "4px" }}
                    onClick={fetchFromDOI}
                  >
                    Fetch
                  </RegularStyledButton>
                </Tooltip>
              }
              register={register}
              error={errors.doi}
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
                <FormInputLabel label="Authors" forId="authors" />
              </Grid>
              <Grid>
                <Tooltip
                  title={
                    <Typography variant="subtitle2">Add an author</Typography>
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
            {/* Column container restores vertical gutters between author
                rows (MUI v9 grids no longer pad plain nested items). */}
            <Grid container direction="column" spacing={2} sx={{ mt: 0.5 }}>
              {fields.map((el, index) => {
              return (
                <Grid key={el.id}>
                  <NameInput
                    ids={nameid.get(index)}
                    names={nameid.get(index)}
                    key={index}
                    id={`authors${index}`}
                    register={register}
                    errors={errors.authors && errors.authors[index]}
                    defaults={el}
                    remove={
                      <Tooltip
                        title={
                          <Typography variant="subtitle2">
                            {fields.length == 1
                              ? "Required (minimum one author)"
                              : "Remove author"}
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
              id="title"
              placeholder="Enter title"
              name="title"
              helperText="Enter title of the paper"
              label="Title"
              required
              register={register}
              error={errors.title}
              defaultValue={referenceInfo.title}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="journal"
              placeholder="Enter full journal name"
              name="journal"
              helperText={
                journalRequired
                  ? "Enter full journal name"
                  : "Enter full journal name (optional for this kind)"
              }
              label="Journal Name"
              register={register}
              error={errors.journal}
              defaultValue={defaults.journal}
              required={journalRequired}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="page"
              placeholder="Enter page number"
              name="page"
              helperText="Page or article number (optional)"
              label="Page"
              register={register}
              error={errors.page}
              defaultValue={defaults.page}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="abstract"
              placeholder="Enter abstract"
              name="abstract"
              helperText="Enter abstract"
              label="Abstract"
              register={register}
              error={errors.abstract}
              multiline
              rows={4}
              defaultValue={referenceInfo.abstract}
              required
            />
          </Grid>
          <Grid>
            <TextInputField
              id="volume"
              placeholder="Enter volume number"
              name="volume"
              helperText="Volume of the journal (optional)"
              label="Volume"
              register={register}
              error={errors.volume}
              defaultValue={defaults.volume}
            />
          </Grid>
          <Grid>
            <TextInputField
              id="year"
              placeholder="Enter year of publication"
              name="year"
              helperText="Enter year of publication"
              label="Year"
              register={register}
              error={errors.year}
              defaultValue={defaults.year}
              required
            />
          </Grid>
          <Grid>
            <TextInputField
              id="url"
              placeholder="Enter url"
              name="url"
              helperText="Enter paper url"
              label="URL"
              register={register}
              error={errors.url}
              defaultValue={referenceInfo.url}
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

export default ReferenceInfoForm;
