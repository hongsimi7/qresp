import { useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import { Box, Button, Typography } from "@mui/material";
import Link from "next/link";

import AuthContext from "../../Context/Auth/authContext";

// Backend-driven edit-permission indicator. The decision comes from
// GET /api/paper/{id}/permissions (never frontend-only logic). Editing goes
// through the curator in edit mode — one single edit path; the backend gates
// /raw and PUT the same way, so this link grants nothing by itself.
const PermissionNotice = ({ paperId, server }) => {
  const { authenticated, loading } = useContext(AuthContext);
  const [permissions, setPermissions] = useState(null);

  useEffect(() => {
    if (!paperId || loading) return undefined;
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
    </Box>
  );
};

PermissionNotice.propTypes = {
  paperId: PropTypes.string,
  server: PropTypes.string,
};

export default PermissionNotice;
