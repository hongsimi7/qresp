import { useState } from "react";
import PropTypes from "prop-types";

import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
  IconButton,
  Tooltip,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { ExpandMore, Edit } from "@mui/icons-material";

const StyledAccordion = styled(Accordion)({
  borderRadius: "0.5em",
  margin: "8px 0 !important",
  "&::before": {
    backgroundColor: "rgba(0,0,0,0.03)",
  },
});

const StyledAccordionSummary = styled(AccordionSummary)({
  backgroundColor: "rgba(0,0,0,.03)",
});

const Drawer = (props) => {
  const { heading, children, defaultOpen = false, editor } = props;

  const [open, setOpen] = useState(defaultOpen ? true : false);

  return (
    <StyledAccordion
      elevation={4}
      square={true}
      slotProps={{ transition: { timeout: 200 } }}
      id={heading.toLowerCase()}
      expanded={open}
      onChange={(event, expanded) => {
        setOpen(expanded);
      }}
    >
      <StyledAccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="h4" style={{ color: "#333333" }}>
          <Box sx={{ fontWeight: "bold" }}>
            {heading}
            {editor ? (
              <Tooltip
                title={<Typography variant="subtitle2">Edit</Typography>}
                placement="right"
                arrow
              >
                <IconButton onClick={editor}>
                  <Edit color="primary" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        </Typography>
      </StyledAccordionSummary>
      <AccordionDetails>
        <Box style={{ width: "100%" }} sx={{ display: "flex", flexDirection: "column" }}>
          {children}
        </Box>
      </AccordionDetails>
    </StyledAccordion>
  );
};

export { StyledAccordion, StyledAccordionSummary };

Drawer.propTypes = {
  heading: PropTypes.string.isRequired,
  children: PropTypes.any,
  defaultOpen: PropTypes.bool,
  editor: PropTypes.func,
};

export default Drawer;
