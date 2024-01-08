/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the BaseGrid class
export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Mix BaseGrid.prototype._getRulerDestination
 * If the ruler is not snapped, then return the actual token position, adjusted for token dimensions.
 * @param {Ray} ray       The ray being moved along.
 * @param {Point} offset  The offset of the ruler's origin relative to the token's position.
 * @param {Token} token   The token placeable being moved.
 */
function _getRulerDestination(wrapped, ray, offset, token) {
  if ( canvas.controls.ruler._unsnap ) return ray.B.add(offset);
  return wrapped(ray, offset, token);
}

PATCHES.BASIC.MIXES = { _getRulerDestination };
