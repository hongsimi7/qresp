import { Fragment, useCallback, useContext, useEffect, useState } from "react";
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
import Link from "next/link";

import AuthContext from "../../Context/Auth/authContext";

// Backend-driven edit-permission indicator. The decision comes from
// GET /api/paper/{id}/permissions (never frontend-only logic). Editing goes
// through the curator in edit mode — one single edit path; the backend gates
// /raw and PUT the same way, so this link grants nothing by itself.
// Admins additionally get a minimal "Assign owner" dialog on OWNERLESS
// legacy records (PUT /api/paper/{id}/owner is admin-gated server-side).
const PermissionNotice = ({ paperId, server }) => {
  const { authenticated, loading } = useContext(AuthContext);
  const [permissions, setPermissions] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignEmail, setAssignEmail] = useState("");
  const [assignMessage, setAssignMessage] = useState("");
  const [assigning, setAssigning] = useState(false);

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await axios.get(
        `/api/paper/${encodeURIComponent(paperId)}/permissions`
      );
      setPermissions(res.data);
    } catch (err) {
      // Previews/unknown ids or older backends: show nothing.
      setPermissions(null);
    }
  }, [paperId]);

  useEffect(() => {
    if (!paperId || loading) return undefined;
    let cancelled = false;
    fetchPermissions().then(() => {
      if (cancelled) return undefined;
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [paperId, authenticated, loading, fetchPermissions]);

  if (!permissions) return null;

  const assignOwner = async () => {
    setAssigning(true);
    setAssignMessage("");
    try {
      await axios.put(`/api/paper/${encodeURIComponent(paperId)}/owner`, {
        owner_email: assignEmail,
      });
      setAssignOpen(false);
      setAssignEmail("");
      await fetchPermissions();
    } catch (err) {
      const res = err.response;
      setAssignMessage(
        (res && res.data && res.data.error) ||
          "Assigning the owner failed, please try again."
      );
    }
    setAssigning(false);
  };

  let text;
  if (permissions.can_edit) {
    text = `You can edit this record (${permissions.reason})`;
  } else if (!permissions.authenticated) {
    text = "Sign in to edit this record";
  } else {
    text = "Only the record owner or an admin can edit this record";
  }

  const showAssignOwner = permissions.is_admin && !permissions.owner_email;

  return (
    <Box sx={{ mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="subtitle2" color="secondary">
        {text}
      </Typography>
      {permissions.can_edit ? (
        <Button
          size="small"
          variant="outlined"
          component={Link}
          href={`/curator?edit=${encodeURIComponent(
            paperId
          )}&server=${encodeURIComponent(server || "")}`}
        >
          Edit in Curator
        </Button>
      ) : null}
      {showAssignOwner ? (
        <Fragment>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setAssignOpen(true)}
          >
            Assign owner
          </Button>
          <Dialog
            open={assignOpen}
            onClose={() => setAssignOpen(false)}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>Assign record owner</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="secondary" gutterBottom>
                This legacy record has no verified owner yet. The assigned
                account becomes able to edit it.
              </Typography>
              <TextField
                label="Owner email"
                value={assignEmail}
                onChange={(e) => setAssignEmail(e.target.value)}
                fullWidth
                margin="dense"
                variant="outlined"
              />
              {assignMessage ? (
                <Typography variant="body2" color="error">
                  {assignMessage}
                </Typography>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button
                onClick={assignOwner}
                variant="contained"
                disabled={assigning}
              >
                Assign
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
  server: PropTypes.string,
};

export default PermissionNotice;
