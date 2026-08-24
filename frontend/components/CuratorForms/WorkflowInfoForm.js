import { useEffect, useContext, useState, Fragment } from "react";

import {
  Box,
  Grid,
  useTheme,
  useMediaQuery,
  Dialog,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";

import { useForm } from "react-hook-form";

import Drawer from "../drawer";
import { RegularStyledButton } from "../button";
import { TextInputField } from "../Form/InputFields";

import Graph from "../Workflow/Graph";
import Legend from "../Workflow/Legend";
import { formatData } from "../Workflow/util";
import { isGraph } from "../../Utils/graph";
import { changedUrlProblem } from "../../Utils/externalData";

import AlertContext from "../../Context/Alert/alertContext";
import CuratorContext from "../../Context/Curator/curatorContext";
import CuratorHelperContext from "../../Context/CuratorHelpers/curatorHelperContext";

const WorkflowInfoForm = () => {
  const { setAlert, unsetAlert } = useContext(AlertContext);

  const {
    charts,
    tools,
    scripts,
    datasets,
    heads,
    workflow,
    addEdge,
    deleteEdge,
    add,
    edit,
    del,
    setEdges,
  } = useContext(CuratorContext);

  const {
    workflowHelper: { open, fit, showLabels },
    setExternalNodeFormOpen,
    setDefault,
    externalHelper,
    setShowLabels,
    setWorkflowFit,
    setWorkflowOnClick,
    setEditing,
    editing,
  } = useContext(CuratorHelperContext);

  // Which external record the dialog is editing, or null when creating one.
  const editingHead = (externalHelper && externalHelper.def) || null;

  const theme = useTheme();
  const direction = useMediaQuery(theme.breakpoints.down("sm"))
    ? "row"
    : "column";

  useEffect(() => {
    setWorkflowOnClick(false);
    setShowLabels(true);
    return () => {
      setWorkflowOnClick(true);
      setShowLabels(false);
    };
  }, []);

  useEffect(() => {
    setEditing("workflowInfo", true);
  }, [workflow]);

  const manipulate = {
    manipulation: {
      enabled: true,
      initiallyActive: true,
      addNode: false,
      addEdge: (data, callback) => {
        if (data.to == data.from) {
          setAlert(
            "Self Edge Alert",
            "You are adding a self edge, if you want to proceed click Go Ahead",
            <RegularStyledButton
              onClick={() => {
                unsetAlert();
                addEdge(data);
              }}
            >
              Go Ahead
            </RegularStyledButton>
          );
        } else addEdge(data);
        callback(null);
      },
      deleteNode: (data, callback) => {
        const { nodes, edges } = data;
        if (nodes && nodes.length > 0) {
          if (nodes[0].charAt(0) == "h") {
            setEdges(workflow.edges.filter((edge) => !edges.includes(edge.id)));
            del("head", nodes[0]);
          } else {
            setAlert(
              "Error",
              "Only external (red dots) nodes can be removed from here. In order to remove other nodes, please use the corresponding sections above.",
              null
            );
          }
        }
        callback(null);
      },
      deleteEdge: (data, callback) => {
        deleteEdge(data.edges[0]);
        callback(null);
      },
      editEdge: false,
      controlNodeStyle: {
        size: 8,
        color: "black",
        chosen: false,
      },
    },
    physics: false,
  };

  const data = formatData(charts, tools, heads, datasets, scripts);

  // Which external node the dialog is editing, or null when it is creating
  // one. `heads` stays the only model -- editing reuses the same record and
  // the same dialog rather than a second shape for "an external node that
  // already exists".

  const headDefaults = (head) => ({
    label: (head && head.label) || "",
    readme: (head && head.readme) || "",
    URLs: (head && (head.URLs || []).join(", ")) || "",
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: headDefaults(null) });

  // Re-seed on every open: this form outlives the dialog, and RHF only knows
  // values it was given or the user touched.
  useEffect(() => {
    if (open) reset(headDefaults(editingHead));
  }, [open, editingHead]);

  const openExternalNode = () => {
    setDefault("head", null);   // creating, not editing
    setExternalNodeFormOpen(true);
  };

  const closeExternalNode = () => {
    setDefault("head", null);
    setExternalNodeFormOpen(false);
  };

  const onSubmit = (values) => {
    const urls = String(values.URLs || "")
      .split(",")
      .map((el) => el.trim())
      .filter(Boolean);
    const previous = (editingHead && editingHead.URLs) || [];
    // HTTPS is required only for a URL that is NEW or CHANGED. A legacy
    // record may hold an http:// link or none at all, and refusing to let a
    // curator fix its LABEL because of a URL somebody else typed years ago
    // would make old records uneditable -- see `changedUrlProblem`.
    const problem = changedUrlProblem(urls, previous);
    if (problem) {
      setAlert("External data", problem, null);
      return;
    }
    const payload = {
      label: String(values.label || "").trim(),
      readme: values.readme,
      URLs: urls,
    };
    if (editingHead) {
      edit("head", { ...editingHead, ...payload });
    } else {
      add("head", { ...payload, id: `h${heads.length}` });
    }
    closeExternalNode();
    setWorkflowFit(!fit);
  };

  const onSaveInDialog = () => {
    unsetAlert();
    setEditing("workflowInfo", false);
  };

  const onSave = () => {
    if (editing.workflowInfo)
      if (!isGraph.connected(workflow))
        setAlert(
          "Warning: Disconnected Nodes",
          "There are some disconnected nodes in the graph, please click save here if you want to still save the workflow",
          <RegularStyledButton onClick={onSaveInDialog}>
            Save
          </RegularStyledButton>
        );
      else if (isGraph.cyclic(workflow))
        setAlert(
          "Warning: Cycles Detected",
          "Cycles detected in the workflow, please click save here if you want to still save the workflow",
          <RegularStyledButton onClick={onSaveInDialog}>
            Save
          </RegularStyledButton>
        );
      else {
        setEditing("workflowInfo", false);
      }
  };

  return (
    <Fragment>
      <Drawer heading="Build your workflow" defaultOpen={true}>
        {/* The ordinary path is "Organize figures and resources" above: the
            figure is the root and the connections are made for you. This is
            the picture of the result, and the place to draw a connection that
            section cannot express. Layout is presentation only, never saved.
            The board that used to live here moved into that section -- two
            button-driven editors side by side were two ways to do one thing. */}
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            A picture of the workflow you built above. Drag to rearrange, or
            draw an unusual connection. Positions are not saved.
          </Typography>
        </Box>
        <Grid container direction="row" spacing={1}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <RegularStyledButton
              onClick={() => openExternalNode()}
              fullWidth
            >
              Add an External Node
            </RegularStyledButton>
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <RegularStyledButton
              fullWidth
              onClick={() => {
                setWorkflowFit(!fit);
              }}
            >
              Rearrange
            </RegularStyledButton>{" "}
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <RegularStyledButton
              fullWidth
              onClick={() => setShowLabels(!showLabels)}
            >
              {showLabels ? "Hide" : "Show"} Labels
            </RegularStyledButton>{" "}
          </Grid>
        </Grid>

        <Box sx={{ mt: 1 }}>
          <Grid container direction="row">
            <Grid size={{ xs: 12, md: 10 }}>
              <Graph workflow={workflow} data={data} manipulate={manipulate} />
            </Grid>
            <Grid size={{ xs: 12, md: 2 }}>
              <Legend direction={direction} />
            </Grid>
          </Grid>
        </Box>
        <Box sx={{ my: 1 }}>
          <RegularStyledButton onClick={onSave} fullWidth>
            Save
          </RegularStyledButton>
        </Box>
      </Drawer>
      <Dialog open={open} onClose={closeExternalNode}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            <Typography variant="h6" component="div">
              {editingHead ? "Edit External Data" : "Add an External Node"}
            </Typography>
          </DialogTitle>
          <DialogContent dividers>
            <Grid container direction="column" spacing={1}>
              <Grid>
                {/* A short name, so a graph can be read without expanding
                    every description. Optional: legacy records have none and
                    fall back to their note. */}
                <TextInputField
                  id="headLabel"
                  register={register}
                  error={errors && errors.label}
                  label="Label"
                  name="label"
                  placeholder="e.g. Materials Project mp-21276"
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="headDescription"
                  register={register} registerOptions={{ required: "Required" }}
                  error={errors && errors.description}
                  label="Description"
                  name="readme"
                  placeholder="Enter description of the external resource"
                  multiline
                  rows={3}
                />
              </Grid>
              <Grid>
                <TextInputField
                  id="headURLs"
                  register={register}
                  error={errors && errors.URLs}
                  label="URLs"
                  name="URLs"
                  placeholder="https://… (optional)"
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <RegularStyledButton type="submit" fullWidth>
              Save
            </RegularStyledButton>
            <RegularStyledButton
              onClick={closeExternalNode}
              fullWidth
            >
              Close
            </RegularStyledButton>
          </DialogActions>
        </form>
      </Dialog>
    </Fragment>
  );
};

export default WorkflowInfoForm;
