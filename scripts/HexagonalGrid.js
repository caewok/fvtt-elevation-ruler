/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for HexagonalGrid class

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Override BaseGrid.prototype._getRulerDestination.
 * Don't return the top left corner, so that the token stays on the path through
 * waypoints not at the center of the grid.
 * @param {Ray} ray       The ray being moved along.
 * @param {Point} offset  The offset of the ruler's origin relative to the token's position.
 * @param {Token} token   The token placeable being moved.
 * @return {Point}
 */
function _getRulerDestination(ray, offset, _token) {
  return {
    x: Math.round(ray.B.x + offset.x),
    y: Math.round(ray.B.y + offset.y)
  };
}

PATCHES.BASIC.OVERRIDES = { _getRulerDestination };
