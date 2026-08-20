import { normalizeDoi } from "./doi";

// Where a record came from, for a list that mixes several Qresp nodes.
//
// The Explorer opens on EVERY federated node, so one list can hold a record
// from UChicago beside a record from Duke — and the same paper can be
// published on both. Two jobs follow from that: label each record with its
// node, and show a paper once rather than twice.
//
// Neither job may be done by guessing. The label comes from
// `qresp_server_name` in the federation list (`/api/federation/servers`,
// which the backend builds from the same entries it enforces `?server=`
// against); deriving "UChicago" from a hostname containing `uchicago.edu`
// would be a regex that breaks the moment a node is renamed or two nodes
// share a domain. A node with no name published falls back to its HOST, which
// is still true, never to an invented label.

const trimOrigin = (value) =>
  typeof value === "string" ? value.replace(/\/+$/, "") : "";

/**
 * origin -> short label, from whatever the federation endpoint published.
 * Servers without a name are simply absent; `sourceLabel` handles that.
 */
export const buildServerNames = (servers) => {
  const names = {};
  (Array.isArray(servers) ? servers : []).forEach((entry) => {
    const origin = trimOrigin((entry || {}).qresp_server_url);
    const name = String((entry || {}).qresp_server_name || "").trim();
    if (origin && name) names[origin] = name;
  });
  return names;
};

/**
 * The label shown on a record card. Falls back to the node's HOST — a fact —
 * and finally to the raw string, so a tag is never blank and never invented.
 */
export const sourceLabel = (server, names) => {
  const origin = trimOrigin(server);
  if (!origin) return "";
  const published = (names || {})[origin];
  if (published) return published;
  try {
    return new URL(origin).host;
  } catch (e) {
    return origin;
  }
};

/**
 * The identity two nodes' copies of one paper share.
 *
 * A normalized DOI only. A DOI is assigned by the publisher and is the same
 * string wherever the paper is deposited, which is exactly what makes it safe
 * to merge on. A record with NO DOI is deliberately never merged: titles
 * collide ("Supplementary information"), and showing two different papers as
 * one is a worse failure than showing one paper twice.
 */
export const recordIdentity = (paper) => {
  const doi = normalizeDoi((paper || {})._Search__doi || "").toLowerCase();
  return doi ? `doi:${doi}` : "";
};

/**
 * {server: [record]} -> one flat, de-duplicated list of table rows.
 *
 * Each row's paper carries `_Search__sources`: every node that publishes it,
 * in the order the nodes were searched, each with its origin and its label.
 * A paper on both nodes therefore shows BOTH tags rather than appearing
 * twice.
 *
 * The first node to publish a record wins the fields that are rendered (title,
 * authors, tags) and the link target, so a duplicate cannot silently change
 * what a row says. The order of `servers` decides "first", and that order is
 * the deployment's own: `/explorer` puts `default_server` in front.
 */
export const mergeRecordsByServer = (papersByServer, names, serverOrder) => {
  const papers = papersByServer || {};
  const order =
    Array.isArray(serverOrder) && serverOrder.length
      ? serverOrder.filter((server) => server in papers)
      : Object.keys(papers);
  // A node present in the data but not named in the order must not vanish.
  Object.keys(papers).forEach((server) => {
    if (!order.includes(server)) order.push(server);
  });

  const rows = [];
  const byIdentity = new Map();

  order.forEach((server) => {
    const label = sourceLabel(server, names);
    (papers[server] || []).forEach((paper) => {
      const source = { server, label };
      const identity = recordIdentity(paper);
      const seen = identity ? byIdentity.get(identity) : undefined;
      if (seen) {
        // Same paper, another node. One row, two tags — and no duplicate tag
        // if a node somehow lists the record twice.
        if (!seen.paper._Search__sources.some((s) => s.server === server)) {
          seen.paper._Search__sources.push(source);
        }
        return;
      }
      // `_Search__server` stays the node this copy was read from: it is what
      // the detail-page link carries, and a record's id only resolves on its
      // own server.
      const merged = { ...paper, _Search__server: server, _Search__sources: [source] };
      const row = { paper: merged, year: merged._Search__year };
      rows.push(row);
      if (identity) byIdentity.set(identity, row);
    });
  });

  return rows;
};
