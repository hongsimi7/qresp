import { useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import { Typography, Box } from "@mui/material";

import AuthContext from "../../Context/Auth/authContext";

// Small backend-driven edit-permission indicator for a record. The decision
// comes from GET /api/paper/{id}/permissions (never frontend-only logic);
// there is no update API yet, so this renders a notice, not an edit form.
const PermissionNotice = ({ paperId }) => {
  const { authenticated, loading } = useContext(AuthContext);
  const [permissions, setPermissions] = useState(null);

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

  let text;
  if (permissions.can_edit) {
    text = "You can edit this record";
  } else if (!permissions.authenticated) {
    text = "Sign in to edit this record";
  } else {
    text = "Only the record owner or an admin can edit this record";
  }

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="subtitle2" color="secondary">
        {text}
        {permissions.can_edit ? ` (${permissions.reason})` : ""}
      </Typography>
    </Box>
  );
};

PermissionNotice.propTypes = {
  paperId: PropTypes.string,
};

export default PermissionNotice;
