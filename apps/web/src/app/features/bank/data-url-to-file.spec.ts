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

  it('throws on a data URL that is not base64-encoded', () => {
    expect(() => dataUrlToFile('data:image/png,not-base64', 'x.png')).toThrow();
  });
});
