/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Ray3d } from "./geometry/3d/Ray3d.js";

// Patches for the GridLayer class
export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Wrap GridLayer.prototype.measureDistances
 * Called by Ruler.prototype._computeDistance
 * If a segment ray has a z-dimension, re-do the segment by projecting the hypotenuse
 * between the ray A and B endpoints in 3d onto the 2d canvas. Use the projected
 * hypotenuse to do the measurement.
 */
function measureDistances(wrapped, segments, options = {}) {
  if ( !segments.length || !(segments[0]?.ray instanceof Ray3d) ) return wrapped(segments, options);

  // Avoid modifying the segment rays.
  const ln = segments.length;
  const origRays = Array(ln);
  for ( let i = 0; i < ln; i += 1 ) {
    const s = segments[i];
    origRays[i] = s.ray;
    s.ray = s.ray.projectOntoCanvas();
  }

  const out = wrapped(segments, options);
  for ( let i = 0; i < ln; i += 1 ) segments[i].ray = origRays[i];
  return out;
}

PATCHES.BASIC.WRAPS = { measureDistances };
