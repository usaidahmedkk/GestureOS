/**
 * @file core/state.js
 * The single mutable object in the app. Everything else imports it, reads from
 * it, and mutates it only through {@link setState} so subscribers stay honest.
 * There are no other globals — modules receive what they need through their
 * init context.
 */

/**
 * @typedef {'NONE'|'OPEN_HAND'|'FIST'|'PINCH'|'POINT'|'PEACE'|'THUMBS_UP'|'GRAB'} GestureName
 */

/**
 * @typedef {Object} GestureReading
 * @property {GestureName} name Stable gesture after hysteresis.
 * @property {GestureName} raw This frame's unfiltered classification.
 * @property {number} confidence [0,1] for the stable gesture.
 * @property {number} held Frames the raw gesture has repeated.
 * @property {number} progress [0,1] toward the hold threshold — drives the HUD meter.
 */

/**
 * @typedef {Object} HandFrame
 * @property {'Left'|'Right'} handedness User's actual hand (mirror-corrected).
 * @property {Array<{x: number, y: number, z: number}>} landmarks Smoothed, normalized, mirrored.
 * @property {Array<{x: number, y: number}>} pixels Screen-space landmarks (cover-aware).
 * @property {GestureReading} gesture
 * @property {{distance: number, strength: number, x: number, y: number}} pinch
 *   Thumb-tip↔index-tip distance in hand-span units, a [0,1] strength, and the
 *   normalized midpoint between the two tips.
 * @property {number} span Hand scale reference (wrist→middle MCP).
 * @property {{minX: number, minY: number, maxX: number, maxY: number, w: number, h: number, cx: number, cy: number}} bounds
 * @property {boolean[]} extended Per-finger extension flags [thumb…pinky].
 * @property {number} score MediaPipe's handedness score.
 */

/**
 * Live application state.
 * @type {{
 *   activeModule: string,
 *   gestures: {Left: GestureReading, Right: GestureReading},
 *   handedness: Array<'Left'|'Right'>,
 *   hands: {Left: HandFrame|null, Right: HandFrame|null},
 *   fps: number,
 *   isTracking: boolean,
 *   ready: boolean,
 *   smoothingAlpha: number,
 *   holdFrames: number,
 *   lastError: string|null
 * }}
 */
export const state = {
  /** Id of the module currently mounted. */
  activeModule: 'volume',

  /** Latest gesture reading per hand. Always present, `NONE` when absent. */
  gestures: {
    Left: emptyGesture(),
    Right: emptyGesture(),
  },

  /** Hands visible this frame, e.g. `['Right']`. */
  handedness: [],

  /** Full per-hand frame data, or null when that hand is not visible. */
  hands: { Left: null, Right: null },

  /** Smoothed frames per second of the render loop. */
  fps: 0,

  /** True while at least one hand is being tracked. */
  isTracking: false,

  /** True once camera + model are live and the splash has been dismissed. */
  ready: false,

  /** EMA responsiveness for landmarks. */
  smoothingAlpha: 0.6,

  /** Frames a gesture must repeat before it becomes stable. */
  holdFrames: 4,

  /** Last user-facing error message, if any. */
  lastError: null,
};

/**
 * A gesture reading for a hand that is not doing anything.
 * @returns {GestureReading}
 */
export function emptyGesture() {
  return { name: 'NONE', raw: 'NONE', confidence: 0, held: 0, progress: 0 };
}

/** @type {Map<string, Set<Function>>} */
const watchers = new Map();

/**
 * Merge a patch into state and notify watchers of the changed keys.
 * Shallow by design — nested objects are replaced, not merged.
 * @param {Partial<typeof state>} patch
 * @returns {void}
 */
export function setState(patch) {
  const changed = [];
  for (const key of Object.keys(patch)) {
    if (state[key] !== patch[key]) changed.push(key);
    state[key] = patch[key];
  }
  for (const key of changed) notify(key);
}

/**
 * Watch one or more state keys. The callback fires with the whole state object.
 * @param {string|string[]} keys
 * @param {(s: typeof state, key: string) => void} fn
 * @returns {() => void} Unsubscribe.
 */
export function subscribe(keys, fn) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    if (!watchers.has(key)) watchers.set(key, new Set());
    watchers.get(key).add(fn);
  }
  return () => {
    for (const key of list) watchers.get(key)?.delete(fn);
  };
}

/**
 * Fire watchers for one key. Errors in a watcher are contained so one broken
 * HUD element cannot kill the render loop.
 * @param {string} key
 * @returns {void}
 */
function notify(key) {
  const set = watchers.get(key);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(state, key);
    } catch (err) {
      console.error(`[state] watcher for "${key}" threw:`, err);
    }
  }
}

/**
 * Clear all hand tracking data — used when tracking is lost or the camera stops.
 * @returns {void}
 */
export function clearHands() {
  state.hands.Left = null;
  state.hands.Right = null;
  state.gestures.Left = emptyGesture();
  state.gestures.Right = emptyGesture();
  setState({ handedness: [], isTracking: false });
}

/**
 * Convenience reader.
 * @param {'Left'|'Right'} side
 * @returns {HandFrame|null}
 */
export function getHand(side) {
  return state.hands[side];
}

/**
 * The visible hand, preferring `side`, falling back to the other. Modules that
 * work one-handed use this so they stay usable if only one hand is up.
 * @param {'Left'|'Right'} [side='Right']
 * @returns {HandFrame|null}
 */
export function anyHand(side = 'Right') {
  return state.hands[side] || state.hands[side === 'Right' ? 'Left' : 'Right'];
}

/**
 * Minimal event bus for things that are events rather than state: "switch to
 * the drawing module", "show a toast". Keeps modules from importing each other.
 */
class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  /**
   * @param {string} type
   * @param {(detail: any) => void} fn
   * @returns {() => void} Unsubscribe.
   */
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  /**
   * @param {string} type
   * @param {Function} fn
   * @returns {void}
   */
  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }

  /**
   * @param {string} type
   * @param {any} [detail]
   * @returns {void}
   */
  emit(type, detail) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(detail);
      } catch (err) {
        console.error(`[bus] handler for "${type}" threw:`, err);
      }
    }
  }
}

/** Shared bus instance. @type {EventBus} */
export const bus = new EventBus();




