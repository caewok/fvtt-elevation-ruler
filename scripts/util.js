/* globals
canvas,
CONST,
game,
PIXI
*/
"use strict";

import { MODULE_ID } from "./const.js";

export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(e) {
    // Empty
  }
}

/**
 * Helper to get the grid shape for given grid type.
 * @param {x: number, y: number} p    Location to use.
 * @returns {null|PIXI.Rectangle|PIXI.Polygon}
 */
export function gridShape(p) {
  const { GRIDLESS, SQUARE } = CONST.GRID_TYPES;
  switch ( canvas.grid.type ) {
    case GRIDLESS: return null;
    case SQUARE: return squareGridShape(p);
    default: return hexGridShape(p);
  }
}

/**
 * Helper to get the grid shape from grid coordinates.
 * @param {number[2]} gridCoords
 * @returns {null|PIXI.Rectangle|PIXI.Polygon}
 */
export function gridShapeFromGridCoords(gridCoords) {
  if ( canvas.grid.isHex ) return hexGridShapeFromGridCoords(gridCoords);
  return squareGridShapeFromGridCoords(gridCoords)
}

/**
 * From ElevatedVision ElevationLayer.js
 * Return the rectangle corresponding to the grid square at this point.
 * @param {x: number, y: number} p    Location within the square.
 * @returns {PIXI.Rectangle}
 */
function squareGridShapeFromTopLeft(tlx, tly) {
  const { w, h } = canvas.grid;
  return new PIXI.Rectangle(tlx, tly, w, h);
}

function squareGridShapeFromGridCoords(gridCoords) {
  const [tlx, tly] = canvas.grid.grid.getPixelsFromGridPosition(gridCoords[0], gridCoords[1]);
  return squareGridShapeFromTopLeft(tlx, tly)
}

export function squareGridShape(p) {
  const [tlx, tly] = canvas.grid.grid.getTopLeft(p.x, p.y);
  return squareGridShapeFromTopLeft(tlx, tly);
}

/**
 * From ElevatedVision ElevationLayer.js
 * Return the polygon corresponding to the grid hex at this point.
 * @param {x: number, y: number} p    Location within the square.
 * @returns {PIXI.Rectangle}
 */
function hexGridShapeFromTopLeft(tlx, tly, { width = 1, height = 1 } = {}) {
  if ( width !== height ) return null; // Canvas.grid.grid.getBorderPolygon will return null if width !== height.
  const points = canvas.grid.grid.getBorderPolygon(width, height, 0); // TO-DO: Should a border be included to improve calc?
  const pointsTranslated = [];
  const ln = points.length;
  for ( let i = 0; i < ln; i += 2) pointsTranslated.push(points[i] + tlx, points[i+1] + tly);
  return new PIXI.Polygon(pointsTranslated);
}

function hexGridShapeFromGridCoords(gridCoords, opts) {
  const [tlx, tly] = canvas.grid.grid.getPixelsFromGridPosition(gridCoords[0], gridCoords[1]);
  return hexGridShapeFromTopLeft(tlx, tly, opts);
}

export function hexGridShape(p, opts) {
  const [tlx, tly] = canvas.grid.grid.getTopLeft(p.x, p.y);
  return hexGridShapeFromTopLeft(tlx, tly, opts);
}

/**
 * Find the grid center given grid coordinates.
 * @param {number[]} gridCoords
 * @returns {PIXI.Point}
 */
export function gridCenterFromGridCoords(gridCoords) {
  const [tlx, tly] = canvas.grid.grid.getPixelsFromGridPosition(gridCoords[0], gridCoords[1]);
  const [cx, cy] = canvas.grid.grid.getCenter(tlx, tly);
  return new PIXI.Point(cx, cy);
}

/**
 * Get the two points perpendicular to line A --> B at A, a given distance from the line A --> B
 * @param {PIXI.Point} A
 * @param {PIXI.Point} B
 * @param {number} distance
 * @returns {[PIXI.Point, PIXI.Point]} Points on either side of A.
 */
export function perpendicularPoints(A, B, distance = 1) {
  const delta = B.subtract(A);
  const pt0 = new PIXI.Point(A.x - delta.y, A.y + delta.x);
  return [
    A.towardsPoint(pt0, distance),
    A.towardsPoint(pt0, -distance)
  ];
}

/*
 * Generator to iterate grid points under a line.
 * See Ruler.prototype._highlightMeasurementSegment
 * @param {x: Number, y: Number} origin       Origination point
 * @param {x: Number, y: Number} destination  Destination point
 * @param {object} [opts]                     Options affecting the result
 * @param {boolean} [opts.reverse]            Return the points from destination --> origin.
 * @return Iterator, which in turn
 *   returns [row, col] Array for each grid point under the line.
 */
export function * iterateGridUnderLine(origin, destination, { reverse = false } = {}) {
  if ( reverse ) [origin, destination] = [destination, origin];

  const distance = PIXI.Point.distanceBetween(origin, destination); // We want 2d here.
  const spacer = canvas.scene.grid.type === CONST.GRID_TYPES.SQUARE ? 1.41 : 1;
  const nMax = Math.max(Math.floor(distance / (spacer * Math.min(canvas.grid.w, canvas.grid.h))), 1);
  const tMax = Array.fromRange(nMax+1).map(t => t / nMax);

  // Track prior position
  let prior = null;
  let tPrior = null;
  for ( const t of tMax ) {
    const {x, y} = origin.projectToward(destination, t);

    // Get grid position
    const [r0, c0] = prior ?? [null, null];
    const [r1, c1] = canvas.grid.grid.getGridPositionFromPixels(x, y);
    if ( r0 === r1 && c0 === c1 ) continue;

    // Skip the first one
    // If the positions are not neighbors, also highlight their halfway point
    if ( prior && !canvas.grid.isNeighbor(r0, c0, r1, c1) ) {
      const th = (t + tPrior) * 0.5;
      const {x: xh, y: yh} = origin.projectToward(destination, th);
      yield canvas.grid.grid.getGridPositionFromPixels(xh, yh); // [rh, ch]
    }

    // After so the halfway point is done first.
    yield [r1, c1];

    // Set for next round.
    prior = [r1, c1];
    tPrior = t;
  }
}

/**
 * Determine if a token is currently snapped to the grid.
 * @param {Token} token
 * @returns {boolean}
 */
export function tokenIsSnapped(token) {
  const { x, y } = token.document;
  const [snappedX, snappedY] = canvas.grid.grid.getTopLeft(x, y);
  return snappedX.almostEqual(x) && snappedY.almostEqual(y);
}

/**
 * Create a very small rectangle for a point to be used with Quadtree.
 * @param {Point} pt
 * @returns {PIXI.Rectangle}
 */
export function boundsForPoint(pt) { return new PIXI.Rectangle(pt.x - 1, pt.y - 1, 3, 3); }

/**
 * From https://stackoverflow.com/questions/14446511/most-efficient-method-to-groupby-on-an-array-of-objects
 * Takes an Array<V>, and a grouping function,
 * and returns a Map of the array grouped by the grouping function.
 *
 * @param {Array} list An array of type V.
 * @param {Function} keyGetter A Function that takes the the Array type V as an input, and returns a value of type K.
 *                  K is generally intended to be a property key of V.
 *                  keyGetter: (input: V) => K): Map<K, Array<V>>
 *
 * @returns Map of the array grouped by the grouping function. map = new Map<K, Array<V>>()
 */
export function groupBy(list, keyGetter) {
  const map = new Map();
  list.forEach(item => {
    const key = keyGetter(item);
    const collection = map.get(key);

    if (!collection) map.set(key, [item]);
    else collection.push(item);
  });
  return map;
}

/**
 * Helper to get a rectangular bounds between two points.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {PIXI.Rectangle}
 */
export function segmentBounds(a, b) {
  if ( !b || a.equals(b) ) return new PIXI.Rectangle(a.x - 1, a.y - 1, 3, 3);
  const xMinMax = Math.minMax(a.x, b.x);
  const yMinMax = Math.minMax(a.y, b.y);
  return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
}


/**
 * Helper to inject configuration html into the application config.
 */
export async function injectConfiguration(app, html, data, template, findString) {
  const myHTML = await renderTemplate(template, data);
  const form = html.find(findString);
  form.append(myHTML);
  app.setPosition(app.position);
}