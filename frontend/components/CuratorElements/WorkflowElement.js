import { useContext } from "react";

import { Box, Typography } from "@mui/material";

import Drawer from "../drawer";
import WorkflowLanes from "./WorkflowLanes";
import { rowLabel } from "./FigureWorkspace";
import CuratorContext from "../../Context/Curator/curatorContext";
import { componentsOf } from "../../Utils/workflowGraph";

// THE WORKFLOW, READ ONLY.
//
// This used to be a second editor: Add an External Node, Rearrange, Hide
// Labels, drag-to-move, its own Save. Two editors for one graph meant two
// places to learn, two sets of rules to keep in step, and a "Save" here that
// meant something different from the Save at the bottom of the page.
//
// "Organize figures and resources" is the one place connections are made.
// This is a picture of what that produced, and it changes as soon as it
// does. There is nothing to press.

const WorkflowInfoElement = () => {
  const { charts, scripts, datasets, tools, heads, workflow } =
    useContext(CuratorContext);

  const byId = {};
  [charts, scripts, datasets, tools, heads].forEach((list) =>
    (list || []).forEach((item) => {
      if (item && item.id) byId[item.id] = item;
    })
  );
  const knownIds = Object.keys(byId);
  const edges = (workflow && workflow.edges) || [];
  const { connected } = componentsOf(knownIds, edges);

  return (
    <Drawer heading="Build your workflow" defaultOpen={true}>
      {connected.length ? (
        <Box data-testid="wf-preview">
          {connected.map((members) => (
            <Box key={members[0]} sx={{ mb: 1.5 }}>
              <WorkflowLanes
                ids={members}
                edges={edges}
                name={(id) => rowLabel(byId[id], id)}
              />
            </Box>
          ))}
        </Box>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="wf-preview-empty"
        >
          Nothing is connected yet. Link resources in “Organize figures and
          resources” above and the workflow appears here.
        </Typography>
      )}
    </Drawer>
  );
};

export default WorkflowInfoElement;
