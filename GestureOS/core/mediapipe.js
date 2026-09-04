/**
 * @file core/mediapipe.js
 * Wraps MediaPipe Hands (legacy solution, pinned) behind a small async API and
 * normalizes its output for the rest of the app.
 *
 * Two corrections happen here so that nothing downstream has to think about them:
 *
 * 1. Mirroring. The feed is displayed as a selfie view (`transform: scaleX(-1)`),
 *    but the model receives the un-flipped frame, so landmark x is flipped here
 *    (`x → 1 - x`). Doing it in JS rather than mirroring the overlay canvas keeps
 *    overlay text readable.
 * 2. Handedness. MediaPipe documents its Left/Right labels as being assigned on
 *    the assumption that the input is already mirrored. It is not, so the labels
 *    are swapped here to match the user's actual hands.
 */

/** Pinned to the build already proven on this machine. @type {string} */
const HANDS_VERSION = '0.4.1675469240';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}`;

/** MediaPipe's own handedness labels, and what they mean for a real hand. */
const SWAP = { Left: 'Right', Right: 'Left' };

/**
 * Load a classic script once and resolve when it has executed. The legacy
 * MediaPipe bundle is a global-scope script, not an ES module, so it cannot be
 * `import`ed.
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.crossOrigin = 'anonymous';
    el.async = true;
    el.addEventListener('load', () => {
      el.dataset.loaded = '1';
      resolve();
    }, { once: true });
    el.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(el);
  });
}

/**
 * @typedef {Object} RawHand
 * @property {'Left'|'Right'} handedness Mirror-corrected.
 * @property {number} score MediaPipe's classification score.
 * @property {Array<{x: number, y: number, z: number}>} landmarks Mirrored, normalized.
 */

/**
 * Hand tracker. One instance per app.
 */
export class HandTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxNumHands=2]
   * @param {number} [options.modelComplexity=1] 0 is faster but noticeably looser.
   * @param {number} [options.minDetectionConfidence=0.6]
   * @param {number} [options.minTrackingConfidence=0.6]
   */
  constructor(options = {}) {
    /** @type {Required<{maxNumHands: number, modelComplexity: number, minDetectionConfidence: number, minTrackingConfidence: number}>} */
    this.options = {
      maxNumHands: options.maxNumHands ?? 2,
      modelComplexity: options.modelComplexity ?? 1,
      minDetectionConfidence: options.minDetectionConfidence ?? 0.6,
      minTrackingConfidence: options.minTrackingConfidence ?? 0.6,
    };

    /** @type {any} The MediaPipe `Hands` instance. */
    this.hands = null;
    /** @type {(hands: RawHand[]) => void} */
    this.onHands = () => {};
    /** @type {boolean} True while a frame is in flight. */
    this.busy = false;
    /** @type {boolean} */
    this.ready = false;
    /** @type {boolean} */
    this.closed = false;
    /** @type {number} Frames successfully processed. */
    this.frameCount = 0;
  }

  /**
   * Download the solution bundle, construct the graph and warm it up.
   * @param {Object} [hooks]
   * @param {(hands: RawHand[]) => void} [hooks.onHands] Called once per processed frame.
   * @param {(step: string) => void} [hooks.onProgress] Human-readable load steps.
   * @returns {Promise<void>}
   * @throws {Error} With a message suitable for the error banner.
   */
  async init({ onHands, onProgress } = {}) {
    if (onHands) this.onHands = onHands;
    const report = onProgress ?? (() => {});

    report('Downloading hand model');
    try {
      await loadScript(`${CDN_BASE}/hands.min.js`);
    } catch {
      throw new Error(
        'Could not download the MediaPipe hand model. Check your internet connection and reload — the model is fetched from a CDN on first run.'
      );
    }

    const Hands = globalThis.Hands;
    if (typeof Hands !== 'function') {
      throw new Error('The MediaPipe bundle loaded but did not register itself. Hard-reload the page (Ctrl+Shift+R).');
    }

    report('Building tracking graph');
    try {
      this.hands = new Hands({
        // Every wasm/tflite asset must come from the same pinned version.
        locateFile: (file) => `${CDN_BASE}/${file}`,
      });
      this.hands.setOptions({
        selfieMode: false, // mirroring is handled in this file, see header
        maxNumHands: this.options.maxNumHands,
        modelComplexity: this.options.modelComplexity,
        minDetectionConfidence: this.options.minDetectionConfidence,
        minTrackingConfidence: this.options.minTrackingConfidence,
      });
      this.hands.onResults((results) => this.#handleResults(results));
    } catch (err) {
      throw new Error(`The hand tracker failed to initialize: ${err?.message ?? err}`);
    }

    report('Warming up model');
    this.ready = true;
  }

/* @@TAIL@@ */
}


