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
 * Approximate a grid path over an array of line segments.
 * Avoids obstacles and reverts to the line when collisions encountered.
 */
export function snapPathToGrid(path, token, maxDepth = 4) {
  if ( path.length < 2 ) return path;
  path = path.map(pt => GridCoordinates3d.fromObject(pt));
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  const collisionFn = (a, adjA) => sceneGraph.pathBlocked(a, adjA, token);
  let candidate;
  for ( const candidateConnection of validOffsets(path[0], collisionFn) ) {
    const candidatePath = candidateConnection.almostEqual(path[1])
      ? path.slice(1,)
      : [candidateConnection, ...path.slice(1,)];
    candidate = _approximateGridPath(candidatePath, token, maxDepth);
    if ( candidate.gridded ) break;
  }

  // TODO: Ever necessary to reverse the path and try again?

  // Add back path start.
  candidate.path.unshift(path[0]);

  return removeDuplicatePoints(candidate.path);
}

/**
 * Recursively approximate a grid path over an array of segments.
 * The first segment is gridded, and then the start of each following segment is given a candidate offset
 * based on the grid termination of the first segment, and then the rest of the path is constructed.
 * Essentially, at end of each segment, different offsets are attempted
 * @param {GridCoordinates3d[]} path
 * @param {Token} token
 * @param {number} [maxDepth=4]       Maximum depth passed to solveSegment
 * @returns {GridPathResult}
 */
function _approximateGridPath(path, token, maxDepth = 4) {
  if ( path.length < 2 ) return new GridPathResult(path);

  let finalPath = [path[0]];
  const firstSegment = new GridPathResult(solveSegment(path[0], path[1], token, maxDepth));
  if ( path.length === 2 ) return firstSegment;

  // First segment includes path endpoints a|b.
  // Drop b, which is also path[1]
  firstSegment.path.pop();

  let otherSegments;
  for ( const candidateConnectionPath of connectSegment(firstSegment.path.at(-1), path[1], token) ) {
    // Drop duplicate point where the candidate offset meets the path.
    if ( path[2].almostEqual(candidateConnectionPath.at(-1)) ) candidateConnectionPath.pop();
    if ( candidateConnectionPath.length
      && firstSegment.path.at(-1).almostEqual(candidateConnectionPath[0]) ) candidateConnectionPath.shift();

    // Find a grid approximation for the new path.
    const candidatePath = [candidateConnectionPath.at(-1) || firstSegment.path.at(-1), ...path.slice(2,)];
    otherSegments = _approximateGridPath(candidatePath, token, maxDepth);
    if ( candidateConnectionPath.length > 1 ) {
      // Add back in any extra candidateConnectionPath points.
      otherSegments.path = [
        ...candidateConnectionPath.slice(0, candidateConnectionPath.length - 1),
        ...otherSegments.path
      ];
    }
    if ( !firstSegment.gridded ) break; // Just take the first path.
    if ( otherSegments.gridded ) break; // We found a fully gridded path.
  }

  // Take the first gridded option or last option run.
  // Remove duplicates.
  if ( finalPath[0].almostEqual(firstSegment.path[0]) ) finalPath.pop();
  if ( firstSegment.path.at(-1).almostEqual(otherSegments.path[0]) ) firstSegment.path.pop();
  finalPath.push(...firstSegment.path, ...otherSegments.path);
  return new GridPathResult(finalPath);
}

class GridPathResult {
  path;

  constructor(path) {
    this.path = path;
  }

  #gridded;

  get gridded() { return (this.#gridded ??= this.constructor.isGridded(this.path)); }

  static isGridded(path) {
    using tmp = GridCoordinates3d.tmp;

    // Test:
    // 1. Each point is on the grid.
    // 2. Each point is 1 offset away from the previous point.
    const iter = path.values();
    let prev = iter.next().value;
    for ( const curr of iter ) {
      curr.clone(tmp);
      tmp.centerToOffset();
      const gridded = curr.almostEqual(tmp)
        && (Math.abs(prev.i - tmp.i) < 2 && Math.abs(prev.j - tmp.j) < 2);
      if ( !gridded ) return false;
      prev = curr;
    }
    return true;
  }

  clear() {
    this.#gridded = null;
  }
}

/* Testing

Essentially, the initial path is created by building a bunch of firstSegments.
pf.constructor.drawPath(path)

sceneGraph = CONFIG[MODULE_ID].sceneGraph;
maxDepth = 4
token = randal
collisionFn = (a, adjA) => sceneGraph.pathBlocked(a, adjA, token);

path = path.map(pt => GridCoordinates3d.fromObject(pt));

// Start approximateGridPath loop
allCandidateConnections = [...validOffsets(path[0], collisionFn)]
candidateConnection = allCandidateConnections[0]
candidatePath = path.slice(1,);
if ( !candidateConnection.almostEqual(candidatePath[0]) ) candidatePath.unshift(candidateConnection);

candidatePathsTracker = []
candidateConnectionsTracker = []
firstSegmentsTracker = []
otherSegmentsTracker = []
pathParameterTracker = []


// Start __approximateGridPath
proposedPath = _approximateGridPath(candidatePath, token, maxDepth)

_approximateGridPath = (path, token, maxDepth = 4, depth) => {
  depth ||= 0

  pathParameterTracker.push({ depth, path: [...path] });
  if ( path.length < 2 ) return new GridPathResult(path);

  let finalPath = [path[0]];
  const firstSegment = new GridPathResult(solveSegment(path[0], path[1], token, maxDepth));

  firstSegmentsTracker.push({ depth, path: [...firstSegment] };

  if ( path.length === 2 ) return firstSegment;

  candidateConnectionsTracker.push({ depth, candidates: connectSegment(firstSegment.path.at(-1), path[1], token) });
  let i = 0;
  otherSegmentsTracker[_depth] = [];
  candidatePathsTracker[_depth] = [];

  let otherSegments;
  for ( const candidateConnectionPath of connectSegment(firstSegment.path.at(-1), path[1], token) ) {
    // Drop duplicate point where the candidate offset meets the path.
    if ( candidateConnectionPath[0].almostEqual(path[1]) ) candidateConnectionPath.pop();
    const candidatePath = [...candidateConnectionPath, ...path.slice(2,)];
    otherSegments = _approximateGridPath(candidatePath, token, maxDepth, depth + 1);

    otherSegmentsTracker.push({ depth, i, path: [...otherSegments] });
    candidatePathsTracker.push({ depth, i, path: [...candidatePath] })

    if ( !firstSegment.gridded ) break; // Just take the first path.
    if ( otherSegments.gridded ) break; // We found a fully gridded path.
  }
  firstSegment.path.pop(); // The candidateConnection replaces the end of the first segment

  // Take the first gridded option or last option run.
  // Remove duplicates.
  if ( finalPath[0].almostEqual(firstSegment.path[0]) ) finalPath.pop();
  if ( firstSegment.path.at(-1).almostEqual(otherSegments.path[0]) ) firstSegment.path.pop();
  finalPath.push(...firstSegment.path, ...otherSegments.path);
  return new GridPathResult(finalPath);
}


// Drawing
candidatePath1.forEach(pt => Draw.point(pt, { color: Draw.COLORS.yellow, radius: 2 }))
candidateConnections1.forEach(pt => Draw.point(pt, { color: Draw.COLORS.white, radius: 1 }))
Draw.star(candidateConnection1, { color: Draw.COLORS.white, radius: 2 })

*/

/**
 * Given a prior point or grid point from a path and a current point in a path,
 * determine viable options to replace the current point with a gridded point.
 * @param {GridCoordinates3d} prev      Prior point or grid point that must connect
 * @param {GridCoordinates3d} curr      Point to replace
 * @param {Token} token                 Token used when testing collisions
 * @yields {GridCoordinates3d[]}
 */
function *connectSegment(prev, curr, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  if ( canvas.grid.diagonals === CONST.GRID_DIAGONALS.ILLEGAL ) {
    // If no diagonals, then prev --> candidateOffset might require an extra step.
    // Means the test is really whether prev --> ? --> candidateOffset are valid.
    // Skip collision test in validOffsets and test later.
    for ( const candidateOffset of validOffsets(curr) ) {
      if ( candidateOffset.almostEqual(prev) ) yield [prev];
      else {
        const connectingPath = [prev, ...directGridPath(prev, candidateOffset), candidateOffset];
        if ( pathIsValid(connectingPath, token) ) yield connectingPath;
      }
    }
  } else {
    const collisionFn = (a, candidate) => sceneGraph.pathBlocked(prev, candidate, token);
    for ( const candidateOffset of validOffsets(curr, collisionFn) ) yield [candidateOffset];
  }
  if ( !curr.clone().centerToOffset().almostEqual(curr) ) yield [curr]; // The non-offset point.
}

/**
 * Iterate valid offsets to a point.
 * To be valid, the point|offset segment must not have a collision.
 * The point must also be within
 * @param {GridCoordinates3d} a     Point to offset
 * @param {Token} token             Token to use for collision test.
 * @yields {GridCoordinates3d}
 */
function *validOffsets(a, collisionFn, sortFn) {
  collisionFn ??= (_a, _candidate) => false;

  // First, try the basic offset.
  const aOffset = a.clone().centerToOffset();
  if ( a.almostEqual(aOffset) || !collisionFn(a, aOffset) ) yield aOffset;

  // Second, get offsets around this one, sorted by distance to a
  // Only permit neighbors that are less than a full diagonal away from a.
  sortFn ??= (n1, n2) => PIXI.Point.distanceSquaredBetween(n1, a) - PIXI.Point.distanceSquaredBetween(n2, a);
  const maxDist2 = ((canvas.dimensions.size - 1) ** 2) * 2;  // (a - 1)^2 + (b - 1)^2
  const neighbors = gridNeighbors(aOffset).filter(n => PIXI.Point.distanceSquaredBetween(a, n) < maxDist2);
  neighbors.sort(sortFn);
  for ( const n of neighbors ) {
    if ( !collisionFn(a, n) ) yield n;
  }
}

/**
 * Get the valid (2d) neighbors to a grid point.
 * Uses canvas.grid so it respects diagonal rules.
 */
function gridNeighbors(pt) {
  using pt2d = GridCoordinates.fromObject(pt);
  const offsets = canvas.grid.getAdjacentOffsets(pt2d);
  return offsets.map(offset => GridCoordinates3d.fromOffset(offset));
}


/**
 * Find a valid gridded route for a single segment a|b.
 * @param {GridCoordinates3d} a       Starting point of segment
 * @param {GridCoordinates3d} b       End point of segment
 * @param {Token} token               Token to use when testing collisions
 * @param {number} maxDepth           Limit to number of segment splits
 * @returns {GridCoordinates3d[]} Returns a, ...gridded path, b.
 *   Gridded path will not duplicate a or b.
 */
export function solveSegment(a, b, token, maxDepth = 4) {
  const path = _solveSegment(a, b, token, maxDepth, 0);
  if ( a.almostEqual(path[0]) ) path.shift();
  if ( path.length && b.almostEqual(path.at(-1)) ) path.pop();
  return [a, ...path, b];
}

/**
 * Recursive helper to find a valid gridded route for a single segment a|b.
 * @param {GridCoordinates3d} a       Starting point of segment
 * @param {GridCoordinates3d} b       End point of segment
 * @param {Token} token               Token to use when testing collisions
 * @param {number} maxDepth           Limit to recursion (number of segment splits)
 * @param {number} [_depth]           Current depth of the recursion
 * @returns {GridCoordinates3d[]}
 */
function _solveSegment(a, b, token, maxDepth = 4, _depth = 0) {
  if ( a.almostEqual(b) ) return [a];

  // Attempt simple gridded path first.
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  const collisionFn = (pt, adjPt) => sceneGraph.pathBlocked(adjPt, pt, token);
  for ( const offsetB of validOffsets(b, collisionFn) ) {
    const candidate = [a, ...directGridPath(a, offsetB), offsetB, b];
    if ( pathIsValid(candidate, token) ) return candidate;
  }

  // Base case. Revert to direct line if reaching max depth or points are too close.
  if ( _depth >= maxDepth
    || PIXI.Point.distanceSquaredBetween(a, b) < (canvas.dimensions.size ** 2) ) return [a, b];


  // Recursive step: Subdivide segment at midpoint.
  // To ensure no collisions in future tests, need to round the midpoint and test for collisions.
  const mid = findValidMidpoint(a, b, token);
  if ( mid == null ) return [a, b];

  const firstHalf = _solveSegment(a, mid, token, maxDepth, _depth + 1);
  const secondHalf = _solveSegment(mid, b, token, maxDepth, _depth + 1);

  // Combine halves; remove duplicate midpoint.
  secondHalf.shift();
  return [...firstHalf, ...secondHalf];
}

/**
 * Return all grid points between a and b. Do not duplicate a and b if either are already gridded.
 */
function directGridPath(a, b) {
  if ( a.almostEqual(b) ) return [a];

  const gridPoints = canvas.grid.getDirectPath([a, b]);
  const allPoints = gridPoints.map(offset => GridCoordinates3d.fromOffset(offset));
  if ( allPoints[0].almostEqual(a) ) allPoints.shift();
  if ( allPoints.length && allPoints.at(-1).almostEqual(b) ) allPoints.pop();
  return allPoints;
}

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

function *roundedPointsOptions(closestPt) {
  const rounded = GridCoordinates3d.fromObject(closestPt);
  rounded.roundDecimals();
  yield rounded;

  const floor = GridCoordinates3d.fromObject(closestPt);
  floor.floor(floor);
  yield floor;

  const ceil = GridCoordinates3d.fromObject(closestPt);
  ceil.ceil(ceil);
  yield ceil;
}

/**
 * Locate a rounded midpoint between a and b that has no collisions w/r/t a and b.
 *
 * @param {GridCoordinates3d} a       Starting point of segment
 * @param {GridCoordinates3d} b       End point of segment
 * @param {Token} token               Token to use when testing collisions
 * @returns {GridCoordinates3d|null}
 */
function findValidMidpoint(a, b, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  using mid = PIXI.Point.midPoint(a, b);
  let candidateMid;
  for ( candidateMid of roundedPointsOptions(mid) ) {
    if ( !(sceneGraph.pathBlocked(a, candidateMid, token)
      || sceneGraph.pathBlocked(candidateMid, b, token)) ) return candidateMid;
    candidateMid.release();
  }
  return null;
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
  if ( a.almostEqual(b) ) return PIXI.Point.distanceSquaredBetween(a, pt); // Note: closestPoint throws error if a = b.
  const closestPt = foundry.utils.closestPointToSegment(pt, a, b);
  return PIXI.Point.distanceSquaredBetween(pt, closestPt);
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
