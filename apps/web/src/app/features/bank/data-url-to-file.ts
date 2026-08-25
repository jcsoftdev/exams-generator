/**
 * Turns a `data:` URL from the extraction response into a `File` the upload
 * endpoints accept. The crops arrive inline precisely so nothing is persisted
 * until the teacher saves — this is where they become uploadable bytes.
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, payload] = dataUrl.split(',');
  const mime = header?.match(/^data:([^;]+);base64$/)?.[1];
  if (!mime || payload === undefined) {
    throw new Error(`Not a base64 data URL: ${dataUrl.slice(0, 32)}…`);
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}
