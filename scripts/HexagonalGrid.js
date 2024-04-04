/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for HexagonalGrid class
import { log } from "./util.js";

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
//   const dest = new PIXI.Point(Math.round(ray.B.x + offset.x), Math.round(ray.B.y + offset.y));
//   return dest.add(hexOffset(token), dest).roundDecimals();
  const recalculatedOffset = canvas.controls.ruler._recalculatedOffset;
  log(`Offsetting destination for ${_token.name}`, { dest: ray.B, offset, recalculatedOffset });
  return ray.B.add(recalculatedOffset).roundDecimals();
//   return {
//     x: Math.round(ray.B.x + recalculatedOffset.x),
//     y: Math.round(ray.B.y + recalculatedOffset.y)
//   };
}

PATCHES.BASIC.OVERRIDES = { _getRulerDestination };

function hexOffset(token) {
  const d = canvas.scene.dimensions;
  const incr = d.size * 0.25;
  const tmp = new PIXI.Point();


  const orig = new PIXI.Point(...canvas.grid.getCenter(incr, incr));
  const dest = new PIXI.Point(...canvas.grid.getCenter(incr * 5, incr * 5));

  // Token.document.x is the top left corner given a center point of orig.
  const tTL = new PIXI.Point(...canvas.grid.grid.getTopLeft(orig.x, orig.y))


  const s2 = d.size * 0.5;
  const delta = tTL.subtract(orig, tmp).multiplyScalar(1/s2, tmp).roundDecimals().multiplyScalar(s2, tmp)
  const adjDest = dest.add(delta, dest);

  const tokenCenter = adjDest.add(new PIXI.Point(token.w * 0.5, token.h * 0.5), adjDest);
  const actualCenter = new PIXI.Point(...canvas.grid.grid.getCenter(tokenCenter.x, tokenCenter.y))
  return tokenCenter.subtract(actualCenter, tmp).roundDecimals();
}
