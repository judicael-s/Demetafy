export interface FacebookArchiveSummary {
  entryCount: number;
  jsonCount: number;
  taxonomyJsonCount: number;
  messageJsonCount: number;
}

export type FacebookArchiveCompleteness =
  | {
      ok: true;
      taxonomyJsonCount: number;
      messageJsonCount: number;
    }
  | {
      ok: false;
      reason: "missing_taxonomy_json";
      taxonomyJsonCount: 0;
      messageJsonCount: number;
    };

const TAXONOMY_JSON_RE = /^(your_facebook_activity|personal_information|connections|ads_information|preferences|security_and_login_information|logged_information|apps_and_websites_off_of_facebook)\//;
const MESSAGE_JSON_RE = /^your_facebook_activity\/messages\/.+\/message_\d+\.json$/;

/**
 * Cheap metadata-only scan for Facebook DYI exports. Real multi-part Facebook
 * exports often have several media-only zips and exactly one metadata/taxonomy
 * zip; until that taxonomy part is included, parsing would produce false
 * missing-media errors. This deliberately reads names only, never JSON bodies.
 */
export function summarizeFacebookArchiveEntries(entryNames: Iterable<string>): FacebookArchiveSummary {
  const summary: FacebookArchiveSummary = {
    entryCount: 0,
    jsonCount: 0,
    taxonomyJsonCount: 0,
    messageJsonCount: 0,
  };

  for (const name of entryNames) {
    summary.entryCount += 1;
    if (!name.endsWith(".json")) continue;
    summary.jsonCount += 1;
    if (TAXONOMY_JSON_RE.test(name)) summary.taxonomyJsonCount += 1;
    if (MESSAGE_JSON_RE.test(name)) summary.messageJsonCount += 1;
  }

  return summary;
}

export function validateFacebookArchiveCompleteness(
  entryNames: Iterable<string>,
): FacebookArchiveCompleteness {
  const summary = summarizeFacebookArchiveEntries(entryNames);
  if (summary.taxonomyJsonCount === 0) {
    return {
      ok: false,
      reason: "missing_taxonomy_json",
      taxonomyJsonCount: 0,
      messageJsonCount: summary.messageJsonCount,
    };
  }
  return {
    ok: true,
    taxonomyJsonCount: summary.taxonomyJsonCount,
    messageJsonCount: summary.messageJsonCount,
  };
}
