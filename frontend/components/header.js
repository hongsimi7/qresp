import { useState, Fragment } from "react";
import {
  AppBar,
  Toolbar,
  Box,
  Container,
  Button,
  Drawer,
} from "@mui/material";
import { styled } from "@mui/material/styles";

import { Menu } from "@mui/icons-material";

import StyledButton, {
  InternalStyledButton,
  ExternalStyledButton,
} from "./button";

import Picture from "./picture";

import Link from "next/link";

// Defined at module scope (not per-render) with the paper slot styled via its
// global class, since withStyles' classes map is gone in MUI v5+.
const StyledDrawer = styled(Drawer)({
  "& .MuiDrawer-paper": {
    backgroundColor: "#800000",
  },
});

const Header = () => {
  const [drawer, setDrawer] = useState(false);

  const handleOpen = () => {
    setDrawer(true);
  };

  const toggleDrawer = (event) => {
    if (
      event &&
      event.type === "keydown" &&
      (event.key === "Tab" || event.key === "Shift")
    ) {
      return;
    }
    setDrawer(!drawer);
  };

  const links = (
    <Fragment>
      <InternalStyledButton text="Explorer" url="/explorer" />
      <InternalStyledButton text="Curator" url="/curator" />
      <ExternalStyledButton
        text="Documentation"
        url="https://qresp.org"
        external={true}
      />
      <ExternalStyledButton
        text="Contact"
        url="mailto:datadev@lists.uchicago.edu?subject=Qresp"
        external={true}
      />
      {/* <InternalStyledButton text="LogIn" url="/login" /> */}
    </Fragment>
  );

  return (
    <AppBar position="sticky" color="primary" elevation={0}>
      <Toolbar>
        <Container>
          <Box sx={{ display: "flex", flexDirection: "row", flexGrow: 1, alignItems: "center", m: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", flexGrow: 1 }}>
              <Button component={Link} href="/">
                <Picture
                  imgSrc="/images/qrespLogo"
                  imgAlt="Qresp Logo"
                  height="64px"
                />
              </Button>
            </Box>
            <Box sx={{ display: "flex" }}>
              {/* MUI v6+ removed <Hidden>; use responsive display instead. */}
              <Box sx={{ display: { xs: "none", md: "flex" } }}>{links}</Box>
              <Box sx={{ display: { xs: "flex", md: "none" } }}>
                <StyledButton onClick={handleOpen}>
                  <Menu />
                </StyledButton>
              </Box>
            </Box>
          </Box>
        </Container>
      </Toolbar>
      <StyledDrawer anchor="top" open={drawer} onClose={toggleDrawer}>
        <Box onClick={toggleDrawer} sx={{ display: "flex", flexDirection: "column" }}>
          {links}
        </Box>
      </StyledDrawer>
    </AppBar>
  );
};

export default Header;
