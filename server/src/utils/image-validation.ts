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
