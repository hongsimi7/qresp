import { useContext, useEffect } from "react";

import { Box, Container, Typography } from "@mui/material";
import { useRouter } from "next/router";

import SEO from "../components/seo";
import Drawer from "../components/drawer";
import { RegularStyledButton } from "../components/button";
import AuthContext from "../Context/Auth/authContext";
import safeNext, { providerHref } from "../Utils/safeNext";

// The single public sign-in page. Two providers, nothing else: no dev-login,
// no provider configuration, no error internals. Each button is a plain
// full-page navigation into the existing backend flow, which redirects to the
// provider and back to the validated same-origin `next`.

const LoginPage = () => {
  const router = useRouter();
  const { loading, authenticated } = useContext(AuthContext);

  // An empty fallback distinguishes "no next was asked for" from "next is /".
  const requested = safeNext(router && router.query && router.query.next, "");
  const next = requested || "/";

  // Already signed in? Nothing to choose — go where they were headed, or to
  // their account when they arrived here directly.
  useEffect(() => {
    if (!loading && authenticated && router) {
      router.replace(
        requested && requested !== "/login" ? requested : "/account"
      );
    }
  }, [loading, authenticated, requested, router]);

  if (loading || authenticated) {
    return (
      <Container maxWidth="sm">
        <Typography variant="h6" color="secondary" sx={{ mt: 6 }}>
          {loading ? "Checking sign-in…" : "You are signed in — redirecting…"}
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm">
      <SEO title="Sign in" />
      <Box sx={{ mt: 4, mb: 4 }}>
        <Drawer heading="Sign in to Qresp" defaultOpen={true}>
          <Typography variant="body1" color="secondary" sx={{ mb: 2 }}>
            Signing in lets you curate and publish records, save drafts to your
            account, and edit the records you own.
          </Typography>

          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              maxWidth: 420,
            }}
          >
            <Box>
              <RegularStyledButton
                fullWidth
                component="a"
                href={providerHref("microsoft", next)}
              >
                Continue with Microsoft
              </RegularStyledButton>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ mt: 0.5 }}
              >
                Use your work or school account. Many institutions issue one —
                if yours does, this signs you in with it.
              </Typography>
            </Box>

            <Box>
              <RegularStyledButton
                fullWidth
                component="a"
                href={providerHref("google", next)}
              >
                Continue with Google
              </RegularStyledButton>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ mt: 0.5 }}
              >
                Use a personal or institutional Google account.
              </Typography>
            </Box>
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 3 }}
          >
            Qresp only receives your name and email address from the provider,
            and uses them to attribute the records you publish.
          </Typography>
        </Drawer>
      </Box>
    </Container>
  );
};

export default LoginPage;
