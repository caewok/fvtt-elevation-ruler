/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { GridCoordinates } from "../geometry/GridCoordinates.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { PixelCache } from "../geometry/PixelCache.js";

// Assortment of functions used to clean generated paths.
// Straighten, snap-to-grid, fog test.

/**
 * Check the path for collisions
 * @param {Point[]} path
 * @param {Token} token
 * @returns {boolean}
 */
export function pathIsValid(path, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  for ( let i = 0, iMax = path.length - 1; i < iMax; i += 1 ) {
    if ( sceneGraph.hasCollision(path[i], path[i + 1], token) ) return false;
  }
  return true;
}

/**
 * @param {Point[]} path
 * @param {Token} token
 * @returns {GridCoordinates3d[]}
 */
export function snapPathToGrid(path, token) {
  if ( path.length < 2 ) return path;

  // Get grid points between each segment of the path.
  const gridPointsArr = [];
  for ( let i = 0, iMax = path.length - 1; i < iMax; i += 1 ) {
    gridPointsArr.push(snapSegmentToGrid(path[i], path[i + 1], token));
  }

  // Combine the segments ends, converting to grid points where possible.
  while ( gridPointsArr.length > 1 ) {
    const gridPoints2 = gridPointsArr.pop();
    const gridPoints1 = gridPointsArr.pop();
    gridPointsArr.push(cleanSegmentGridConnections(gridPoints1, gridPoints2, token));
  }
  return removeDuplicatePoints(gridPointsArr[0]);
}


/**
 * Helper for snapPathToGrid.
 * Takes arrays of points and joins them.
 * E.g., [a, ..., b] and [b, ..., c]
 * Reduce to [a, ..., gridded b or b, ... c]
 * Drops all duplicates and converts sub-endpoints to grid centers unless collision is found.
 * @param {GridCoordinates3d[][]} gridPoints
 * @returns {GridCoordinates3d[]}
 */
function cleanSegmentGridConnections(gridPoints1, gridPoints2, token) {
  // Options:
  // [][] --> return []
  // [...][] or [][...]--> return [...]
  if ( !gridPoints1.length ) return gridPoints2;
  if ( !gridPoints2.length ) return gridPoints1;

  // [..., b1][b2, ...]
  // • if a === b, return [..., offset a, ... ]
  // • if a ≠ b, return [..., offset a -> offset b, ...]
  const b1 = gridPoints1.pop();
  const b2 = gridPoints2.shift();
  const adjB1 = b1.clone().centerToOffset();
  if ( b1.almostEqual(b2) ) {
    const n = locateValidOffset(adjB1, gridPoints1.at(-1) || b1, gridPoints2.at(0) || b2, token);
    return n ? [...gridPoints1, n, ...gridPoints2] : [...gridPoints1, b1, ...gridPoints2];
  }

  const adjB2 = b2.clone().centerToOffset();
  const [aN, bN] = locateValidABOffset(adjB1, adjB2, gridPoints1.at(-1) || b1, gridPoints2.at(0) || b2, token);
  if ( aN && bN ) return [...gridPoints1, aN, bN, ...gridPoints2];
  else if ( aN ) return [...gridPoints1, aN, b2, ...gridPoints2];
  else if ( bN ) return [...gridPoints1, b1, bN, ...gridPoints2];
  else return [...gridPoints1, b1, b2, ...gridPoints2];
}

/**
 * Get the valid (2d) neighbors to a grid point.
 * Uses canvas.grid so it respects diagonal rules.
 */
function gridNeighbors(pt) {
  const pt2d = GridCoordinates.fromObject(pt);
  const offsets = canvas.grid.getAdjacentOffsets(pt2d);
  pt2d.release();
  return offsets.map(offset => GridCoordinates3d.fromOffset(offset));
}

/**
 * Between a and b, find grid center points that will create a path without colliding.
 * @param {Point} a
 * @param {Point} b
 * @param {Token} token
 * @returns {GridCoordinates3d[a, ..., b]}
 */
function snapSegmentToGrid(a, b, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  if ( sceneGraph.hasCollision(a, b, token) ) return [a, b];
  const gridPoints = canvas.grid.getDirectPath([a, b]);
  const allPoints = removeDuplicatePoints([
    GridCoordinates3d.fromObject(a),
    ...gridPoints.map(offset => GridCoordinates3d.fromOffset(offset)), GridCoordinates3d.fromObject(b)]);

  // Could do either middle-out or outside-in.
  // Here, trying outside-in.
  // Adjust points at either end, and walk to middle.
  // At each step, test variations on
  // a --> adjA does not collide.
  // adjB --> b does not collide.
  // adjA --> adjB does not collide.
  allPointsLoop: for ( let i = 1, j = allPoints.length - 2; i <= j; i += 1, j -= 1 ) {
    const a0 = allPoints[i - 1];
    const b0 = allPoints[j + 1];
    const adjA = allPoints[i];

    // Neighbors gives options for a0 --> aN that do not have a collision.
    // Test whether aN --> b0 has collision.
    if ( i === j ) {
      allPoints[i] = locateValidOffset(adjA, a0, b0, token);
      if ( !allPoints[i] ) console.warn(`snapSegmentToGrid failed to find valid path for ${i}.`, { a, b });
      continue;
    }

    // Neighbors gives options for a0 --> aN that do not have a collision.
    // Neighbors gives options for bN --> b0 that do not have a collision.
    // Test whether aN --> bN has a collision. Try different combinations.
    const adjB = allPoints[j];
    const [aN, bN] = locateValidABOffset(adjA, adjB, a, b, token);
    allPoints[i] = aN;
    allPoints[j] = bN;
    if ( !(aN || bN) ) console.warn(`snapSegmentToGrid failed to find valid path for ${i}, ${j}.`, { a, b });
  }
  return allPoints.filter(pt => Boolean(pt));
}

function locateValidOffset(adjA, a, b, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  for ( const aN of neighbors(adjA, a, b, token, false) ) {
    if ( sceneGraph.hasCollision(aN, b, token) ) continue;
    return aN;
  }
  return null;
}

function locateValidABOffset(adjA, adjB, a, b, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  for ( const aN of neighbors(adjA, a, b, token, false) ) {
    for ( const bN of neighbors(adjB, a, b, token, true) ) {
      if ( sceneGraph.hasCollision(aN, bN, token) ) continue;
      return [aN, bN];
    }
  }
  return [];
}

/**
 * Remove duplicate points in an array.
 * @param {PIXI.Point[]|Point3d[]} points
 * @returns {PIXI.Point[]|Point3d[]} New array with duplicates removed.
 */
export function removeDuplicatePoints(points) {
  let prev = points[0];
  const deDupedPoints = [prev];
  for ( let i = 1, iMax = points.length; i < iMax; i += 1 ) {
    const potentialPoint = points[i];
    if ( prev.almostEqual(potentialPoint) ) continue;
    deDupedPoints.push(potentialPoint);
    prev = potentialPoint;
  }
  return deDupedPoints;
}

/**
 * Distance squared from point to a segment a|b.
 * If point is between a and b, this is the perpendicular distance squared.
 * Otherwise, it is the distance squared to the closer of a or b.
 * @param {Point} a
 * @param {Point} b
 * @param {Point} pt
 * @returns {number}
 */
function distanceSquaredToSegment(a, b, pt) {
  if ( a.almostEqual(b) ) return PIXI.Point.distanceSquaredBetween(a, pt); // closestPoint throws error if a = b.
  const closestPt = foundry.utils.closestPointToSegment(pt, a, b);
  return PIXI.Point.distanceSquaredBetween(pt, closestPt);
}


/**
 * For a given offset point to the segment a|b, determine if it or its neighbors
 * have no collisions between a and the proposed offset.
 * @param {GridCoordinates3d} a
 * @param {GridCoordinates3d} b
 * @param {GridCoordinates3d} offsetPt
 * @param {Token} token
 * @param {boolean} [reverse=false]         If reverse, test the collision for offset -> b instead of a --> offset.
 * @returns {GridCoordinates3d} Point that does not have a collision in a --> offset (or offset --> b).
 */
function *neighbors(offsetPt, a, b, token, reverse = false) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  const collisionFn = reverse
    ? n => sceneGraph.hasCollision(n, b, token)
    : n => sceneGraph.hasCollision(a, n, token);

  if ( !collisionFn(offsetPt) ) yield offsetPt;

  // Test each neighbor in turn. Prioritize by closest to the line a|b.
  // Don't repeat a or b.
  const neighbors = gridNeighbors(offsetPt).filter(n => !(a.almostEqual(n) || b.almostEqual(n)));
  neighbors.sort((n0, n1) => distanceSquaredToSegment(a, b, n0) - distanceSquaredToSegment(a, b, n1));
  for ( const n of neighbors ) {
    if ( collisionFn(n) ) continue;
    yield n;
  }
}


/**
 * Clean a set of grid path points by dropping intermediate points in the same direction.
 * So if moving diagonally NE, drop all points until direction changes.
 *
 * Also removes U-turns. E.g., A -> B -> A becomes A.
 *
 * If diagonal movement is allowed, will change A -> B -> C to A -> C if A and C are neighbors
 * and collision-free.
 *
 * @param {GridCoordinates[]} path
 * @returns {GridCoordinates[]}
 */
export function optimizeGridPath(path, { token, checkDiagonals = Boolean(token), dropIntermediate = true } = {}) {
  if ( path.length < 3 ) return path;
  checkDiagonals &&= canvas.grid.diagonals !== CONST.GRID_DIAGONALS.ILLEGAL;

  const testFn = checkDiagonals && dropIntermediate ? composeOr(isUTurn, skipIntermediate, canShortcutDiagonal)
    : checkDiagonals ? composeOr(isUTurn, canShortcutDiagonal)
      : dropIntermediate ? composeOr(isUTurn, skipIntermediate)
        : isUTurn;
  let a = path[0];
  let b = path[1];
  const cleanedPts = [a];
  for ( let i = 2, n = path.length - 1; i < n; i += 1 ) {
    const c = path[i];
    if ( testFn(a, b, c, token) ) { // Skip b; don't update a.
      b = c;
      continue;
    }
    cleanedPts.push(b);
    a = b;
    b = c;
  }
  cleanedPts.push(path.at(-1));
  return cleanedPts;
}

const composeOr = (...funcs) => (...args) => funcs.some(func => func(...args));

/** Helper to cleanGridPath */
function skipIntermediate(a, b, c) {
  const abDelta = b.subtract(a);
  const bcDelta = c.subtract(b);
  const out = abDelta.almostEqual(bcDelta);
  abDelta.release();
  bcDelta.release();
  return out;
}

/** Helper to removePathUTurns */
function isUTurn(a, _b, c) { return a.almostEqual(c); }

/** Helper to removePathUTurns */
function canShortcutDiagonal(a, _b, c, token) {
  return is2dDiagonal(a, c) && !CONFIG[MODULE_ID].sceneGraph.hasCollision(a, c, token);
}


/**
 * Clean a set of grid path points by dropping intermediate points in the same direction.
 * So if moving diagonally NE, drop all points until direction changes.
 * @param {GridCoordinates[]} path
 * @returns {GridCoordinates[]}
 */

export function cleanGridPath(path) {
  if ( path.length < 3 ) return path;
  let a = path[0];
  let b = path[1];
  const cleanedPts = [a];
  const abDelta = a.constructor.tmp;
  const bcDelta = b.constructor.tmp;
  for ( let i = 2, n = path.length - 1; i < n; i += 1 ) {
    const c = path[i];
    b.subtract(a, abDelta);
    c.subtract(b, bcDelta);
    if ( abDelta.almostEqual(bcDelta) ) { // Skip b; don't update a.
      b = c;
      continue;
    }
    cleanedPoints.push(b);
    a = b;
    b = c;
  }
  abDelta.release();
  bcDelta.release();
  cleanedPts.push(path.at(-1)); // Add last c.
  return cleanedPts;
}


/**
 * Remove u-turns from a path
 * @param {GridCoordinates[]} path
 * @returns {GridCoordinates[]}
 */
/* function removePathUTurns(path) {
  if ( path.length < 3 ) return path;
  let a = path[0];
  let b = path[1];
  const cleanedPts = [a];
  for ( let i = 2, n = path.length - 1; i < n; i += 1 ) {
    const c = path[i];
    if ( a.almostEqual(c) ) { // Skip b; don't update a.
      b = c;
      continue;
    }
    cleanedPts.push(b);
    a = b;
    b = c;
  }
  cleanedPts.push(path.at(-1)); // Add last c.
  return cleanedPts;
}
*/

/**
 * Shortcut grid corners.
 * A -> B -> C becomes A -> C.
 * A -> B -> C -> D
 * Only done if no collision and A and C .
 * @param {GridCoordinates[]} path
 * @returns {GridCoordinates[]}
 */
/* function shortcutGridCorners(path, token) {
  if ( path.length < 3
    || !token
    || canvas.grid.diagonals === CONST.GRID_DIAGONALS.ILLEGAL ) return path;
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  let a = path[0];
  let b = path[1];
  const cleanedPts = [a];
  for ( let i = 2, n = path.length - 1; i < n; i += 1 ) {
    const c = path[i];
    if ( is2dDiagonal(a, c) && !sceneGraph.hasCollision(a, c, token) ) {  // Skip b; don't update a.
      b = c;
      continue;
    }
    cleanedPts.push(b);
    a = b;
    b = c;
  }
  cleanedPts.push(path.at(-1)); // Add last c.
  return cleanedPts;
}
*/

/**
 * Returns true if point b is diagonal to point a.
 * @param {GridCoordinates} a
 * @param {GridCoordinates} b
 * @returns {boolean}
 */
function is2dDiagonal(a, b) {
  return Math.abs(a.i - b.i) === 1 && Math.abs(a.j - b.j) === 1;
}


/**
 * Reverse Ramer–Douglas–Peucker algorithm to straighten points.
 * Take start and end points. If no collisions, drop all points in between and end.
 * Find farthest point.
 *   a. start --> farthest. If no collisions, drop all points in between and break
 *   b. farthest --> end. If no collisions, drop all points in between and break
 * If (a), call again, finding farthest point between start --> old farthest.
 * If (b), call again, finding farthest point between old farthest --> end
 * If enabled, collisions include terrain collisions.
 * If start and end are the same or no points between, end.
 * @param {PIXI.Point[]} pathPoints
 * @param {Token} token               Move token, used when testing for some collisions
 * @returns {PIXI.Point[]}
 */
export function straightenPath(pathPoints, token, _depth = 0) {
  if ( pathPoints.length < 3 ) return pathPoints;

  if ( _depth > 1000 ) {
    console.warn("cleanGridPathRDP exceeded depth max", { pathPoints, token });
    return pathPoints;
  }

  // Test for collision between first and last points.
  const a = pathPoints.at(0);
  const b = pathPoints.at(-1);
  if ( !CONFIG[MODULE_ID].sceneGraph.hasCollision(a, b, token) ) return [a, b];

  // Locate the index of the farthest point from segment a|b.
  let farthestIndex = 0;
  let maxDist2 = -1;
  const nInterior = pathPoints.length - 2;
  for ( let i = 1; i < nInterior; i += 1 ) {
    const dist2 = distanceSquaredToSegment(a, b, pathPoints[i]);
    if ( dist2 > maxDist2 ) {
      maxDist2 = dist2;
      farthestIndex = i;
    }
  }
  // Adjust index by one to account for interior.
  farthestIndex += 1;

  // Test the two halves: a|farthest, farthest|b. Remember to not duplicate farthest when combining.
  const firstHalf = straightenPath(pathPoints.slice(0, farthestIndex + 1), token, _depth += 1);
  const secondHalf = straightenPath(pathPoints.slice(farthestIndex), token, _depth += 1);
  return [...firstHalf, ...secondHalf.slice(1)];
}

/**
 * Function factory to provide a means to test if a given canvas location is explored or unexplored.
 * Dependent on the scene having a fog exploration for that user.
 * Because fog will change over time, this should be called each time a new path is requested.
 * @returns {function} Function that checks whether a canvas position is explored
 *   - @param {number} x
 *   - @param {number} y
 *   - @returns {boolean}  True if explored, false if unexplored. If no fog, always true.
 */
export function fogIsExplored() {
  const tex = canvas.fog.exploration?.getTexture();
  if ( !tex || !tex.valid ) return undefined;

  const { width } = canvas.visibility.textureConfiguration;
  const pixelRes = PixelCache.extractPixelsFromTexture(tex);
  let pixels = PixelCache.extractPixelChannel(pixelRes.pixels, 0, 4);
  const cache = PixelCache.fromPixelArray(pixels, width);

  // TODO: Do we need to translate the fog for the scene or does it cover the entire canvas?
  return (x, y) => cache.pixelAtCanvas(x, y) > 128;
}
