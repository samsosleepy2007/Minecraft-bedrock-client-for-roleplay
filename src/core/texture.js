/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import { decode, encode } from 'fast-png';

/** @typedef {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} RGBA */

/** Read PNG size from IHDR without decoding. Returns null when not a PNG. */
export function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47];
  for (let i = 0; i < 4; i++) if (bytes[i] !== sig[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Decode PNG → RGBA8 (pure JS, works in Web Workers and Node). */
export function decodePng(bytes) {
  const img = decode(bytes);
  const { width, height, channels } = img;
  const src = img.data;
  const depth = img.depth || 8;
  const out = new Uint8ClampedArray(width * height * 4);
  const pal = img.palette;
  const scale = depth === 16 ? 1 / 257 : 1;
  for (let p = 0; p < width * height; p++) {
    let r, g, b, a = 255;
    if (pal) {
      const e = pal[src[p]] || [0, 0, 0, 255];
      [r, g, b] = e;
      a = e.length > 3 ? e[3] : 255;
    } else if (channels === 1 || channels === 2) {
      r = g = b = src[p * channels] * scale;
      if (channels === 2) a = src[p * 2 + 1] * scale;
    } else {
      r = src[p * channels] * scale;
      g = src[p * channels + 1] * scale;
      b = src[p * channels + 2] * scale;
      if (channels === 4) a = src[p * 4 + 3] * scale;
    }
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = a;
  }
  return { width, height, data: out };
}

export function encodePng(img) {
  return encode({ width: img.width, height: img.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), channels: 4, depth: 8 });
}

/**
 * Box-filter downscale with alpha-weighted colour (avoids dark fringes).
 * @param {RGBA} img
 * @param {number} scale 1, 0.5, 0.25, 0.125
 * @param {{alphaMode?:'test'|'blend'}} opt alphaMode 'test' thresholds alpha (>=128 → 255 else 0)
 */
export function downscale(img, scale, opt = {}) {
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  const src = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const al = src[i + 3];
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      let alpha = a / n;
      if (opt.alphaMode === 'emissive') {
        // keep the glow mask values (e.g. alpha 10) instead of thresholding them away
        let nz = 0, sum = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          const al = src[(yy * img.width + xx) * 4 + 3];
          if (al > 0) { nz++; sum += al; }
        }
        alpha = nz * 2 >= n ? sum / nz : 0;
      } else if (opt.alphaMode !== 'blend') alpha = alpha >= 128 ? 255 : 0;
      out[o + 3] = alpha;
    }
  }
  return { width: w, height: h, data: out };
}

/** DEBUG tint colours per LOD level (1-based index). */
export const DEBUG_COLORS = [null, [0, 160, 255], [255, 40, 40], [40, 220, 60], [255, 200, 0], [200, 0, 255]];

/** Mix RGB 60% toward colour (alpha untouched). */
export function tint(img, rgb, amount = 0.6) {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * (1 - amount) + rgb[0] * amount;
    d[i + 1] = d[i + 1] * (1 - amount) + rgb[1] * amount;
    d[i + 2] = d[i + 2] * (1 - amount) + rgb[2] * amount;
  }
  return { width: img.width, height: img.height, data: d };
}

/** Approx GPU memory of an RGBA8 texture incl. mipmaps (MB). */
export const textureMB = (w, h) => (w * h * 4 * 1.333) / (1024 * 1024);

/** TGA size from header (uncompressed or RLE true-colour). */
export function tgaSize(bytes) {
  if (!bytes || bytes.length < 18) return null;
  const type = bytes[2];
  if (![2, 3, 10, 11].includes(type)) return null;
  return { width: bytes[12] | (bytes[13] << 8), height: bytes[14] | (bytes[15] << 8) };
}

/** Decode TGA (types 2/10 true-colour 24/32-bit, 3/11 greyscale; RLE supported) → RGBA8. */
export function decodeTga(bytes) {
  const idLen = bytes[0], cmapType = bytes[1], type = bytes[2];
  if (![2, 3, 10, 11].includes(type)) throw new Error(`Unsupported TGA type ${type}`);
  const cmapLen = bytes[5] | (bytes[6] << 8), cmapDepth = bytes[7];
  const width = bytes[12] | (bytes[13] << 8), height = bytes[14] | (bytes[15] << 8);
  const bpp = bytes[16] >> 3, desc = bytes[17];
  const topDown = (desc & 0x20) !== 0, rightToLeft = (desc & 0x10) !== 0;
  let p = 18 + idLen + (cmapType ? cmapLen * Math.ceil(cmapDepth / 8) : 0);
  const n = width * height;
  const px = new Uint8Array(n * bpp);
  if (type === 2 || type === 3) px.set(bytes.subarray(p, p + n * bpp));
  else {
    let o = 0;
    while (o < px.length && p < bytes.length) {
      const h = bytes[p++];
      const count = (h & 0x7f) + 1;
      if (h & 0x80) {
        for (let k = 0; k < count; k++) for (let c = 0; c < bpp; c++) px[o++] = bytes[p + c];
        p += bpp;
      } else {
        px.set(bytes.subarray(p, p + count * bpp), o);
        o += count * bpp;
        p += count * bpp;
      }
    }
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < height; y++) {
    const sy = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sx = rightToLeft ? width - 1 - x : x;
      const i = (sy * width + sx) * bpp, o = (y * width + x) * 4;
      if (bpp === 1 || bpp === 2) {
        out[o] = out[o + 1] = out[o + 2] = px[i];
        out[o + 3] = bpp === 2 ? px[i + 1] : 255;
      } else {
        out[o] = px[i + 2];
        out[o + 1] = px[i + 1];
        out[o + 2] = px[i];
        out[o + 3] = bpp === 4 ? px[i + 3] : 255;
      }
    }
  }
  return { width, height, data: out };
}

/** Decode PNG or TGA by file extension. */
export const decodeImage = (bytes, path = '') => (/\.tga$/i.test(path) ? decodeTga(bytes) : decodePng(bytes));
export const imageSize = (bytes, path = '') => (/\.tga$/i.test(path) ? tgaSize(bytes) : pngSize(bytes));
export const canDecode = (path = '') => /\.(png|tga)$/i.test(path);

/**
 * Emissive textures keep the glow mask in alpha (low alpha = glow). When glow is switched off for a
 * level the material becomes alpha-test, so make every non-transparent pixel solid (no holes).
 * @param {boolean} cutout material keeps transparency (…emissive_alpha) → alpha 0 stays transparent
 */
export function flattenGlow(img, cutout = true) {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 0 || !cutout ? 255 : 0;
  return { width: img.width, height: img.height, data: d };
}
