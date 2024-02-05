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
  if ( canvas.controls.ruler._unsnap || ray.pathfinding ) return ray.B.add(offset);

  // We are moving from the token center, so add back 1/2 width/height to offset.
  if ( !canvas.controls.ruler._unsnappedOrigin ) {
    offset.x += canvas.scene.dimensions.size * 0.5;
    offset.y += canvas.scene.dimensions.size * 0.5;
  }
  return wrapped(ray, offset, token);
}

PATCHES.BASIC.MIXES = { _getRulerDestination };
