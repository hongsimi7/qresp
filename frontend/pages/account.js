import { Fragment, useContext, useEffect, useState } from "react";

import axios from "axios";
import {
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import Link from "next/link";

import SEO from "../components/seo";
import Drawer from "../components/drawer";
import { RegularStyledButton } from "../components/button";
import OwnerlessRecords from "../components/Account/OwnerlessRecords";
import AllRecords from "../components/Account/AllRecords";
import AuthContext from "../Context/Auth/authContext";
import {
  clearBrowserDraft,
  summarizeBrowserDraft,
} from "../Utils/browserDraft";
import {
  deleteServerDraft,
  listServerDrafts,
  updateServerDraft,
} from "../Utils/serverDrafts";
import { getServer } from "../Utils/utils";

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

const AccountPage = () => {
  const { loading, authenticated, user } = useContext(AuthContext);
  const [papers, setPapers] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [draftError, setDraftError] = useState("");
  const [localDraft, setLocalDraft] = useState(null);
  // One dialog drives both draft actions: { type: "rename"|"delete", id, title }.
  const [draftDialog, setDraftDialog] = useState(null);
  const [draftSaving, setDraftSaving] = useState(false);
  // Published-record management: { type: "deactivate"|"reactivate"|"editors",
  // id, title, value?, error? } — value/error only for the editors dialog.
  const [recordDialog, setRecordDialog] = useState(null);
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordError, setRecordError] = useState("");

  useEffect(() => {
    if (!authenticated) return undefined;
    let cancelled = false;
    setPapers(null);
    setDrafts(null);
    setDraftError("");

    axios
      .get("/api/account/papers")
      .then((res) => {
        if (!cancelled) setPapers(res.data.papers || []);
      })
      .catch(() => {
        if (!cancelled) setPapers([]);
      });

    listServerDrafts()
      .then((items) => {
        if (!cancelled) setDrafts(items);
      })
      .catch(() => {
        if (!cancelled) {
          setDrafts([]);
          setDraftError("Could not load your drafts.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    setLocalDraft(summarizeBrowserDraft());
  }, []);

  const clearLocalDraft = () => {
    clearBrowserDraft();
    setLocalDraft(null);
  };

  const closeDraftDialog = () => {
    setDraftDialog(null);
    setDraftSaving(false);
  };

  const confirmDeleteDraft = () => {
    const id = draftDialog.id;
    setDraftSaving(true);
    setDraftError("");
    deleteServerDraft(id)
      .then(() => {
        setDrafts((items) => (items || []).filter((draft) => draft.id !== id));
        closeDraftDialog();
      })
      .catch(() => {
        setDraftError("Could not delete this draft. Please try again.");
        closeDraftDialog();
      });
  };

  const confirmRenameDraft = () => {
    const { id, title } = draftDialog;
    const nextTitle = (title || "").trim() || "Untitled draft";
    setDraftSaving(true);
    setDraftError("");
    updateServerDraft(id, { title: nextTitle })
      .then((updated) => {
        setDrafts((items) =>
          (items || []).map((draft) =>
            draft.id === id
              ? { ...draft, title: updated.title, updated_at: updated.updated_at }
              : draft
          )
        );
        closeDraftDialog();
      })
      .catch(() => {
        setDraftError("Could not rename this draft. Please try again.");
        closeDraftDialog();
      });
  };

  const closeRecordDialog = () => {
    setRecordDialog(null);
    setRecordSaving(false);
  };

  // "Delete" for a published record is a SOFT deactivate (never a hard delete):
  // it hides the record from public search/explorer/detail but preserves it,
  // and it can be reactivated. Toggling goes only through the /active endpoint.
  const confirmSetActive = () => {
    const { id, type } = recordDialog;
    const active = type === "reactivate";
    setRecordSaving(true);
    setRecordError("");
    axios
      .put(`/api/paper/${encodeURIComponent(id)}/active`, { active })
      .then(() => {
        setPapers((items) =>
          (items || []).map((paper) =>
            paper.id === id ? { ...paper, is_active: active } : paper
          )
        );
        closeRecordDialog();
      })
      .catch(() => {
        setRecordError(
          active
            ? "Could not reactivate this record. Please try again."
            : "Could not deactivate this record. Please try again."
        );
        closeRecordDialog();
      });
  };

  // Replace the record's editor list (owner/admin only, enforced server-side).
  // Editors get edit-only access: they cannot deactivate the record or change
  // this list. Comma-separated input; the backend normalizes and validates.
  const confirmSetEditors = () => {
    const { id, value } = recordDialog;
    const editors = (value || "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
    setRecordSaving(true);
    axios
      .put(`/api/paper/${encodeURIComponent(id)}/editors`, {
        editor_emails: editors,
      })
      .then((res) => {
        setPapers((items) =>
          (items || []).map((paper) =>
            paper.id === id
              ? { ...paper, editor_emails: res.data.editor_emails }
              : paper
          )
        );
        closeRecordDialog();
      })
      .catch((err) => {
        const res = err.response;
        setRecordSaving(false);
        setRecordDialog((current) =>
          current
            ? {
                ...current,
                error:
                  (res && res.data && res.data.error) ||
                  "Could not update the editors. Please try again.",
              }
            : current
        );
      });
  };

  const origin = typeof window === "undefined" ? "" : getServer();

  let content;
  if (loading) {
    content = (
      <Typography variant="h6" color="secondary" sx={{ mt: 4 }}>
        Checking sign-in...
      </Typography>
    );
  } else if (!authenticated) {
    content = (
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" color="secondary" gutterBottom>
          Sign in to see your account.
        </Typography>
        <Typography variant="body1" color="secondary">
          Use "Sign in with Google" in the header (or "Dev sign in" on
          staging).
        </Typography>
      </Box>
    );
  } else {
    content = (
      <Fragment>
        <Drawer heading="Profile" defaultOpen={true}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography color="secondary">{user.name}</Typography>
            {user.is_admin ? (
              <Chip label="admin" size="small" color="primary" />
            ) : null}
          </Box>
          <Typography color="secondary">{user.email}</Typography>
          <Typography variant="body2" color="secondary">
            Signed in with{" "}
            {user.provider === "google"
              ? "Google"
              : user.provider === "cilogon"
              ? "your institution (CILogon)"
              : user.provider}
          </Typography>
        </Drawer>

        <Drawer heading="My published records" defaultOpen={true}>
          {recordError ? (
            <Typography color="error" sx={{ mb: 1 }}>
              {recordError}
            </Typography>
          ) : null}
          {papers === null ? (
            <Typography color="secondary">Loading...</Typography>
          ) : papers.length === 0 ? (
            <Typography color="secondary">
              No published records yet. Records you publish become editable
              from here.
            </Typography>
          ) : (
            papers.map((paper) => {
              const deactivated = paper.is_active === false;
              // Editors get edit-only access; managing (deactivate/reactivate
              // and the editor list) stays with the owner — and admins, whose
              // rows here are their own records anyway. The backend enforces
              // this regardless of what is rendered.
              const canManage = user.is_admin || paper.role !== "editor";
              return (
                <Box
                  key={paper.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <Box sx={{ flexGrow: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography color="secondary">
                        {paper.title}
                        {paper.year ? ` (${paper.year})` : ""}
                      </Typography>
                      {paper.role === "editor" ? (
                        <Chip label="editor" size="small" color="default" />
                      ) : null}
                      {deactivated ? (
                        <Chip
                          label="deactivated"
                          size="small"
                          color="default"
                        />
                      ) : null}
                    </Box>
                    <Typography variant="body2" color="secondary">
                      {paper.authors}
                    </Typography>
                  </Box>
                  {/* Deactivated records are hidden from the public detail
                      route (SSR fetches anonymously and 404s), so we don't
                      offer a View that would land on an error page. */}
                  {deactivated ? null : (
                    <Button
                      size="small"
                      variant="outlined"
                      component={Link}
                      href={`/paperdetails/${encodeURIComponent(
                        paper.id
                      )}?server=${encodeURIComponent(origin)}`}
                    >
                      View
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    component={Link}
                    href={`/curator?edit=${encodeURIComponent(
                      paper.id
                    )}&server=${encodeURIComponent(origin)}`}
                  >
                    Edit in Curator
                  </Button>
                  {canManage ? (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        setRecordDialog({
                          type: "editors",
                          id: paper.id,
                          title: paper.title || "this record",
                          value: (paper.editor_emails || []).join(", "),
                        })
                      }
                    >
                      Editors
                    </Button>
                  ) : null}
                  {!canManage ? null : deactivated ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      onClick={() =>
                        setRecordDialog({
                          type: "reactivate",
                          id: paper.id,
                          title: paper.title || "this record",
                        })
                      }
                    >
                      Reactivate
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() =>
                        setRecordDialog({
                          type: "deactivate",
                          id: paper.id,
                          title: paper.title || "this record",
                        })
                      }
                    >
                      Deactivate
                    </Button>
                  )}
                </Box>
              );
            })
          )}
        </Drawer>

        {/* Two admin drawers, deliberately: "Ownerless records" stays as a
            short migration helper (it shows the curator-declared owner
            suggestion), while "All records" is the complete management
            surface over every stored record. */}
        {user.is_admin ? (
          <Drawer heading="Ownerless records (admin)" defaultOpen={false}>
            <OwnerlessRecords />
          </Drawer>
        ) : null}

        {user.is_admin ? (
          <Drawer heading="All records (admin)" defaultOpen={false}>
            <AllRecords />
          </Drawer>
        ) : null}

        <Drawer heading="My drafts" defaultOpen={true}>
          {draftError ? (
            <Typography color="error" sx={{ mb: 1 }}>
              {draftError}
            </Typography>
          ) : null}
          {drafts === null ? (
            <Typography color="secondary">Loading drafts...</Typography>
          ) : drafts.length === 0 ? (
            <Typography color="secondary">
              No account drafts yet. Use Save Draft in the curator to keep
              incomplete work in your account.
            </Typography>
          ) : (
            drafts.map((draft) => (
              <Box
                key={draft.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 1,
                  flexWrap: "wrap",
                }}
              >
                <Box sx={{ flexGrow: 1 }}>
                  <Typography color="secondary">{draft.title}</Typography>
                  <Typography variant="body2" color="secondary">
                    Updated {formatDate(draft.updated_at) || "recently"}
                  </Typography>
                </Box>
                <RegularStyledButton
                  component={Link}
                  href={`/curator?draft=${encodeURIComponent(draft.id)}`}
                >
                  Resume
                </RegularStyledButton>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    setDraftDialog({
                      type: "rename",
                      id: draft.id,
                      title: draft.title || "",
                    })
                  }
                >
                  Rename
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() =>
                    setDraftDialog({
                      type: "delete",
                      id: draft.id,
                      title: draft.title || "Untitled draft",
                    })
                  }
                >
                  Delete
                </Button>
              </Box>
            ))
          )}
        </Drawer>

        <Drawer heading="Local recovery draft" defaultOpen={true}>
          {localDraft ? (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
            >
              <Box sx={{ flexGrow: 1 }}>
                <Typography color="secondary">{localDraft.title}</Typography>
                {localDraft.sections.length > 0 ? (
                  <Typography variant="body2" color="secondary">
                    Contains: {localDraft.sections.join(", ")}
                  </Typography>
                ) : null}
                <Typography variant="body2" color="secondary">
                  This recovery copy is stored only in this browser. Save it as
                  an account draft from the curator if you want to keep it.
                </Typography>
              </Box>
              <RegularStyledButton component={Link} href="/curator?resumeDraft=1">
                Resume
              </RegularStyledButton>
              <Button size="small" variant="outlined" onClick={clearLocalDraft}>
                Clear
              </Button>
            </Box>
          ) : (
            <Typography color="secondary">
              No local recovery draft is saved in this browser.
            </Typography>
          )}
        </Drawer>

        <Dialog
          open={Boolean(recordDialog)}
          onClose={closeRecordDialog}
          fullWidth
          maxWidth="xs"
        >
          {recordDialog && recordDialog.type === "editors" ? (
            <Fragment>
              <DialogTitle>Editors</DialogTitle>
              <DialogContent>
                <Typography variant="body2" color="secondary" gutterBottom>
                  Editors can edit &ldquo;{recordDialog.title}&rdquo; but
                  cannot deactivate it or change this list.
                </Typography>
                <TextField
                  autoFocus
                  label="Editor emails"
                  value={recordDialog.value || ""}
                  onChange={(e) =>
                    setRecordDialog((current) => ({
                      ...current,
                      value: e.target.value,
                    }))
                  }
                  fullWidth
                  margin="dense"
                  variant="outlined"
                  helperText="Comma-separated email addresses. Leave empty to remove all editors."
                />
                {recordDialog.error ? (
                  <Typography variant="body2" color="error">
                    {recordDialog.error}
                  </Typography>
                ) : null}
              </DialogContent>
              <DialogActions>
                <Button onClick={closeRecordDialog}>Cancel</Button>
                <Button
                  onClick={confirmSetEditors}
                  variant="contained"
                  disabled={recordSaving}
                >
                  Save
                </Button>
              </DialogActions>
            </Fragment>
          ) : recordDialog ? (
            <Fragment>
              <DialogTitle>
                {recordDialog.type === "reactivate"
                  ? "Reactivate this record?"
                  : "Deactivate this record?"}
              </DialogTitle>
              <DialogContent>
                <Typography color="secondary">
                  {recordDialog.type === "reactivate"
                    ? `“${recordDialog.title}” will become publicly visible again in search, the explorer and its detail page.`
                    : `“${recordDialog.title}” will be hidden from public search, the explorer and its detail page. It is not deleted — it stays in your account and you can reactivate it at any time.`}
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={closeRecordDialog}>Cancel</Button>
                <Button
                  onClick={confirmSetActive}
                  variant="contained"
                  color={
                    recordDialog.type === "reactivate" ? "primary" : "error"
                  }
                  disabled={recordSaving}
                >
                  {recordDialog.type === "reactivate"
                    ? "Reactivate"
                    : "Deactivate"}
                </Button>
              </DialogActions>
            </Fragment>
          ) : null}
        </Dialog>

        <Dialog
          open={Boolean(draftDialog)}
          onClose={closeDraftDialog}
          fullWidth
          maxWidth="xs"
        >
          {draftDialog && draftDialog.type === "rename" ? (
            <Fragment>
              <DialogTitle>Rename draft</DialogTitle>
              <DialogContent>
                <TextField
                  autoFocus
                  label="Draft name"
                  value={draftDialog.title}
                  onChange={(e) =>
                    setDraftDialog((current) => ({
                      ...current,
                      title: e.target.value,
                    }))
                  }
                  fullWidth
                  margin="dense"
                  variant="outlined"
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={closeDraftDialog}>Cancel</Button>
                <Button
                  onClick={confirmRenameDraft}
                  variant="contained"
                  disabled={draftSaving}
                >
                  Save
                </Button>
              </DialogActions>
            </Fragment>
          ) : draftDialog ? (
            <Fragment>
              <DialogTitle>Delete this draft?</DialogTitle>
              <DialogContent>
                <Typography color="secondary">
                  &ldquo;{draftDialog.title}&rdquo; will be permanently deleted
                  from your account. This cannot be undone.
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={closeDraftDialog}>Cancel</Button>
                <Button
                  onClick={confirmDeleteDraft}
                  variant="contained"
                  color="error"
                  disabled={draftSaving}
                >
                  Delete
                </Button>
              </DialogActions>
            </Fragment>
          ) : null}
        </Dialog>
      </Fragment>
    );
  }

  return (
    <Fragment>
      <SEO
        title="Qresp | Account"
        description="Your Qresp profile, published records and drafts"
        author="Qresp Team"
      />
      <Container>
        <Box sx={{ mt: 4, mb: 6 }}>{content}</Box>
      </Container>
    </Fragment>
  );
};

export default AccountPage;
