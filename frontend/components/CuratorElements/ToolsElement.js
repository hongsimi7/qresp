import { useContext } from "react";

import ToolsInfoForm from "../CuratorForms/ToolsInfoForm";
import ToolsInfo from "../Paper/Tools";
import { EditAndRemove } from "../Form/Util";

import CuratorContext from "../../Context/Curator/curatorContext";
import Drawer from "../drawer";
import ArtifactActionBar from "./ArtifactActionBar";

import { Typography } from "@mui/material";

const ToolsInfoElement = () => {
  const { tools } = useContext(CuratorContext);

  return (
    <Drawer heading="Add Tools from your paper" defaultOpen={true}>
      <ArtifactActionBar artifactType="tool">
        <ToolsInfoForm />
      </ArtifactActionBar>
      {tools.length > 0 ? (
        <ToolsInfo
          tools={tools}
          inDrawer={false}
          editColumn={[
            {
              label: "Edit/Remove",
              name: "details",
              view: EditAndRemove,
              options: {
                align: "center",
                sort: false,
                searchable: false,
                value: null,
              },
            },
          ]}
        />
      ) : (
        <Typography
          align="center"
          variant="overline"
          style={{ marginTop: "8px" }}
        >
          No tools added yet
        </Typography>
      )}
    </Drawer>
  );
};

export default ToolsInfoElement;
