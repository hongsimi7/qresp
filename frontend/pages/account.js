import { Fragment, useContext, useEffect, useState } from "react";

import axios from "axios";
import { Box, Button, Chip, Container, Typography } from "@mui/material";
import Link from "next/link";

import SEO from "../components/seo";
import Drawer from "../components/drawer";
import { RegularStyledButton } from "../components/button";
import OwnerlessRecords from "../components/Account/OwnerlessRecords";
import AuthContext from "../Context/Auth/authContext";
import {
  clearBrowserDraft,
  summarizeBrowserDraft,
} from "../Utils/browserDraft";
import { deleteServerDraft, listServerDrafts } from "../Utils/serverDrafts";
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

  const removeDraft = (id) => {
    setDraftError("");
    deleteServerDraft(id)
      .then(() => {
        setDrafts((items) => (items || []).filter((draft) => draft.id !== id));
      })
      .catch(() => {
        setDraftError("Could not delete this draft. Please try again.");
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
            Signed in with {user.provider === "google" ? "Google" : user.provider}
          </Typography>
        </Drawer>

        <Drawer heading="My published records" defaultOpen={true}>
          {papers === null ? (
            <Typography color="secondary">Loading...</Typography>
          ) : papers.length === 0 ? (
            <Typography color="secondary">
              No published records yet. Records you publish become editable
              from here.
            </Typography>
          ) : (
            papers.map((paper) => (
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
                    {paper.is_active === false ? (
                      <Chip label="deactivated" size="small" color="default" />
                    ) : null}
                  </Box>
                  <Typography variant="body2" color="secondary">
                    {paper.authors}
                  </Typography>
                </Box>
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
              </Box>
            ))
          )}
        </Drawer>

        {user.is_admin ? (
          <Drawer heading="Ownerless records (admin)" defaultOpen={false}>
            <OwnerlessRecords />
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
                  onClick={() => removeDraft(draft.id)}
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
