// Building a browsable URL from the paper's file-server path plus a stored
// relative path.
//
// This used to be `server + "/" + imageFile` at four call sites, which broke
// in three ways:
//   * the file server path is EMPTY until "Save File Server" is pressed, so
//     a chart applied from folder analysis produced "/figures/x.png" — a
//     path on the Qresp origin, which silently 404s as a blank image;
//   * manually picked paths arrive with a leading slash (Scraper.node strips
//     the server prefix and leaves one) while analyzed paths do not, so the
//     result was inconsistent — ".../DOI//figures/x.png";
//   * spaces and other URL-significant characters in real folder names were
//     never encoded.
//
// Returns "" when it cannot build a real absolute URL, so callers can render
// an explicit fallback instead of a broken <img>.

const trimSlashes = (value) => String(value || "").replace(/^\/+|\/+$/g, "");

export const buildFileUrl = (base, relative) => {
  const root = String(base || "").replace(/\/+$/, "");
  const path = trimSlashes(relative);
  if (!root || !path) {
    return "";
  }
  // Encode each SEGMENT, so separators survive but spaces, #, ? and friends
  // inside a name do not break the URL.
  const encoded = path
    .split("/")
    .map((segment) => {
      try {
        // Leave an already-encoded segment alone rather than double-encoding.
        return decodeURIComponent(segment) === segment
          ? encodeURIComponent(segment)
          : segment;
      } catch (err) {
        return encodeURIComponent(segment);
      }
    })
    .join("/");
  return `${root}/${encoded}`;
};

// The containing directory of a stored file, as a browsable URL.
export const buildDirectoryUrl = (base, relative) => {
  const path = trimSlashes(relative);
  const cut = path.lastIndexOf("/");
  return buildFileUrl(base, cut === -1 ? "" : path.slice(0, cut));
};

export default buildFileUrl;
