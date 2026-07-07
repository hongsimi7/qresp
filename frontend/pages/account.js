import { Fragment, useContext, useEffect, useState } from "react";

import axios from "axios";
import { Box, Button, Chip, Container, Typography } from "@mui/material";
import Link from "next/link";

import SEO from "../components/seo";
import Drawer from "../components/drawer";
import { RegularStyledButton } from "../components/button";
import AuthContext from "../Context/Auth/authContext";
import {
  clearBrowserDraft,
  summarizeBrowserDraft,
} from "../Utils/browserDraft";
import { getServer } from "../Utils/utils";

// Minimal signed-in account page (Qresp 2.0): profile, the user's published
// records (backend-owned list), and any curator draft saved in THIS browser.
// Deliberately small — no admin dashboard, no server-side drafts.

const AccountPage = () => {
  const { loading, authenticated, user } = useContext(AuthContext);
  const [papers, setPapers] = useState(null);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!authenticated) return undefined;
    let cancelled = false;
    axios
      .get("/api/account/papers")
      .then((res) => {
        if (!cancelled) setPapers(res.data.papers || []);
      })
      .catch(() => {
        if (!cancelled) setPapers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    // Browser-only: surface an existing curator draft from localStorage.
    setDraft(summarizeBrowserDraft());
  }, []);

  const clearDraft = () => {
    clearBrowserDraft();
    setDraft(null);
  };

  const origin = typeof window === "undefined" ? "" : getServer();

  let content;
  if (loading) {
    content = (
      <Typography variant="h6" color="secondary" sx={{ mt: 4 }}>
        Checking sign-in…
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
          <Typography color="secondary">
            {user.name}
            {user.is_admin ? (
              <Chip label="admin" size="small" color="primary" sx={{ ml: 1 }} />
            ) : null}
          </Typography>
          <Typography color="secondary">{user.email}</Typography>
          <Typography variant="body2" color="secondary">
            Signed in with {user.provider === "google" ? "Google" : user.provider}
          </Typography>
        </Drawer>

        <Drawer heading="My published records" defaultOpen={true}>
          {papers === null ? (
            <Typography color="secondary">Loading…</Typography>
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
                  <Typography color="secondary">
                    {paper.title}
                    {paper.year ? ` (${paper.year})` : ""}
                  </Typography>
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

        <Drawer heading="Single draft on this browser" defaultOpen={true}>
          {draft ? (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
            >
              <Box sx={{ flexGrow: 1 }}>
                <Typography color="secondary">{draft.title}</Typography>
                {draft.sections.length > 0 ? (
                  <Typography variant="body2" color="secondary">
                    Contains: {draft.sections.join(", ")}
                  </Typography>
                ) : null}
              </Box>
              <RegularStyledButton component={Link} href="/curator?resumeDraft=1">
                Resume
              </RegularStyledButton>
              <Button size="small" variant="outlined" onClick={clearDraft}>
                Clear
              </Button>
            </Box>
          ) : (
            <Typography color="secondary">
              No browser draft is saved on this device. Qresp currently keeps
              one local draft per browser; server-saved drafts are not enabled
              yet.
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
