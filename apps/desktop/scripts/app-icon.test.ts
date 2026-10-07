import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { color } from '@agent-lanes/tokens';
import { ICON_SIZES, buildResourcesDir, renderLogoMark, type RgbaImage } from './app-icon.mjs';

interface IcoEntry {
  size: number;
  data: Buffer;
}

function readIco(file: Buffer): IcoEntry[] {
  expect(file.readUInt16LE(0)).toBe(0);
  expect(file.readUInt16LE(2)).toBe(1); // icon, not cursor
  const count = file.readUInt16LE(4);

  return Array.from({ length: count }, (_, index) => {
    const at = 6 + index * 16;
    const width = file.readUInt8(at) || 256;
    const height = file.readUInt8(at + 1) || 256;
    expect(height).toBe(width);
    expect(file.readUInt16LE(at + 6)).toBe(32);
    const length = file.readUInt32LE(at + 8);
    const offset = file.readUInt32LE(at + 12);
    expect(offset + length).toBeLessThanOrEqual(file.length);
    return { size: width, data: file.subarray(offset, offset + length) };
  });
}

function decodeEntry(entry: IcoEntry): RgbaImage {
  return entry.data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    ? decodePng(entry.data)
    : decodeBitmap(entry.data, entry.size);
}

/** Decodes the PNGs this generator writes: 8-bit RGBA, filter 0 on every row. */
function decodePng(png: Buffer): RgbaImage {
  const idat: Buffer[] = [];
  let size = 0;
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      size = data.readUInt32BE(0);
      expect(data.readUInt32BE(4)).toBe(size);
      expect([data[8], data[9]]).toEqual([8, 6]);
    }
    if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    expect(raw[y * (size * 4 + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1)), y * size * 4);
  }
  return { size, pixels };
}

function decodeBitmap(bmp: Buffer, size: number): RgbaImage {
  expect(bmp.readUInt32LE(0)).toBe(40);
  expect(bmp.readInt32LE(4)).toBe(size);
  expect(bmp.readInt32LE(8)).toBe(size * 2);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = 40 + ((size - 1 - y) * size + x) * 4;
      const to = (y * size + x) * 4;
      pixels.set([bmp[from + 2] ?? 0, bmp[from + 1] ?? 0, bmp[from] ?? 0, bmp[from + 3] ?? 0], to);
    }
  }
  return { size, pixels };
}

function pixel(image: RgbaImage, x: number, y: number): number[] {
  const at = (y * image.size + x) * 4;
  return Array.from(image.pixels.subarray(at, at + 4));
}

function rgb(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

describe('logo mark', () => {
  const mark = renderLogoMark(256);

  it('is a rounded square: transparent corners, opaque body', () => {
    expect(pixel(mark, 0, 0)[3]).toBe(0);
    expect(pixel(mark, 255, 255)[3]).toBe(0);
    expect(pixel(mark, 20, 20)[3]).toBe(0); // inside the inset, outside the corner radius
    expect(pixel(mark, 128, 40)[3]).toBe(255);
  });

  it('runs from Claude violet at the top-left to Azure DevOps blue at the bottom-right', () => {
    const near = (actual: number[], expected: number[]) =>
      expected.forEach((channel, index) => expect(Math.abs((actual[index] ?? 0) - channel)).toBeLessThanOrEqual(24));

    near(pixel(mark, 48, 48), rgb(color.claude));
    near(pixel(mark, 207, 207), rgb(color.ado));
  });

  it('draws three white lane bars, longest first', () => {
    const rows = [...Array(256).keys()].filter((y) => {
      const [r, g, b] = pixel(mark, 100, y);
      return r === 255 && g === 255 && b === 255;
    });
    const barTops = rows.filter((y, index) => rows[index - 1] !== y - 1);
    expect(barTops).toHaveLength(3);

    const lengths = barTops.map((top) => {
      const y = top + 4;
      return [...Array(256).keys()].filter((x) => pixel(mark, x, y)[0] === 255 && pixel(mark, x, y)[2] === 255).length;
    });
    expect(lengths[0]).toBeGreaterThan(lengths[1] ?? 0);
    expect(lengths[1]).toBeGreaterThan(lengths[2] ?? 0);
  });
});

describe('build/icon.ico', () => {
  const entries = readIco(readFileSync(join(buildResourcesDir, 'icon.ico')));

  it('holds every size, including the 256 px image electron-builder requires', () => {
    expect(entries.map((entry) => entry.size)).toEqual([...ICON_SIZES]);
  });

  it('matches the generator, so the committed icon never drifts from the mark', () => {
    for (const entry of entries) {
      const decoded = decodeEntry(entry);
      expect(decoded.size, `${entry.size} px entry`).toBe(entry.size);
      expect(Buffer.from(decoded.pixels).equals(Buffer.from(renderLogoMark(entry.size).pixels)), `${entry.size} px entry`).toBe(
        true,
      );
    }
  });

  it('ships a matching 256 px PNG preview', () => {
    const preview = decodePng(readFileSync(join(buildResourcesDir, 'icon.png')));
    expect(Buffer.from(preview.pixels).equals(Buffer.from(renderLogoMark(256).pixels))).toBe(true);
  });
});
