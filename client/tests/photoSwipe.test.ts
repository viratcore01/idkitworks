import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePhotoSwipe, PHOTO_SWIPE_THRESHOLD_PX } from '../src/utils/photoSwipe';

/**
 * The deck carousel's swipe math, pinned without a DOM: which finger
 * movements flip the photo, and — critically for phone browsers — which ones
 * must NOT (page scrolls and taps).
 */

test('a clear left swipe goes next, a clear right swipe goes prev', () => {
  assert.equal(decidePhotoSwipe(200, 300, 100, 300), 'next');
  assert.equal(decidePhotoSwipe(100, 300, 200, 300), 'prev');
});

test('swipes shorter than the threshold do nothing (taps, shaky holds)', () => {
  const t = PHOTO_SWIPE_THRESHOLD_PX;
  assert.equal(decidePhotoSwipe(100, 100, 100 + t - 1, 100), null);
  assert.equal(decidePhotoSwipe(100, 100, 100 - (t - 1), 100), null);
  assert.equal(decidePhotoSwipe(100, 100, 100, 100), null);
});

test('exactly the threshold counts as intentional', () => {
  const t = PHOTO_SWIPE_THRESHOLD_PX;
  assert.equal(decidePhotoSwipe(100, 100, 100 - t, 100), 'next');
  assert.equal(decidePhotoSwipe(100, 100, 100 + t, 100), 'prev');
});

test('vertical-dominant movement never flips (page scroll wins on mobile)', () => {
  // Straight vertical scroll, however long.
  assert.equal(decidePhotoSwipe(100, 100, 100, 400), null);
  assert.equal(decidePhotoSwipe(100, 400, 100, 100), null);
  // Diagonal past the threshold both ways: vertical component decides.
  assert.equal(decidePhotoSwipe(100, 100, 0, 0), null);
  assert.equal(decidePhotoSwipe(100, 100, 220, 240), null);
});

test('a mostly-horizontal diagonal still flips the photo', () => {
  assert.equal(decidePhotoSwipe(200, 300, 100, 320), 'next');
  assert.equal(decidePhotoSwipe(100, 300, 200, 280), 'prev');
});

test('a custom threshold is honored', () => {
  assert.equal(decidePhotoSwipe(100, 100, 120, 100, 30), null);
  assert.equal(decidePhotoSwipe(100, 100, 60, 100, 30), 'next');
});
