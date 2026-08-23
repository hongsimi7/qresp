import { Fragment } from "react";

import { Box, Container, Divider, Link as MuiLink, Typography } from "@mui/material";

import SEO from "../components/seo";
import StyledButton from "../components/button";

// Contact, as a page rather than a `mailto:` in the navigation bar.
//
// The header's Contact entry used to be
// `mailto:datadev@lists.uchicago.edu?subject=Qresp`. Clicking a navigation
// link and having the browser hand the page to a mail client is a jarring
// thing to do to somebody who only wanted to know how to get in touch — and
// on a machine with no mail client configured it does nothing at all, so the
// link looked broken. It also offered exactly one way to reach the project,
// when most of what people want to say ("this is broken", "here is a fix")
// belongs in the issue tracker.
//
// So: a page that shows the address as TEXT (copyable, and visible before you
// commit to anything), keeps the mail client one click away for those who
// want it, and names the two GitHub routes that are usually the right ones.

const EMAIL = "datadev@lists.uchicago.edu";
// The list is a shared inbox that receives more than Qresp. A pre-filled
// subject is what lets whoever reads it sort this mail without opening it,
// and costs the sender nothing -- it is still editable in their mail client.
const MAILTO = `mailto:${EMAIL}?subject=Qresp`;
const REPOSITORY = "https://github.com/qresp-code-development/qresp";
const ISSUES = `${REPOSITORY}/issues`;
const PULL_REQUESTS = `${REPOSITORY}/pulls`;

const contactDescription =
  "How to reach the Qresp team: email the DataDev list, report a bug, or open a pull request.";

// Every outbound link goes through here, so `rel="noopener noreferrer"` and
// the "(opens in a new tab)" note cannot be forgotten on one of them.
// `noopener` denies the opened page a handle on this one; `noreferrer` keeps
// the referring URL — which on a detail page names a record — out of the
// request.
const ExternalLink = ({ href, children }) => (
  <MuiLink
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    underline="hover"
  >
    {children}
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
);

const Row = ({ title, children }) => (
  <Box sx={{ mb: 3 }}>
    <Typography variant="h6" component="h2" gutterBottom>
      <Box component="span" sx={{ fontWeight: "bold" }}>
        {title}
      </Box>
    </Typography>
    {children}
  </Box>
);

const Contact = () => (
  <Fragment>
    <SEO title="Qresp | Contact" description={contactDescription} />
    <Container maxWidth="md">
      <Box sx={{ my: 5 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          <Box component="span" sx={{ fontWeight: "bold" }}>
            Contact
          </Box>
        </Typography>
        <Typography variant="body1" color="secondary" sx={{ mb: 4 }}>
          Questions about Qresp, a record you are curating, or a Qresp server?
          Write to the DataDev list. For anything about the software itself —
          a bug report or a feature request — GitHub is faster, and the issue
          stays where the people who can act on it will see it.
        </Typography>

        <Row title="Email">
          {/* The address as TEXT first. It can be read, copied and pasted
              into whatever the reader actually uses, which a bare `mailto:`
              link never allowed. */}
          <Typography variant="body1" gutterBottom>
            <MuiLink href={MAILTO} underline="hover">
              {EMAIL}
            </MuiLink>
          </Typography>
          <Box sx={{ mt: 1 }}>
            <StyledButton
              href={MAILTO}
              variant="contained"
              data-testid="email-datadev"
            >
              Email Qresp
            </StyledButton>
          </Box>
        </Row>

        <Divider sx={{ mb: 3 }} />

        <Row title="Source code">
          <Typography variant="body1">
            <ExternalLink href={REPOSITORY}>
              Qresp on GitHub
            </ExternalLink>
          </Typography>
          <Typography variant="body2" color="secondary">
            {REPOSITORY}
          </Typography>
        </Row>

        <Row title="Report a bug">
          <Typography variant="body1">
            {/* Named for what it does, not "click here": a link read out of
                context still has to say where it goes. */}
            <ExternalLink href={ISSUES}>
              Open an issue in the Qresp issue tracker
            </ExternalLink>
          </Typography>
          <Typography variant="body2" color="secondary">
            Please include what you did, what you expected, and what happened
            instead. A record id or a Qresp server URL helps. Feature requests
            belong here too.
          </Typography>
        </Row>

        <Row title="Contribute a change">
          <Typography variant="body1">
            <ExternalLink href={PULL_REQUESTS}>
              Open a pull request against the Qresp repository
            </ExternalLink>
          </Typography>
        </Row>
      </Box>
    </Container>
  </Fragment>
);

export { EMAIL, MAILTO, REPOSITORY, ISSUES, PULL_REQUESTS };
export default Contact;
