import { Fragment, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import { Box, Typography } from "@mui/material";
import { useRouter } from "next/router";

import { RegularStyledButton } from "../button";
import {
  convertReqSchematoState,
  convertStateToUpdatePayload,
} from "../../Utils/model";
import { validate } from "./Publish";

import AuthContext from "../../Context/Auth/authContext";
import CuratorContext from "../../Context/Curator/curatorContext";
import CuratorHelperContext from "../../Context/CuratorHelpers/curatorHelperContext";
import ServerContext from "../../Context/Servers/serverContext";
import AlertContext from "../../Context/Alert/alertContext";
import LoadingContext from "../../Context/Loading/loadingContext";

// Owner/admin full-record editing through the EXISTING curator forms (Qresp
// 2.0). EditModeController gates on the backend permission decision (never
// frontend-only logic), loads the stored document via /api/paper/{id}/raw
// into the existing curator state, and swaps the publish flow for a Save
// Changes action that PUTs back to the same record. The session CSRF token
// rides on the axios interceptor from AuthState.

const backToPaperHref = (editId, server) =>
  `/paperdetails/${encodeURIComponent(editId)}?server=${encodeURIComponent(
    server || ""
  )}`;

// Where to go after saving/cancelling an edit. Deactivated records are hidden
// from the public detail route (SSR fetches anonymously and 404s), so we send
// the owner back to /account — their management surface — instead of a broken
// detail page. Active records return to their detail page as before.
const afterEditHref = (editId, server, originalDoc) =>
  originalDoc && originalDoc.is_active === false
    ? "/account"
    : backToPaperHref(editId, server);

const SaveChangesBar = ({ editId, server, originalDoc }) => {
  const { metadata } = useContext(CuratorContext);
  const { editing } = useContext(CuratorHelperContext);
  const { selectedHttp } = useContext(ServerContext);
  const { setAlert } = useContext(AlertContext);
  const { showLoader, hideLoader } = useContext(LoadingContext);
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const payload = convertStateToUpdatePayload(
      metadata,
      originalDoc,
      selectedHttp
    );
    const isValid = validate(editing, payload);
    if (!isValid.valid) {
      setAlert(
        "Something's Missing",
        <Fragment>
          {isValid.errors.map((el, i) => (
            <div key={i}>{el}</div>
          ))}
        </Fragment>,
        null
      );
      return;
    }

    setSaving(true);
    showLoader();
    try {
      await axios.put(`/api/paper/${encodeURIComponent(editId)}`, payload);
      router.push(afterEditHref(editId, server, originalDoc));
    } catch (err) {
      console.error(err);
      const res = err.response;
      const reason =
        (res && res.data && res.data.error) ||
        "There was an error saving your changes, please try again.";
      setAlert("Error !", <p>{reason}</p>, null);
    }
    hideLoader();
    setSaving(false);
  };

  return (
    <Box sx={{ display: "flex", gap: 1, mt: 4, mb: 2, alignItems: "center" }}>
      <Typography variant="h6" color="secondary" sx={{ flexGrow: 1 }}>
        Editing published record
      </Typography>
      <RegularStyledButton
        onClick={() => router.push(afterEditHref(editId, server, originalDoc))}
      >
        Cancel
      </RegularStyledButton>
      <RegularStyledButton onClick={save} disabled={saving}>
        Save Changes
      </RegularStyledButton>
    </Box>
  );
};

SaveChangesBar.propTypes = {
  editId: PropTypes.string.isRequired,
  server: PropTypes.string,
  originalDoc: PropTypes.object,
};

const EditModeController = ({ editId, server, children }) => {
  const { setAll, applyLoadedRecord } = useContext(CuratorContext);
  const auth = useContext(AuthContext);
  // applyLoadedRecord fills the form WITHOUT marking it dirty, so the
  // edit-mode unsaved-changes guard only fires on real user edits.
  const loadIntoState = applyLoadedRecord || setAll;
  const [status, setStatus] = useState(editId ? "loading" : "create");
  const [message, setMessage] = useState("");
  const [originalDoc, setOriginalDoc] = useState(null);

  useEffect(() => {
    if (!editId) {
      setStatus("create");
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      try {
        // Backend decides who may edit; the raw endpoint is gated the same
        // way, so a hand-crafted /curator?edit=... URL gains nothing.
        const permissions = await axios
          .get(`/api/paper/${encodeURIComponent(editId)}/permissions`)
          .then((res) => res.data);
        if (!permissions.can_edit) {
          if (!cancelled) {
            setMessage(
              permissions.authenticated
                ? "Only the record owner, an editor, or an admin can edit this record."
                : "Sign in to edit this record."
            );
            setStatus("unauthorized");
          }
          return;
        }
        const raw = await axios
          .get(`/api/paper/${encodeURIComponent(editId)}/raw`)
          .then((res) => res.data);
        if (cancelled) return;
        setOriginalDoc(raw.paper);
        loadIntoState(convertReqSchematoState(raw.paper));
        setStatus("ready");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setMessage("The record could not be loaded for editing.");
          setStatus("error");
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  if (status === "create") {
    // Production ownership rule: NEW records need a verified owner, so the
    // backend rejects anonymous publishing (401). Gate the create UI on the
    // same condition — the message replaces the forms/publish controls.
    if (auth && auth.loading) {
      return (
        <Typography variant="h6" color="secondary" sx={{ mt: 4 }}>
          Checking sign-in…
        </Typography>
      );
    }
    if (auth && !auth.authenticated) {
      return (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" color="secondary" gutterBottom>
            Sign in to curate and publish a record.
          </Typography>
          <Typography variant="body1" color="secondary">
            New records are owned by the account that publishes them — use
            "Sign in with Google" in the header (or "Dev sign in" on staging)
            and come back to the curator.
          </Typography>
        </Box>
      );
    }
    return children(false);
  }

  if (status === "loading") {
    return (
      <Typography variant="h6" color="secondary" sx={{ mt: 4 }}>
        Loading record for editing…
      </Typography>
    );
  }

  if (status !== "ready") {
    return (
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" color="secondary">
          {message}
        </Typography>
      </Box>
    );
  }

  return (
    <Fragment>
      <SaveChangesBar
        editId={editId}
        server={server}
        originalDoc={originalDoc}
      />
      {children(true)}
    </Fragment>
  );
};

EditModeController.propTypes = {
  editId: PropTypes.string,
  server: PropTypes.string,
  children: PropTypes.func.isRequired,
};

export default EditModeController;
export { SaveChangesBar };
