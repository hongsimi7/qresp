import { Fragment, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useRouter } from "next/router";

import AuthContext from "../../Context/Auth/authContext";

// Backend-driven edit-permission indicator + minimal owner/admin edit flow.
// The decision comes from GET /api/paper/{id}/permissions (never
// frontend-only logic); the MVP editor covers a single harmless field (tags)
// through PUT /api/paper/{id} — the curator-integrated editor comes later.
const PermissionNotice = ({ paperId, tags }) => {
  const { authenticated, loading } = useContext(AuthContext);
  const [permissions, setPermissions] = useState(null);
  const [open, setOpen] = useState(false);
  const [tagsText, setTagsText] = useState((tags || []).join(", "));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const router = useRouter();

  useEffect(() => {
    if (!paperId || loading) return;
    let cancelled = false;
    axios
      .get(`/api/paper/${encodeURIComponent(paperId)}/permissions`)
      .then((res) => {
        if (!cancelled) setPermissions(res.data);
      })
      .catch(() => {
        // Previews/unknown ids or older backends: show nothing.
        if (!cancelled) setPermissions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [paperId, authenticated, loading]);

  if (!permissions) return null;

  const save = async () => {
    setSaving(true);
    setMessage("");
    const newTags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    try {
      await axios.put(`/api/paper/${encodeURIComponent(paperId)}`, {
        tags: newTags,
      });
      setOpen(false);
      // Reload so getServerSideProps refetches the updated record.
      router.reload();
    } catch (err) {
      const res = err.response;
      if (res && (res.status === 401 || res.status === 403)) {
        setMessage(
          (res.data && res.data.error) ||
            "You are not allowed to edit this record."
        );
      } else {
        setMessage("Saving failed, please try again later.");
      }
    }
    setSaving(false);
  };

  let text;
  if (permissions.can_edit) {
    text = `You can edit this record (${permissions.reason})`;
  } else if (!permissions.authenticated) {
    text = "Sign in to edit this record";
  } else {
    text = "Only the record owner or an admin can edit this record";
  }

  return (
    <Box sx={{ mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="subtitle2" color="secondary">
        {text}
      </Typography>
      {permissions.can_edit ? (
        <Fragment>
          <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
            Edit metadata
          </Button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            fullWidth
            maxWidth="sm"
          >
            <DialogTitle>Edit record metadata</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="secondary" gutterBottom>
                Minimal edit (MVP): record tags, comma separated. The full
                curator-based editor arrives in a later phase.
              </Typography>
              <TextField
                label="Tags"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                fullWidth
                margin="dense"
                variant="outlined"
              />
              {message ? (
                <Typography variant="body2" color="error">
                  {message}
                </Typography>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} variant="contained" disabled={saving}>
                Save
              </Button>
            </DialogActions>
          </Dialog>
        </Fragment>
      ) : null}
    </Box>
  );
};

PermissionNotice.propTypes = {
  paperId: PropTypes.string,
  tags: PropTypes.array,
};

export default PermissionNotice;
