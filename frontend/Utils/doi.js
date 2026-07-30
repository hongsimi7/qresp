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

// Crossref serves abstracts as JATS-tagged XML. The printed words are kept
// and the tags dropped; nothing is summarized or rewritten.
const stripJats = (raw) => {
  const text = String(raw == null ? "" : raw);
  if (!text.trim()) return "";
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/^\s*abstract\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
  // The canonical, resolvable form of a DOI. Distinct from `url` above, which
  // is the dx.doi.org content-negotiation endpoint used to FETCH metadata and
  // is not what belongs in a published record.
  canonicalUrl: (doi) => {
    const bare = normalizeDoi(doi);
    return bare ? `https://doi.org/${bare}` : "";
  },

  // Crossref may return a scalar or an array for several of these, and omit
  // others entirely. A field the registry does not supply is LEFT ALONE — the
  // curator fills it in by hand — rather than blanked, and nothing here is
  // inferred or generated.
  set: (values, method) => {
    const record = values || {};
    const first = (value) => {
      const picked = Array.isArray(value) ? value[0] : value;
      const text = picked == null ? "" : String(picked).trim();
      return text;
    };
    const write = (field, value) => {
      if (value) method(field, value);
    };

    write("title", first(record.title));
    write("journal", first(record["container-title"]));
    write("page", first(record.page) || first(record["article-number"]));
    write("volume", first(record.volume));

    // `issued` is the publication date. `created` is when the registry record
    // was made and can fall in a different year, so it is only a fallback.
    const datePart = (source) => {
      const parts = ((source || {})["date-parts"] || [])[0] || [];
      return parts[0] ? String(parts[0]) : "";
    };
    write("year", datePart(record.issued) || datePart(record.created));

    // Crossref abstracts arrive as JATS-tagged XML.
    write("abstract", stripJats(record.abstract));

    const doi = normalizeDoi(record.DOI);
    write("doi", doi);
    // The registry's own URL when it gives one, otherwise the canonical form
    // derived from the DOI. Never anything else.
    write("url", first(record.URL) || doiUtil.canonicalUrl(doi));

    if (Array.isArray(record.author) && record.author.length) {
      method("authors", doiUtil.formatNames(record.author));
    }
  },
  formatNames: (authors) => {
    const names = authors.map((author) => {
      return `${author.given} ${author.family}`;
    });
    return namesUtil.get(names.join(", "));
  },
};

export { doiUtil, DOI_PATTERN, normalizeDoi };
