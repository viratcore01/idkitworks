/**
 * Magic-byte validation for image uploads. Never trust `Content-Type` /
 * multer `mimetype` alone — both are client-controlled. A renamed .exe or
 * polyglot stored as Postgres bytes and served with an image Content-Type
 * is a stored-content attack; reject it at the door.
 */
export function isPlausibleImage(buffer: Buffer, claimedMime: string): boolean {
  if (!buffer || buffer.length < 12) return false;
  const b = buffer;
  if (claimedMime === 'image/png') {
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  }
  if (claimedMime === 'image/jpeg') {
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }
  if (claimedMime === 'image/gif') {
    return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
  }
  if (claimedMime === 'image/webp') {
    // RIFF....WEBP
    return (
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    );
  }
  if (claimedMime === 'image/heic' || claimedMime === 'image/heif') {
    // ISO-BMFF: [size][ftyp] within the first 12 bytes
    const head = b.subarray(0, 12).toString('ascii');
    return head.includes('ftyp');
  }
  return false;
}

/**
 * Dependency-free dimension probe: reads width/height straight from image
 * headers (PNG IHDR, JPEG SOF, GIF descriptor, WebP VP8/VP8L). Returns null
 * when the format can't be probed (HEIC) or headers are corrupt.
 *
 * WHY: the app once shipped postage-stamp exports that browsers upscaled
 * into blur. The editor is fixed, but the API must also refuse tiny uploads
 * outright — a 96px "photo" can never look sharp on a 400px deck card.
 */
export function imageDimensions(buffer: Buffer, mime: string): { w: number; h: number } | null {
  try {
    const b = buffer;
    if (mime === 'image/png') {
      if (b.length < 24) return null;
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    if (mime === 'image/gif') {
      if (b.length < 10) return null;
      return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    }
    if (mime === 'image/webp') {
      if (b.length < 30) return null;
      // Lossy VP8: 14-byte frame tag at 20, width/height 14-bit at 26/28.
      if (b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x20) {
        return { w: ((b[27] << 8) | b[26]) & 16383, h: ((b[29] << 8) | b[28]) & 16383 };
      }
      // Lossless VP8L: 1 signature byte + 14+14+1+1 bits packed at 21-24.
      if (b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x4c) {
        return {
          w: 1 + (b[21] | (b[22] << 8) | ((b[23] & 63) << 16)),
          h: 1 + (b[25] | ((b[23] & 192) << 2) | (b[24] << 8)),
        };
      }
      return null;
    }
    if (mime === 'image/jpeg') {
      let o = 2;
      while (o < b.length - 8) {
        if (b[o] !== 0xff) return null;
        const m = b[o + 1];
        // SOF0-SOF3 carry the frame dimensions.
        if (m >= 0xc0 && m <= 0xc3) {
          return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5) };
        }
        // Standalone markers have no length field — skip the 2-byte marker.
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { o += 2; continue; }
        o += 2 + b.readUInt16BE(o + 2);
      }
      return null;
    }
    return null; // HEIC and friends: magic bytes only, no probe.
  } catch {
    return null;
  }
}

/** Minimum long side, px. Deck cards render ~400px wide; anything smaller
 * upscales into blur. Matches Instagram's own 320px minimum philosophy,
 * raised to our largest surface. */
export const MIN_PHOTO_LONG_SIDE = 400;
/** ID documents must stay legible to a human moderator after review. */
export const MIN_ID_LONG_SIDE = 600;
