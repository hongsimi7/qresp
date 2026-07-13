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

import AuthControls from "./AuthControls";

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
      {/* Dev/staging session auth; Google sign-in replaces this later. */}
      <AuthControls />
    </Fragment>
  );

  return (
    <AppBar position="sticky" color="primary" elevation={0}>
      <Toolbar>
        {/* xl (not the default lg) so the full inline links row — nav plus
            the four sign-in controls — fits on one line where it is shown. */}
        <Container maxWidth="xl">
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
              {/* MUI v6+ removed <Hidden>; use responsive display instead.
                  With four anonymous sign-in options (institution, Microsoft,
                  Google, dev) the nowrap links row no longer fits in an
                  lg-capped container, so the inline row shows at xl+ (inside
                  an xl container, set above) and everything below that uses
                  the drawer, which stacks the links without wrapping. */}
              <Box
                sx={{
                  display: { xs: "none", xl: "flex" },
                  alignItems: "center",
                  flexWrap: "nowrap",
                }}
              >
                {links}
              </Box>
              <Box sx={{ display: { xs: "flex", xl: "none" } }}>
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
