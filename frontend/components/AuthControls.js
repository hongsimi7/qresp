import { Fragment, useContext, useState } from "react";

import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";

import AuthContext from "../Context/Auth/authContext";

// Minimal header auth widget. The sign-in here is the DEVELOPMENT/staging
// dev-login (explicitly labelled as such, no Google branding/scopes); it will
// be swapped for Google sign-in in a later phase.
const AuthControls = () => {
  const { loading, authenticated, user, devLogin, logout } =
    useContext(AuthContext);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState("");

  if (loading) return null;

  const submit = async () => {
    if (!email.trim()) {
      setMessage("Please enter an email address.");
      return;
    }
    const result = await devLogin(email, name, isAdmin);
    if (result.ok) {
      setOpen(false);
      setMessage("");
    } else {
      setMessage(result.error);
    }
  };

  if (authenticated) {
    return (
      <Fragment>
        <Typography
          variant="body2"
          sx={{ color: "#FFF", alignSelf: "center", mx: 1 }}
        >
          {user.name || user.email}
          {user.is_admin ? " (admin)" : ""}
        </Typography>
        <Button color="inherit" sx={{ color: "#FFF" }} onClick={logout}>
          Sign out
        </Button>
      </Fragment>
    );
  }

  return (
    <Fragment>
      {/* Full-page navigation: the backend redirects to Google and back;
          on return the app remounts and AuthState refetches /api/auth/me. */}
      <Button
        color="inherit"
        sx={{ color: "#FFF" }}
        component="a"
        href="/api/auth/google"
      >
        Sign in with Google
      </Button>
      <Button
        color="inherit"
        sx={{ color: "#FFF" }}
        onClick={() => setOpen(true)}
      >
        Dev sign in
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Development sign in</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="secondary" gutterBottom>
            Staging/development only — not the production login.
          </Typography>
          <TextField
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            margin="dense"
            variant="outlined"
          />
          <TextField
            label="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            margin="dense"
            variant="outlined"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
              />
            }
            label="Admin (dev only)"
          />
          {message ? (
            <Typography variant="body2" color="error">
              {message}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} variant="contained">
            Sign in
          </Button>
        </DialogActions>
      </Dialog>
    </Fragment>
  );
};

export default AuthControls;
