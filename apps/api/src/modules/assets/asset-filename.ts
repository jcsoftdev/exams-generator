/**
 * What a basename may contain to be echoed into a `Content-Disposition`
 * header as-is: printable ASCII only, minus the quote and backslash that
 * would escape the quoted string, and minus the path separators.
 *
 * ASCII-only on purpose. HTTP header values are ISO-8859-1, so a UTF-8 name
 * ("Examen Área II.pdf") needs the RFC 6266 `filename*=UTF-8''…` form to
 * survive, and browsers disagree about the plain form. Every key this serves
 * today is ASCII (`exam.pdf`, `answer-key.pdf` — see
 * `exam-generation.service.ts`); anything else takes the fallback rather than
 * gambling on the wire format.
 */
const SAFE_BASENAME = /^[A-Za-z0-9 ._()-]+$/;

/**
 * Filename a downloaded PDF asset should be saved under, derived from its
 * `storage_key`.
 *
 * `assets` has no display-name column, and `GET /assets/:id` used to send
 * `Content-Disposition: inline` with no filename at all — so hitting the URL
 * directly saved the URL's last segment: a bare uuid with no extension.
 * `exam-generation.service.ts` already builds meaningful keys
 * (`exams/<id>/versions/A/exam.pdf`), so its basename is the honest name.
 *
 * Falls back to `<assetId>.pdf` whenever the basename cannot be trusted or
 * does not already end in `.pdf` — the name's extension must match the
 * `application/pdf` we serve, and a value we cannot vouch for must never
 * reach a response header. `storage_key` is a plain `text` column with no
 * constraint, so this never assumes the server built it.
 */
export function pdfDownloadFilename(storageKey: string, assetId: string): string {
  const fallback = `${assetId}.pdf`;
  const basename = storageKey.split("/").pop()?.trim() ?? "";

  if (!SAFE_BASENAME.test(basename)) {
    return fallback;
  }
  if (basename.toLowerCase() === ".pdf" || !basename.toLowerCase().endsWith(".pdf")) {
    return fallback;
  }
  return basename;
}
