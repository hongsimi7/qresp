import { Fragment, useContext } from "react";

import { Button, Typography } from "@mui/material";

import Link from "next/link";
import { useRouter } from "next/router";

import AuthContext from "../Context/Auth/authContext";
import { loginHref } from "../Utils/safeNext";

// Header auth widget. Anonymous visitors get ONE short entry point — the
// provider choice lives on /login, so the header stays readable at every
// width and no provider branding or staging-only login leaks into it.
const AuthControls = () => {
  const { loading, authenticated, user, logout } = useContext(AuthContext);

  const router = useRouter();

  if (loading) return null;

  if (authenticated) {
    return (
      <Fragment>
        {/* The signed-in name links to the account page. */}
        <Typography
          variant="body2"
          component={Link}
          href="/account"
          sx={{
            color: "#FFF",
            alignSelf: "center",
            mx: 1,
            maxWidth: { xs: 110, sm: 180 },
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textDecoration: "none",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          {user.name || user.email}
          {user.is_admin ? " (admin)" : ""}
        </Typography>
        <Button
          color="inherit"
          size="small"
          sx={{ color: "#FFF", whiteSpace: "nowrap" }}
          onClick={logout}
        >
          Sign out
        </Button>
      </Fragment>
    );
  }

  // A short, non-wrapping control that survives the narrowest header, and a
  // plain link so it works before hydration.
  return (
    <Button
      color="inherit"
      size="small"
      sx={{ color: "#FFF", whiteSpace: "nowrap", flexShrink: 0 }}
      component="a"
      href={loginHref((router && router.asPath) || "/")}
    >
      Sign in
    </Button>
  );
};

export default AuthControls;
