/* globals
canvas,
CONFIG,
CONST,
PIXI,
renderTemplate
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";

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
  const { sizeX, sizeY } = canvas.grid;
  return new PIXI.Rectangle(x, y, sizeX, sizeY);
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

/**
 * Row, column, elevation coordinates of a grid space. Follows from GridOffset
 * The vertical assumes the grid cubes are stacked upon one another.
 * @typedef {object} GridOffset3d
 * @property {number} i     The row coordinate
 * @property {number} j     The column coordinate
 * @property {number} k     The elevation, where 0 is at the scene elevation, negative is below the scene.
 *   k * canvas.scene.dimensions.distance === elevation in grid units.
 */


/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset3d|Point3d} GridCoordinates3d
 */

/**
 * Get the center point for a given GridCoordinates3d
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {Point3d} The center point
 */
export function getCenterPoint3d(coords) {
  const center = Point3d.fromObject(canvas.grid.getCenterPoint(coords));
  center.z = canvasElevationFromCoordinates(coords);
  return center;
}

/**
 * Get a point from grid coordinates.
 * @param {GridCoordinates3d} coords
 * @returns {Point3d}
 *   - If i,j,k present, returns the center point
 *   - Otherwise returns the point at x,y,z
 */
export function pointFromGridCoordinates(coords) {
  const z  = canvasElevationFromCoordinates(coords);
  if ( Object.hasOwn(coords, "i") ) {
    const pt = canvas.grid.getCenterPoint(coords);
    return new Point3d(pt.x, pt.y, z);
  }
  const pt = Point3d.fromObject(coords);
  pt.z = z;
  return pt;
}

/**
 * Calculate the canvas elevation for a given set of coordinates.
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {number} Elevation in canvas pixel units.
 */
export function canvasElevationFromCoordinates(coords) {
  return CONFIG.GeometryLib.utils.gridUnitsToPixels(gridElevationFromCoordinates(coords));
}

/**
 * Calculate the grid elevation for a given set of coordinates.
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {number} Elevation in grid units.
 */
export function gridElevationFromCoordinates(coords) {
  const k = coords.k;
  if ( typeof k === "undefined" ) return CONFIG.GeometryLib.utils.pixelsToGridUnits(coords.z) || 0;
  return k * canvas.scene.dimensions.distance;
}

/**
 * Calculate the unit elevation for a given set of coordinates.
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {number} Elevation in number of grid steps.
 */
export function unitElevationFromCoordinates(coords) {
  const k = coords.k;
  if ( typeof k !== "undefined" ) return k;
  const z = coords.z;
  if ( typeof z === "undefined" ) return 0;
  return Math.round(CONFIG.GeometryLib.utils.pixelsToGridUnits(z) / canvas.scene.dimensions.distance);
}

/**
 * Determine if a token is currently snapped to the grid.
 * @param {Token} token
 * @returns {boolean}
 */
export function tokenIsSnapped(token) {
  const tokenLoc = PIXI.Point.fromObject(token.document);
  const snappedPt = canvas.grid.grid.getTopLeftPoint(tokenLoc);
  return tokenLoc.almostEqual(snappedPt);
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

/**
 * Get the key for a given object value. Presumes unique values, otherwise returns first.
 */
export function keyForValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}