/**
 * @file utils/smoothing.js
 * Exponential Moving Average filters. MediaPipe landmarks jitter by 1–3 px even
 * on a perfectly still hand, which is enough to make air-drawing look scribbled
 * and value dials twitch. EMA is one multiply-add per axis per landmark — cheap
 * enough to run on all 21 points every frame.
 *
 *   s[n] = alpha * x[n] + (1 - alpha) * s[n-1]
 *
 * alpha 1.0 = raw input, 0.0 = frozen. 0.6 is the tuned default: visually
 * instant while removing most of the shimmer.
 */

import { clamp } from './math.js';

/** Number of landmarks MediaPipe Hands returns per hand. @type {number} */
export const LANDMARK_COUNT = 21;

/**
 * Smooths a full 21-landmark hand, per axis, in place on a reusable buffer.
 * One instance per tracked hand — sharing one across hands would blend them.
 */
export class LandmarkSmoother {
  /**
   * @param {number} [alpha=0.6] Responsiveness in (0,1].
   */
  constructor(alpha = 0.6) {
    /** @type {number} */
    this.alpha = clamp(alpha, 0.01, 1);
    /** @type {Array<{x: number, y: number, z: number}>|null} */
    this.state = null;
    /** @type {number} Frames fed since the last reset. */
    this.frames = 0;
  }

  /**
   * Change responsiveness at runtime (the debug panel and modules that need
   * extra stability, like drawing, nudge this).
   * @param {number} alpha
   * @returns {void}
   */
  setAlpha(alpha) {
    this.alpha = clamp(alpha, 0.01, 1);
  }

  /**
   * Feed one frame of raw landmarks.
   * @param {Array<{x: number, y: number, z?: number}>} landmarks Raw, length 21.
   * @returns {Array<{x: number, y: number, z: number}>} Smoothed landmarks. The
   *   same array instance is returned every frame — copy it if you need to keep
   *   a snapshot beyond the current frame.
   */
  filter(landmarks) {
    const a = this.alpha;
    const inv = 1 - a;

    if (!this.state) {
      // Seed from the first frame so there is no ramp-in from origin.
      this.state = landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
      this.frames = 1;
      return this.state;
    }

    const s = this.state;
    const n = Math.min(s.length, landmarks.length);
    for (let i = 0; i < n; i += 1) {
      const p = landmarks[i];
      const q = s[i];
      q.x = a * p.x + inv * q.x;
      q.y = a * p.y + inv * q.y;
      q.z = a * (p.z ?? 0) + inv * q.z;
    }
    this.frames += 1;
    return s;
  }

  /**
   * Drop history. Call when a hand leaves the frame, otherwise the next hand to
   * appear visibly lerps in from wherever the old one was.
   * @returns {void}
   */
  reset() {
    this.state = null;
    this.frames = 0;
  }
}

/**
 * Single-value EMA. Used for module values (volume, zoom, rotation) so they
 * ease instead of snapping.
 */
export class ScalarEMA {
  /**
   * @param {number} [alpha=0.25] Lower than the landmark default: these values
   *   are user-facing and benefit from feeling weighted.
   * @param {number|null} [initial=null] Seed value, or null to seed on first sample.
   */
  constructor(alpha = 0.25, initial = null) {
    /** @type {number} */
    this.alpha = clamp(alpha, 0.001, 1);
    /** @type {number|null} */
    this.value = initial;
  }

  /**
   * Feed a sample.
   * @param {number} v
   * @returns {number} The smoothed value.
   */
  next(v) {
    this.value = this.value === null ? v : this.alpha * v + (1 - this.alpha) * this.value;
    return this.value;
  }

  /**
   * Force the value, skipping the ramp (used on module reset).
   * @param {number|null} v
   * @returns {void}
   */
  set(v) {
    this.value = v;
  }

  /**
   * Current value without feeding a sample.
   * @param {number} [fallback=0]
   * @returns {number}
   */
  get(fallback = 0) {
    return this.value === null ? fallback : this.value;
  }
}

/**
 * Keeps one {@link LandmarkSmoother} per hand key and disposes filters for
 * hands that stop being reported, so history never leaks across appearances.
 */
export class SmootherPool {
  /**
   * @param {number} [alpha=0.6]
   */
  constructor(alpha = 0.6) {
    /** @type {number} */
    this.alpha = alpha;
    /** @type {Map<string, LandmarkSmoother>} */
    this.pool = new Map();
  }

  /**
   * Smooth one hand's landmarks.
   * @param {string} key Stable per-hand key, e.g. 'Left' / 'Right'.
   * @param {Array<{x: number, y: number, z?: number}>} landmarks
   * @returns {Array<{x: number, y: number, z: number}>}
   */
  filter(key, landmarks) {
    let f = this.pool.get(key);
    if (!f) {
      f = new LandmarkSmoother(this.alpha);
      this.pool.set(key, f);
    }
    return f.filter(landmarks);
  }

  /**
   * Reset every key not present in `activeKeys`.
   * @param {Iterable<string>} activeKeys
   * @returns {void}
   */
  retain(activeKeys) {
    const keep = new Set(activeKeys);
    for (const [key, f] of this.pool) {
      if (!keep.has(key)) {
        f.reset();
        this.pool.delete(key);
      }
    }
  }

  /**
   * Apply a new alpha to existing and future filters.
   * @param {number} alpha
   * @returns {void}
   */
  setAlpha(alpha) {
    this.alpha = alpha;
    for (const f of this.pool.values()) f.setAlpha(alpha);
  }

  /** @returns {void} */
  clear() {
    for (const f of this.pool.values()) f.reset();
    this.pool.clear();
  }
}



}
