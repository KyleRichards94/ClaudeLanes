/**
 * Draws the Agent Lanes logo mark (board header on artboard 1: a rounded square with a violet → blue
 * diagonal gradient and three left-aligned white lane bars) and packs it into the Windows app icon
 * (ticket AL-007). Run `pnpm --filter @agent-lanes/desktop icon` after changing the mark; it rewrites
 * build/icon.ico (installer, exe, shortcuts) and build/icon.png (256 px preview).
 *
 * No image libraries: the shapes are simple enough to rasterise with supersampling, and Node's zlib
 * covers PNG. Up to 64 px the bars snap to whole pixels so they stay crisp in the taskbar.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { color } from '@agent-lanes/tokens';

/** Sizes in the .ico; Windows picks the nearest for each DPI and surface. */
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

/** Sizes up to this are stored as 32-bit BMP in the .ico (widest compatibility); larger ones as PNG. */
const LARGEST_BMP_ENTRY = 48;

/** The mark on its 32-unit grid, as measured from the 32 px logo on artboard 1. */
const MARK = {
  grid: 32,
  cornerRadius: 8,
  gradientFrom: color.claude,
  gradientTo: color.ado,
  barLeft: 9,
  barLengths: [14, 9, 6],
  barThickness: 2,
  barPitch: 4,
} as const;

export interface RgbaImage {
  size: number;
  /** Straight (not premultiplied) RGBA, row-major, top row first. */
  pixels: Uint8Array;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  radius: number;
}

export function renderLogoMark(size: number): RgbaImage {
  const inset = size >= 24 ? Math.floor(size / 16) : 0;
  const side = size - inset * 2;
  const scale = side / MARK.grid;
  const square: Rect = { x0: inset, y0: inset, x1: inset + side, y1: inset + side, radius: MARK.cornerRadius * scale };
  const bars = barRects(inset, scale, size <= 64, size >= 48);

  const from = hexToRgb(MARK.gradientFrom);
  const to = hexToRgb(MARK.gradientTo);
  const samples = size <= 64 ? 16 : 8;
  const pixels = new Uint8Array(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          if (!insideRoundedRect(square, x, y)) continue;
          covered++;
          if (bars.some((bar) => insideRoundedRect(bar, x, y))) {
            r += 255;
            g += 255;
            b += 255;
          } else {
            // Diagonal gradient: top-left is Claude violet, bottom-right is Azure DevOps blue.
            const t = (x - square.x0 + (y - square.y0)) / (side * 2);
            r += from[0] + (to[0] - from[0]) * t;
            g += from[1] + (to[1] - from[1]) * t;
            b += from[2] + (to[2] - from[2]) * t;
          }
        }
      }
      if (covered === 0) continue;
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(r / covered);
      pixels[offset + 1] = Math.round(g / covered);
      pixels[offset + 2] = Math.round(b / covered);
      pixels[offset + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }

  return { size, pixels };
}

/** The three lane bars. Up to 64 px they snap to whole pixels; from 48 px they have round caps. */
function barRects(inset: number, scale: number, snap: boolean, roundCaps: boolean): Rect[] {
  const centre = inset + (MARK.grid / 2) * scale;
  const thickness = snap ? Math.max(1, Math.round(MARK.barThickness * scale)) : MARK.barThickness * scale;
  const pitch = snap ? Math.max(thickness + 1, Math.round(MARK.barPitch * scale)) : MARK.barPitch * scale;
  const span = pitch * (MARK.barLengths.length - 1) + thickness;
  const top = snap ? Math.round(centre - span / 2) : centre - span / 2;
  const left = snap ? Math.floor(inset + MARK.barLeft * scale) : inset + MARK.barLeft * scale;

  return MARK.barLengths.map((length, index) => {
    const width = snap ? Math.max(thickness, Math.round(length * scale)) : length * scale;
    const y0 = top + pitch * index;
    return { x0: left, y0, x1: left + width, y1: y0 + thickness, radius: roundCaps ? thickness / 2 : 0 };
  });
}

function insideRoundedRect(rect: Rect, x: number, y: number): boolean {
  if (x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1) return false;
  const dx = Math.max(rect.x0 + rect.radius - x, 0, x - (rect.x1 - rect.radius));
  const dy = Math.max(rect.y0 + rect.radius - y, 0, y - (rect.y1 - rect.radius));
  return dx * dx + dy * dy <= rect.radius * rect.radius;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function encodePng(image: RgbaImage): Buffer {
  const { size, pixels } = image;
  // Each scanline starts with filter type 0 (None).
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    Buffer.from(pixels.buffer, pixels.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** A 32-bit BMP icon entry: BITMAPINFOHEADER, BGRA rows bottom-up, then the 1-bit AND mask. */
export function encodeIcoBitmap(image: RgbaImage): Buffer {
  const { size, pixels } = image;
  const maskStride = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + size * size * 4 + maskStride * size);

  out.writeUInt32LE(40, 0); // biSize
  out.writeInt32LE(size, 4); // biWidth
  out.writeInt32LE(size * 2, 8); // biHeight covers colour + mask
  out.writeUInt16LE(1, 12); // biPlanes
  out.writeUInt16LE(32, 14); // biBitCount
  out.writeUInt32LE(size * size * 4 + maskStride * size, 20); // biSizeImage

  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = 40 + (row * size + x) * 4;
      out[to] = pixels[from + 2] ?? 0;
      out[to + 1] = pixels[from + 1] ?? 0;
      out[to + 2] = pixels[from] ?? 0;
      out[to + 3] = pixels[from + 3] ?? 0;
      // Mask bit set = transparent, for consumers that ignore alpha.
      if ((pixels[from + 3] ?? 0) === 0) {
        const maskByte = 40 + size * size * 4 + row * maskStride + (x >> 3);
        out[maskByte] = (out[maskByte] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }

  return out;
}

export function encodeIco(images: readonly RgbaImage[]): Buffer {
  const entries = images.map((image) => ({
    size: image.size,
    data: image.size <= LARGEST_BMP_ENTRY ? encodeIcoBitmap(image) : encodePng(image),
  }));

  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = header.length;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, at); // 0 means 256
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    header.writeUInt8(0, at + 2); // palette size
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(entry.data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, ...entries.map((entry) => entry.data)]);
}

export function buildAppIcon(): { ico: Buffer; png: Buffer } {
  const images = ICON_SIZES.map((size) => renderLogoMark(size));
  const largest = images[images.length - 1];
  if (!largest) throw new Error('No icon sizes');
  return { ico: encodeIco(images), png: encodePng(largest) };
}

export const buildResourcesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');

function main(): void {
  const { ico, png } = buildAppIcon();
  mkdirSync(buildResourcesDir, { recursive: true });
  writeFileSync(join(buildResourcesDir, 'icon.ico'), ico);
  writeFileSync(join(buildResourcesDir, 'icon.png'), png);
  console.log(`Wrote icon.ico (${ICON_SIZES.join(', ')} px) and icon.png to ${buildResourcesDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
