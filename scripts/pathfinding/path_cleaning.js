/* globals
canvas,
CONFIG,
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
 * @param {PIXI.Point[]} pathPoints
 * @returns {PIXI.Point[]}
 */
export function cleanGridPathPoints(pathPoints) {
  if ( pathPoints.length < 3 ) return pathPoints;
  let a = pathPoints[0];
  let b = pathPoints[1];
  const cleanedPts = [a];
  for ( let i = 2, n = pathPoints.length - 1; i < n; i += 1 ) {
    const c = pathPoints[i];
    const abDir = { x: b.x - a.x, y: b.y - a.y };
    const cbDir = { x: c.x - b.x, y: c.y - b.y};
    if ( !(abDir.x.almostEqual(cbDir.x) && abDir.y.almostEqual(cbDir.y)) ) cleanedPts.push(b);
    a = b;
    b = c;
  }
  cleanedPts.push(pathPoints.at(-1));
  return cleanedPts;
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
