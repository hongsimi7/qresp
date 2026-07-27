import axios from "axios";
import { namesUtil } from "./utils";

// A bare DOI: the only form Qresp stores, resolves and publishes.
const DOI_PATTERN = /^10[.][0-9]{4,}(?:[.][0-9]+)*\/(?:(?!["&'<>])\S)+$/;

// Curators paste DOIs in several standard shapes (bare, `doi:`-labelled, or
// a doi.org / dx.doi.org resolver URL). Reduce all of them to the bare DOI
// BEFORE validating, fetching and saving, so the canonical referenceInfo
// always holds one normalized value. Anything that is not a DOI resolver URL
// is left untouched, so non-DOI input still fails validation.
const normalizeDoi = (raw) => {
  let value = String(raw == null ? "" : raw).trim();
  if (!value) return "";
  value = value.replace(/^doi:\s*/i, "");
  value = value.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "");
  // Trailing sentence punctuation survives copy/paste from prose.
  return value.trim().replace(/[.,;]+$/, "");
};

const doiUtil = {
  normalize: normalizeDoi,
  isValid: (doi) => DOI_PATTERN.test(normalizeDoi(doi)),
  url: (doi) => `https://dx.doi.org/${doi}`,
  headers: { Accept: "application/json; style=json" },
  get: (doi) =>
    axios
      .get(doiUtil.url(doi), {
        headers: doiUtil.headers,
      })
      .then((res) => res.data),
  set: (values, method) => {
    method("title", values.title);
    method("journal", values["container-title"]);
    method("page", values.page || values["article-number"]);
    method("volume", values.volume);
    method("title", values.title);
    method("url", values.URL);
    method("year", values.created["date-parts"][0][0]);
    method("authors", doiUtil.formatNames(values.author));
  },
  formatNames: (authors) => {
    const names = authors.map((author) => {
      return `${author.given} ${author.family}`;
    });
    return namesUtil.get(names.join(", "));
  },
};

export { doiUtil, DOI_PATTERN, normalizeDoi };
