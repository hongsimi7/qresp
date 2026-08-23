import { Fragment, useRef, useState } from "react";

import NextLink from "next/link";
import {
  Box,
  Container,
  Divider,
  Link as MuiLink,
  Typography,
} from "@mui/material";

import SEO from "../components/seo";
import { RegularStyledButton } from "../components/button";

// Qresp documentation, in the app.
//
// The reference documentation lives at qresp.org and still does — it is
// linked below. What belongs HERE is the part a curator needs while they are
// curating: how to lay a project out before pointing Qresp at it.
//
// The template is deliberately a GENERAL research-package layout. It is not
// the figure-centred structure under discussion elsewhere; if and when that
// lands it replaces this section, and pre-announcing it would leave the docs
// describing something the software does not do.

const DOCUMENTATION_SITE = "https://qresp.org";

// One string, copied verbatim. It is defined once and both rendered and
// copied from the same constant, so what a reader sees and what lands on
// their clipboard cannot drift apart.
const DIRECTORY_TEMPLATE = `project/
  README.md
  data/
    raw/
    processed/
  figures/
  scripts/
  tools/
  docs/
`;

const NOTES = [
  ["README.md", "what the project is, and how to reproduce it"],
  ["data/raw/", "exactly what was measured or downloaded — never edited"],
  ["data/processed/", "everything derived from raw/, reproducible by scripts/"],
  ["figures/", "the figures as published, one file per figure"],
  ["scripts/", "the code that turns raw data into processed data and figures"],
  ["tools/", "software, notebooks and environments used to run the scripts"],
  ["docs/", "notes, protocols and anything a reader needs to interpret the rest"],
];

const Documentation = () => {
  // "" | "copied" | "failed" | "manual". Announced, never left to colour.
  const [copyState, setCopyState] = useState("");
  const templateRef = useRef(null);

  const selectTemplate = () => {
    // The fallback, and it is a real one rather than an apology: the text is
    // selected so ctrl/cmd-C finishes the job by hand. `document.execCommand`
    // is deliberately not used — it is deprecated, and it fails silently in
    // exactly the sandboxed contexts that block the async clipboard API.
    const node = templateRef.current;
    if (!node || typeof window === "undefined" || !window.getSelection) {
      return false;
    }
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (e) {
      return false;
    }
  };

  const copyTemplate = async () => {
    // The async clipboard API needs a secure context and permission, so it is
    // absent or refused often enough that "it silently did nothing" would be
    // a common outcome. Every branch below ends in a message.
    const clipboard =
      typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (clipboard && clipboard.writeText) {
      try {
        await clipboard.writeText(DIRECTORY_TEMPLATE);
        setCopyState("copied");
        return;
      } catch (e) {
        /* refused (permission, or an insecure context): fall through */
      }
    }
    setCopyState(selectTemplate() ? "manual" : "failed");
  };

  const message = {
    copied: "Template copied to your clipboard.",
    manual:
      "Copying is not available in this browser. The template is selected — " +
      "press Ctrl+C (Cmd+C on a Mac) to copy it.",
    failed:
      "The template could not be copied. Select the text above and copy it " +
      "manually.",
  }[copyState];

  return (
    <Fragment>
      <SEO
        title="Qresp | Documentation"
        description="How to organize a research project before curating it with Qresp, including a copyable directory structure template."
      />
      <Container maxWidth="md">
        <Box sx={{ my: 5 }}>
          <Typography variant="h3" component="h1" gutterBottom>
            <Box component="span" sx={{ fontWeight: "bold" }}>
              Documentation
            </Box>
          </Typography>
          <Typography variant="body1" color="secondary" sx={{ mb: 4 }}>
            The full Qresp reference documentation is at{" "}
            <MuiLink
              href={DOCUMENTATION_SITE}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
            >
              qresp.org
              <Box
                component="span"
                sx={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                }}
              >
                {" (opens in a new tab)"}
              </Box>
            </MuiLink>
            . This page covers the part that comes first: how to lay a project
            out before you curate it.
          </Typography>

          <Divider sx={{ mb: 4 }} />

          {/* The Folder Standard goes FIRST, because it is the only layout on
              this site that changes what the software does. The general
              template below is good practice; this one is read by the
              analyzer. A reader who cannot tell which is which will follow
              whichever they meet first, so they meet this one. */}
          <Box
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 2.5,
              mb: 4,
            }}
            data-testid="folder-standard-callout"
          >
            <Typography variant="h5" component="h2" gutterBottom>
              <Box component="span" sx={{ fontWeight: "bold" }}>
                Qresp Folder Standard v1
              </Box>
            </Typography>
            <Typography variant="body1" color="secondary" sx={{ mb: 2 }}>
              If you will import a folder through <strong>RCC folder
              analysis</strong>, this is the layout Qresp reads. Following it
              means charts, datasets, scripts and tools are proposed as records
              automatically instead of being left for you to sort out by hand.
            </Typography>
            <MuiLink
              component={NextLink}
              href="/documentation/folder-standard"
              underline="hover"
              data-testid="folder-standard-link"
            >
              Read the Qresp Folder Standard v1
            </MuiLink>
          </Box>

          <Typography variant="h5" component="h2" gutterBottom>
            <Box component="span" sx={{ fontWeight: "bold" }}>
              Organizing a research project
            </Box>
          </Typography>
          <Typography variant="body1" color="secondary" sx={{ mb: 2 }}>
            Qresp curates whatever structure you already have, so there is no
            layout it requires. This one is a reasonable general default: it
            separates what was measured from what was derived, and keeps the
            code that connects them beside both — which is most of what makes a
            package reproducible by somebody else. It is <em>not</em> the
            Folder Standard above, and automatic record proposals are not
            deterministic on it; use the standard if you want those.
          </Typography>

          <Box
            component="pre"
            ref={templateRef}
            data-testid="directory-template"
            tabIndex={0}
            aria-label="Example project directory structure"
            sx={{
              backgroundColor: "rgba(0,0,0,0.04)",
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 1,
              p: 2,
              m: 0,
              overflowX: "auto",
              fontFamily: "monospace",
              fontSize: "0.95rem",
              lineHeight: 1.6,
            }}
          >
            {DIRECTORY_TEMPLATE}
          </Box>

          <Box sx={{ mt: 1.5 }}>
            <RegularStyledButton
              onClick={copyTemplate}
              data-testid="copy-template"
            >
              Copy template
            </RegularStyledButton>
          </Box>

          {/* The outcome of a copy is invisible — the clipboard is not on
              screen — so it is the one thing that has to be said out loud. */}
          <Typography
            variant="body2"
            role="status"
            aria-live="polite"
            component="div"
            color={copyState === "failed" ? "error" : "secondary"}
            data-testid="copy-status"
            sx={{ mt: 1, minHeight: "1.5em" }}
          >
            {message || ""}
          </Typography>

          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" component="h3" gutterBottom>
              <Box component="span" sx={{ fontWeight: "bold" }}>
                What goes where
              </Box>
            </Typography>
            <Box component="dl" sx={{ m: 0 }}>
              {NOTES.map(([path, note]) => (
                <Box key={path} sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 0.5 }}>
                  <Box
                    component="dt"
                    sx={{ fontFamily: "monospace", fontWeight: "bold", minWidth: 0 }}
                  >
                    {path}
                  </Box>
                  <Box component="dd" sx={{ m: 0, color: "text.secondary" }}>
                    {note}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Container>
    </Fragment>
  );
};

export { DIRECTORY_TEMPLATE, DOCUMENTATION_SITE };
export default Documentation;
