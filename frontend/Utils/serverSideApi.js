// SERVER-SIDE ONLY: which base URL should getServerSideProps use for /api
// fetches?
//
// Pages receive a public `server` query param (e.g. the staging origin
// https://localhost:8443 or a federated Qresp node). Inside the Docker gui
// container that public origin is NOT reachable for local/same-origin
// targets — "localhost" is the gui container itself, not the host tunnel or
// nginx. Such targets are therefore rewritten to the internal backend URL
// from QRESP_INTERNAL_API_URL (e.g. http://backend:5000, compose service
// name). External federation nodes keep being fetched directly, unchanged.
//
// The env var is intentionally NOT NEXT_PUBLIC_*: it never reaches the
// browser, and the public `server` value components render with is not
// touched by this helper.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const stripTrailingSlash = (value) => value.replace(/\/+$/, "");

const isLocalHostname = (hostname) =>
  LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");

const resolveServerSideApiBase = (ctx, serverParam) => {
  const internal =
    stripTrailingSlash((process.env.QRESP_INTERNAL_API_URL || "").trim()) ||
    null;

  const raw = (serverParam || "").trim();
  if (!raw) {
    // No server given: prefer the internal backend; otherwise null keeps the
    // page's existing catch/error path (same net behavior as before).
    return internal;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    // Unparseable input is never used as a fetch target.
    return internal;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    // No ftp:, file:, javascript: or other schemes, ever.
    return internal;
  }

  const requestHost = String(
    (ctx &&
      ctx.req &&
      (ctx.req.headers["x-forwarded-host"] || ctx.req.headers.host)) ||
      ""
  ).toLowerCase();
  const sameAsRequest =
    requestHost.length > 0 && parsed.host.toLowerCase() === requestHost;

  if (isLocalHostname(parsed.hostname.toLowerCase()) || sameAsRequest) {
    // Same-origin / local target: not reachable from inside the container.
    // Without the env var configured, fall back to the original behavior.
    return internal || stripTrailingSlash(raw);
  }

  // External federation node: use it as-is.
  return stripTrailingSlash(raw);
};

export { resolveServerSideApiBase };
