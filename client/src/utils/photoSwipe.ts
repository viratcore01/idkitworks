/**
 * Photo-carousel swipe math (deck cards, profile photos — anywhere one finger
 * moves through pictures).
 *
 * The rule, tuned for phone browsers:
 * - Horizontal travel past the threshold flips the photo (left = next).
 * - Anything vertical-dominant is a PAGE SCROLL, never a photo flip — the
 *   handler must not preventDefault it, or the page locks up on mobile.
 * - Sub-threshold jitter (taps, shaky holds) does nothing.
 *
 * Pure on purpose: the component feeds it touch coordinates, the tests pin
 * every branch without a DOM.
 */

/** Minimum horizontal travel (px) that counts as an intentional swipe. */
export const PHOTO_SWIPE_THRESHOLD_PX = 40;

export type PhotoSwipeDirection = 'next' | 'prev';

export function decidePhotoSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold: number = PHOTO_SWIPE_THRESHOLD_PX,
): PhotoSwipeDirection | null {
  const dx = endX - startX;
  const dy = endY - startY;
  // Too short to be intentional — taps and shaky holds stay on this photo.
  if (Math.abs(dx) < threshold) return null;
  // Vertical-dominant movement belongs to the page scroll, even when it
  // crosses the threshold diagonally.
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}
