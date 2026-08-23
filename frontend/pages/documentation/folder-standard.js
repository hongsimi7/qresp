import { Fragment } from "react";

import NextLink from "next/link";
import { Box, Container, Divider, Link as MuiLink, Typography } from "@mui/material";

import SEO from "../../components/seo";
import FolderStandardBody from "../../components/FolderStandard/FolderStandardBody";
import { STANDARD_NAME } from "../../components/FolderStandard/content";

// The Qresp Folder Standard v1, in public.
//
// It was reachable only from inside the Curator, behind a dialog on a page you
// have to be signed in to reach. That is the wrong audience and the wrong
// moment: the person who most needs it is a researcher laying a folder out
// BEFORE anyone curates it, and quite possibly not a curator on this server at
// all. There was no URL to send them.
//
// The content is imported, not restated. It is the same module the Curator
// dialog renders, so this page and that dialog cannot come to describe
// different layouts — see components/FolderStandard/content.js.
//
// The reference documentation site at qresp.org is a separate property and is
// NOT edited from this repository; this page is the in-app public home for
// this particular guidance.

const description =
  "The Qresp Folder Standard v1: the recommended folder layout for accurate " +
  "automatic record proposals from an RCC folder.";

const FolderStandard = () => (
  <Fragment>
    <SEO title={`Qresp | ${STANDARD_NAME}`} description={description} />
    <Container maxWidth="md">
      <Box sx={{ my: 5 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          <MuiLink
            component={NextLink}
            href="/documentation"
            underline="hover"
            data-testid="back-to-documentation"
          >
            ← Documentation
          </MuiLink>
        </Typography>
        <Typography variant="h3" component="h1" gutterBottom>
          <Box component="span" sx={{ fontWeight: "bold" }}>
            {STANDARD_NAME}
          </Box>
        </Typography>
        <Typography variant="body1" color="secondary" sx={{ mb: 4 }}>
          This is Qresp&apos;s official folder structure, and the only one it
          publishes — the layout its automatic analysis reads. You do not have
          to follow it: Qresp curates the folder you already have, never
          renames anything, and still recognizes older folder names. But a
          folder that does follow it is proposed as records without anyone
          having to answer questions about it first.
        </Typography>

        <Divider sx={{ mb: 3 }} />

        <FolderStandardBody headingLevel="h2" />
      </Box>
    </Container>
  </Fragment>
);

export default FolderStandard;
