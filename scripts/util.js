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
 * @param {GridCoordinates} coords    Grid (i,j) offset or x,y coordinates
 * @returns {null|PIXI.Rectangle|PIXI.Polygon}
 */
export function gridShape(coords) {
  const { GRIDLESS, SQUARE } = CONST.GRID_TYPES;
  switch ( canvas.grid.type ) {
    case GRIDLESS: return null;
    case SQUARE: return squareGridShape(coords);
    default: return hexGridShape(coords);
  }
}

/**
 * Return a rectangle for a given grid square.
 * @param {GridCoordinates} coords      Grid (i,j) offset or x,y coordinates
 * @returns {PIXI.Rectangle}
 */
function squareGridShape(coords) {
  const { x, y } = canvas.grid.grid.getTopLeftPoint(coords);
  return new PIXI.Rectangle(tlx, tly, w, h);
}

/**
 * Return a polygon for a given grid hex.
 * @param {GridCoordinates} coords      Grid (i,j) offset or x,y coordinates
 * @returns {PIXI.Polygon}
 */
export function hexGridShape(coords) {
  return new PIXI.Polygon(...canvas.grid.grid.getVertices(coords));
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
 *   returns {GridCoordinates} Array for each grid point under the line.
 */
export function * iterateGridUnderLine(origin, destination, { reverse = false } = {}) {
  const waypoints = reverse ? [destination, origin] : [origin, destination];
  const pts = canvas.grid.grid.getDirectPath(waypoints);
  for ( const pt of pts ) yield pt;
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

/**
 * Find all array objects that match a condition, remove them from the array, and return them.
 * Like Array.findSplice, but handles multiples.
 * Modifies the array in place
 * @param {array} arr       Array to search
 * @param {function} filterFn   Function used for the filter test
 * @returns {array}
 */
export function filterSplice(arr, filterFn) {
  const indices = [];
  const filteredElems = arr.filter((elem, idx, arr) => {
    if ( !filterFn(elem, idx, arr) ) return false;
    indices.push(idx);
    return true;
  });
  indices.sort((a, b) => b - a); // So we can splice without changing other indices.
  indices.forEach(idx => arr.splice(idx, 1));
  return filteredElems;
}