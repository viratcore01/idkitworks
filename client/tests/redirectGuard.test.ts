import test from 'node:test';
import assert from 'node:assert/strict';
import { recordNavigation, cycleTripped, resetCycleGuard } from '../src/utils/redirectGuard';

/**
 * The breaker must catch REAL loops (the same path revisited again and again —
 * guards ping-ponging a user between routes) and must NOT trip on legitimate
 * boot chains, which traverse several guarded routes in one render pass but
 * never revisit.
 */
test('a real loop trips the guard: same path revisited 3+ times', () => {
  resetCycleGuard();
  for (let i = 0; i < 3; i++) {
    recordNavigation('/signup');
  }
  assert.equal(cycleTripped(), true);
});

test('legitimate boot chains never trip it: paths stay distinct', () => {
  resetCycleGuard();
  // A worst-case legitimate boot: several guards place the user in one pass.
  for (const p of ['/', '/login', '/signup', '/home', '/setup-profile', '/setup-password']) {
    recordNavigation(p);
    assert.equal(cycleTripped(), false, `tripped after navigating to ${p}`);
  }
});

test('a path revisited once (back-then-forward) does not trip it', () => {
  resetCycleGuard();
  recordNavigation('/signup');
  recordNavigation('/home');
  recordNavigation('/signup'); // revisit #2 — a real loop needs 3+ visits
  assert.equal(cycleTripped(), false);
});

test('visits outside the 3s window are forgotten (user returns later)', () => {
  resetCycleGuard();
  const realNow = Date.now;
  try {
    let t = 1_000_000;
    Date.now = () => t;
    recordNavigation('/signup');
    recordNavigation('/signup');
    t += 10_000; // far past the 3s window — the earlier visits expire
    recordNavigation('/signup');
    assert.equal(cycleTripped(), false);
  } finally {
    Date.now = realNow;
  }
});

test('the trip auto-expires after 10s (guards get a second chance)', () => {
  resetCycleGuard();
  const realNow = Date.now;
  try {
    let t = 2_000_000;
    Date.now = () => t;
    for (let i = 0; i < 3; i++) recordNavigation('/home');
    assert.equal(cycleTripped(), true);
    t += 11_000;
    assert.equal(cycleTripped(), false);
  } finally {
    Date.now = realNow;
  }
});
