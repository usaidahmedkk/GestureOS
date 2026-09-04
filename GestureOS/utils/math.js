/**
 * @file utils/math.js
 * Small, allocation-conscious vector + geometry helpers shared by the tracker,
 * the AR overlay and every feature module. Landmarks are MediaPipe-shaped:
 * `{ x, y, z }` with x/y normalized to [0,1] and z roughly in wrist units.
 */

/** Guard against divide-by-zero in normalization paths. @type {number} */
export const EPS = 1e-6;

/* -------------------------------------------------------------------------- */
/* Scalars                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Constrain a value to an inclusive range.
 * @param {number} v
 * @param {number} [min=0]
 * @param {number} [max=1]
 * @returns {number}
 */
export function clamp(v, min = 0, max = 1) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Linear interpolation.
 * @param {number} a Start value.
 * @param {number} b End value.
 * @param {number} t Fraction, normally [0,1] (not clamped).
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Inverse lerp — where does `v` sit between `a` and `b`?
 * @param {number} a
 * @param {number} b
 * @param {number} v
 * @returns {number} Clamped to [0,1].
 */
export function invLerp(a, b, v) {
  return clamp((v - a) / (b - a || EPS), 0, 1);
}

/**
 * Remap a value from one range to another, clamped to the output range.
 * @param {number} v
 * @param {number} inMin
 * @param {number} inMax
 * @param {number} outMin
 * @param {number} outMax
 * @returns {number}
 */
export function mapRange(v, inMin, inMax, outMin, outMax) {
  return lerp(outMin, outMax, invLerp(inMin, inMax, v));
}

/**
 * Cubic ease-out — used for value settling where EMA would feel mushy.
 * @param {number} t Fraction [0,1].
 * @returns {number}
 */
export function easeOutCubic(t) {
  const x = clamp(t, 0, 1) - 1;
  return x * x * x + 1;
}

/**
 * Smooth Hermite step between two edges.
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} v
 * @returns {number}
 */
export function smoothStep(edge0, edge1, v) {
  const t = invLerp(edge0, edge1, v);
  return t * t * (3 - 2 * t);
}

/**
 * Round to a fixed number of decimals without string churn.
 * @param {number} v
 * @param {number} [places=2]
 * @returns {number}
 */
export function roundTo(v, places = 2) {
  const p = 10 ** places;
  return Math.round(v * p) / p;
}

/* -------------------------------------------------------------------------- */
/* Vectors                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {{x: number, y: number, z?: number}} Vec
 */

/**
 * 2D distance. Preferred for gesture work: MediaPipe's z is a weak,
 * loosely-scaled depth estimate and adding it mostly adds noise.
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number}
 */
export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * 3D distance including MediaPipe's relative z.
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number}
 */
export function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * Component-wise subtraction (a - b).
 * @param {Vec} a
 * @param {Vec} b
 * @returns {{x: number, y: number, z: number}}
 */
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

/**
 * Component-wise addition.
 * @param {Vec} a
 * @param {Vec} b
 * @returns {{x: number, y: number, z: number}}
 */
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: (a.z ?? 0) + (b.z ?? 0) };
}

/**
 * Uniform scale.
 * @param {Vec} v
 * @param {number} k
 * @returns {{x: number, y: number, z: number}}
 */
export function scale(v, k) {
  return { x: v.x * k, y: v.y * k, z: (v.z ?? 0) * k };
}

/**
 * Vector magnitude.
 * @param {Vec} v
 * @returns {number}
 */
export function length(v) {
  return Math.hypot(v.x, v.y, v.z ?? 0);
}

/**
 * Unit vector. Returns a zero vector when input length is ~0.
 * @param {Vec} v
 * @returns {{x: number, y: number, z: number}}
 */
export function normalize(v) {
  const l = length(v);
  return l < EPS ? { x: 0, y: 0, z: 0 } : scale(v, 1 / l);
}

/**
 * Dot product.
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number}
 */
export function dot(a, b) {
  return a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0);
}

/**
 * Interior angle at `b` formed by a→b→c.
 * @param {Vec} a
 * @param {Vec} b Vertex.
 * @param {Vec} c
 * @returns {number} Degrees in [0,180].
 */
export function angleAt(a, b, c) {
  const u = normalize(sub(a, b));
  const v = normalize(sub(c, b));
  return (Math.acos(clamp(dot(u, v), -1, 1)) * 180) / Math.PI;
}

/**
 * Signed 2D angle of the vector a→b, measured from screen-right, y-down.
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number} Degrees in (-180,180].
 */
export function heading2(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------- */
/* Hand-shaped helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Scale reference for a hand: wrist (0) to middle-finger MCP (9). Every
 * distance threshold in the gesture classifier is divided by this, which is
 * what makes detection work the same near and far from the camera.
 * @param {Vec[]} lm 21 landmarks.
 * @returns {number} Always >= EPS.
 */
export function handSpan(lm) {
  return Math.max(dist2(lm[0], lm[9]), EPS);
}

/**
 * Axis-aligned bounds of a point set.
 * @param {Vec[]} pts
 * @returns {{minX: number, minY: number, maxX: number, maxY: number, w: number, h: number, cx: number, cy: number}}
 */
export function boundsOf(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX, minY, maxX, maxY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * Mean position of a point set.
 * @param {Vec[]} pts
 * @returns {{x: number, y: number}}
 */
export function centroidOf(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = pts.length || 1;
  return { x: x / n, y: y / n };
}

/* -------------------------------------------------------------------------- */
/* object-fit: cover projection                                               */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} CoverTransform
 * @property {number} scale Source→display scale factor.
 * @property {number} offsetX Left inset of the drawn image, in display px.
 * @property {number} offsetY Top inset of the drawn image, in display px.
 * @property {number} width Drawn image width in display px (>= box width).
 * @property {number} height Drawn image height in display px (>= box height).
 */

/**
 * Replicate `object-fit: cover` so overlay geometry lands exactly where the
 * pixel it describes is actually painted. The feed is cropped, not letterboxed,
 * so normalized coords cannot be multiplied by the box size directly.
 * @param {number} sw Source (intrinsic video) width.
 * @param {number} sh Source height.
 * @param {number} dw Display box width.
 * @param {number} dh Display box height.
 * @returns {CoverTransform}
 */
export function computeCoverTransform(sw, sh, dw, dh) {
  if (!sw || !sh) {
    return { scale: 1, offsetX: 0, offsetY: 0, width: dw, height: dh };
  }
  const scale = Math.max(dw / sw, dh / sh);
  const width = sw * scale;
  const height = sh * scale;
  return {
    scale,
    offsetX: (dw - width) / 2,
    offsetY: (dh - height) / 2,
    width,
    height,
  };
}

/**
 * A reusable normalized→screen projector. One instance is created by the app
 * and shared with the overlay and every module, so all of them agree on where
 * a landmark is on screen.
 * @returns {{
 *   set: (sw: number, sh: number, dw: number, dh: number) => void,
 *   project: (nx: number, ny: number, out?: {x: number, y: number}) => {x: number, y: number},
 *   transform: CoverTransform,
 *   box: {w: number, h: number}
 * }}
 */
export function createProjector() {
  let t = computeCoverTransform(0, 0, 0, 0);
  const box = { w: 0, h: 0 };

  return {
    /**
     * Update source and display dimensions. Cheap; call on resize only.
     */
    set(sw, sh, dw, dh) {
      box.w = dw;
      box.h = dh;
      t = computeCoverTransform(sw, sh, dw, dh);
      this.transform = t;
    },

    /**
     * Project normalized coords to display pixels. Pass `out` to avoid
     * allocating in the render loop.
     */
    project(nx, ny, out) {
      const x = t.offsetX + nx * t.width;
      const y = t.offsetY + ny * t.height;
      if (out) {
        out.x = x;
        out.y = y;
        return out;
      }
      return { x, y };
    },

    transform: t,
    box,
  };
}






