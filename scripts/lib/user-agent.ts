import "./load-env";

/**
 * Resolve the HTTP User-Agent for outbound API calls (Wikidata, Wikipedia, …).
 */
export function userAgent(): string {
  const full = (
    process.env.USER_AGENT ??
    process.env.WIKIDATA_USER_AGENT ??
    ""
  ).trim();
  if (full) return full;
  const email = (
    process.env.CONTACT_EMAIL ??
    process.env.ARCHIVA_CONTACT ??
    ""
  ).trim();
  const contact = email ? `; contact: ${email}` : "";
  return `vetustas-archiva/1.0 (https://vetustas.net${contact})`;
}
