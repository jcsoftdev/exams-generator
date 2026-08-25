import { describe, it, expect } from 'vitest';
import { dataUrlToFile } from './data-url-to-file';

describe('dataUrlToFile', () => {
  it('decodes a base64 data URL into a File with the declared mime type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const base64 = btoa(String.fromCharCode(...bytes));

    const file = dataUrlToFile(`data:image/png;base64,${base64}`, 'figura.png');

    expect(file.name).toBe('figura.png');
    expect(file.type).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it('throws on a data URL missing the ";base64" marker, even when the payload is valid base64', () => {
    // 'YWJjZA==' is valid base64 (decodes cleanly) — the header lacks
    // ';base64', so only the guard's header check rejects this, never
    // `atob` on its own. This is the discriminating case: an input whose
    // payload is base64-alphabet-INVALID (e.g. 'not-base64') would also
    // make `atob` throw by itself, so a test built on that input can't tell
    // a real guard from no guard at all.
    expect(() => dataUrlToFile('data:image/png,YWJjZA==', 'x.png')).toThrow();
  });
});
