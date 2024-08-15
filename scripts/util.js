/* globals
canvas
CONFIG,
CONST,
PIXI,
renderTemplate
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";

export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(e) { // eslint-disable-line no-unused-vars
    // Empty
  }
}

/**
 * Get the snapped grid position for the upper left corner of a token of any size.
 * So a 2x2 token would return the upper left corner of that token, snapped to a grid corner.
 * @param {Point} point   Point for which you want the upper left corner
 * @param {Token} token   Token for which you want the point
 * @returns {Point} The upper left corner
 */
export function snappedTokenPositionAt(point, token) {
  const topLeft = unsnappedTokenPositionAt(point, token);
  return token.getSnappedPosition(topLeft);
}

/**
 * Get the unsnapped grid position for the upper left corner of a token of any size.
 * So a 2x2 token would return the upper left corner of that token.
 * @param {Point} point   Point for which you want the upper left corner
 * @param {Token} token   Token for which you want the point
 * @returns {Point} The upper left corner
 */
export function unsnappedTokenPositionAt(point, token) {
  const pivot = token.getCenterPoint({x: 0, y: 0});
  return {x: point.x - pivot.x, y: point.y - pivot.y};
}

/**
 * Get the two points perpendicular to line A --> B at A, a given distance from the line A --> B
 * @param {PIXI.Point|Point} A
 * @param {PIXI.Point|Point} B
 * @param {number} distance
 * @returns {[PIXI.Point, PIXI.Point]} Points on either side of A.
 */
export function perpendicularPoints(A, B, distance = 1) {
  A = PIXI.Point._tmp.copyFrom(A);
  B = PIXI.Point._tmp2.copyFrom(B);
  const delta = B.subtract(A, PIXI.Point._tmp3);
  const normal = new PIXI.Point(A.x - delta.y, A.y + delta.x);
  return [
    A.towardsPoint(normal, distance),
    A.towardsPoint(normal, -distance)
  ];
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
  if ( !b || (a.x === b.x && a.y === b.y) ) return new PIXI.Rectangle(a.x - 1, a.y - 1, 3, 3);
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

/**
 * Calculate the percent area overlap of one shape on another.
 * @param {PIXI.Rectangle|PIXI.Polygon} overlapShape
 * @param {PIXI.Rectangle|PIXI.Polygon} areaShape
 * @returns {number} Value between 0 and 1.
 */
export function percentOverlap(overlapShape, areaShape, totalArea) {
  if ( !overlapShape.overlaps(areaShape) ) return 0;
  const intersection = overlapShape.intersectPolygon(areaShape.toPolygon());
  const ixArea = intersection.area;
  totalArea ??= areaShape.area;
  return ixArea / totalArea;
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
  if ( !(origin instanceof PIXI.Point) ) origin = PIXI.Point.fromObject(origin);
  if ( !(destination instanceof PIXI.Point) ) destination = PIXI.Point.fromObject(destination);
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
    // TODO: Clean up so it uses GridOffset / GridCoordinates
    const [r0, c0] = prior ?? [null, null];
    const offset = canvas.grid.getOffset({x, y});
    const r1 = offset.i;
    const c1 = offset.j;
    // const [r1, c1] = canvas.grid.grid.getGridPositionFromPixels(x, y);
    if ( r0 === r1 && c0 === c1 ) continue;

    // Skip the first one
    // If the positions are not neighbors, also highlight their halfway point
    if ( prior && !canvas.grid.isNeighbor(r0, c0, r1, c1) ) {
      const th = (t + tPrior) * 0.5;
      const {x: xh, y: yh} = origin.projectToward(destination, th);
      const hOffset = canvas.grid.getOffset({ x: xh, y: yh });
      yield [hOffset.i, hOffset.j];

      // yield canvas.grid.grid.getGridPositionFromPixels(xh, yh); // [rh, ch]
    }

    // After so the halfway point is done first.
    yield [r1, c1];

    // Set for next round.
    prior = [r1, c1];
    tPrior = t;
  }
}

/**
 * Synchronous version of renderTemplate.
 * Requires the template to be already loaded.
 * @param {string} path             The file path to the target HTML template
 * @param {Object} data             A data object against which to compile the template
 * @returns {string|undefined}      Returns the compiled and rendered template as a string
 */
export function renderTemplateSync(path, data) {
  if ( !Object.hasOwn(Handlebars.partials, path) ) return;
  const template = Handlebars.partials[path];
  return template(data || {}, {
    allowProtoMethodsByDefault: true,
    allowProtoPropertiesByDefault: true
  });
}

/**
 * Rounds the number to the multiple from the Round Distance to Multiple setting. 
 * Otherwise, returns original number.
 * @param {number} num The number to round
 * @returns {number}   The rounded number
 */
export function roundMultiple (num) {
  const multiple = Settings.get(Settings.KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE);
  if (multiple) return num.toNearest(multiple);
  return num;
}

