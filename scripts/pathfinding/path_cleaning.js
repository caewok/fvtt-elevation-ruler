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

/**
 * Check the path for collisions
 * @param {Point[]} path
 * @param {Token} token
 * @returns {boolean}
 */
export function pathIsValid(path, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  for ( let i = 0, iMax = path.length - 1; i < iMax; i += 1 ) {
    if ( sceneGraph.pathBlocked(path[i], path[i + 1], token) ) return false;
  }
  return true;
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
export function optimizeGridPath(path, token, {
  checkDiagonals = Boolean(token), dropIntermediate = true, checkUTurn = true
} = {}) {
  if ( path.length < 3 ) return path;
  checkDiagonals &&= (canvas.grid.diagonals !== CONST.GRID_DIAGONALS.ILLEGAL);

  const toTest = [];
  if ( checkUTurn ) toTest.push(isUTurn);
  if ( dropIntermediate ) toTest.push(skipIntermediate);
  if ( checkDiagonals ) toTest.push(canShortcutDiagonal);
  if ( !toTest.length ) return path;
  const testFn = composeOr(...toTest);

  let a = path[0];
  let b = path[1];
  const cleanedPts = [a];
  for ( let i = 2, n = path.length; i < n; i += 1 ) {
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

/** Helper to dropIntermediatePoints */
function skipIntermediate(a, b, c) {
  using abDelta = b.subtract(a);
  using bcDelta = c.subtract(b);
  return abDelta.almostEqual(bcDelta);
}

/** Helper to removePathUTurns */
function isUTurn(a, _b, c) { return a.almostEqual(c); }

/** Helper to removePathUTurns */
function canShortcutDiagonal(a, _b, c, token) {
  return is2dDiagonal(a, c) && !CONFIG[MODULE_ID].sceneGraph.pathBlocked(a, c, token);
}


/**
 * Clean a set of grid path points by dropping intermediate points in the same direction.
 * So if moving diagonally NE, drop all points until direction changes.
 * @param {GridCoordinates[]} path
 * @returns {GridCoordinates[]}
 */

export function dropIntermediatePoints(path) {
  if ( path.length < 3 ) return path;
  let a = path[0];
  let b = path[1];
  const cleanedPoints = [a];
  using abDelta = a.constructor.tmp;
  using bcDelta = b.constructor.tmp;
  for ( let i = 2, n = path.length; i < n; i += 1 ) {
    const c = path[i];
    b.subtract(a, abDelta);
    c.subtract(b, bcDelta);
    // Use orient2d b/c faster than normalizing the deltas and comparing them.
    // Allows comparison when not gridded and the distance from a --> b is different than b --> c.
    if ( !(abDelta.almostEqual(bcDelta)
        || foundry.utils.orient2dFast(a, b, c).almostEqual(0)) ) cleanedPoints.push(b);
    a = b;
    b = c;
  }
  cleanedPoints.push(path.at(-1)); // Add last c.
  return cleanedPoints;
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
    if ( is2dDiagonal(a, c) && !sceneGraph.pathBlocked(a, c, token) ) {  // Skip b; don't update a.
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
  if ( !CONFIG[MODULE_ID].sceneGraph.pathBlocked(a, b, token) ) return [a, b];

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
  const firstHalf = straightenPath(pathPoints.slice(0, farthestIndex + 1), token, _depth + 1);
  const secondHalf = straightenPath(pathPoints.slice(farthestIndex), token, _depth + 1);
  return [...firstHalf, ...secondHalf.slice(1)];
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
  if ( a.almostEqual(b) ) return PIXI.Point.distanceSquaredBetween(a, pt); // Note: closestPoint throws error if a = b.
  const closestPt = foundry.utils.closestPointToSegment(pt, a, b);
  return PIXI.Point.distanceSquaredBetween(pt, closestPt);
}
