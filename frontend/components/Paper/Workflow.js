import PropTypes from "prop-types";

import useMediaQuery from "@mui/material/useMediaQuery";

import Drawer from "../drawer";
import Graph from "../Workflow/Graph";
import Legend from "../Workflow/Legend";
import { formatData, formatWorkflow } from "../Workflow/util";
import WorkflowSummary from "./WorkflowSummary";

import { Box, Grid, useTheme } from "@mui/material";

const Workflow = ({ workflow, charts, tools, scripts, datasets, external }) => {
  const theme = useTheme();
  const direction = useMediaQuery(theme.breakpoints.down("sm"))
    ? "row"
    : "column";

  const data = formatData(charts, tools, external, datasets, scripts);

  return (
    <Drawer heading="Workflow">
      {/* The workflow in words, first. The graph below is a picture -- good
          for seeing shape, poor to read on a phone and impossible with a
          screen reader -- so the same thing is said as a short list, which
          is what most readers of a published record actually want. */}
      <WorkflowSummary
        workflow={workflow}
        charts={charts}
        datasets={datasets}
        scripts={scripts}
        tools={tools}
        external={external}
      />
      <Box sx={{ mt: 1 }}>
        <Grid container direction="row">
          <Grid size={{ xs: 12, md: 10 }}>
            <Graph workflow={workflow} data={data} />
          </Grid>
          <Grid size={{ xs: 12, md: 2 }}>
            <Legend direction={direction} />
          </Grid>
        </Grid>
      </Box>
    </Drawer>
  );
};

Workflow.propTypes = {
  workflow: PropTypes.object.isRequired,
  charts: PropTypes.array.isRequired,
  tools: PropTypes.array.isRequired,
  scripts: PropTypes.array.isRequired,
  datasets: PropTypes.array.isRequired,
  external: PropTypes.array.isRequired,
};

export default Workflow;
