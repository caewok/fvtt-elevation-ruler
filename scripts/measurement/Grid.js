/* globals
canvas,
CONFIG,
CONST,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { HexGridCoordinates3d } from "../geometry/3d/HexGridCoordinates3d.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Settings } from "../settings.js";

/**
 * Modify Grid classes to measure in 3d.
 * Trigger is a 3d point.
 */

export const PATCHES_GridlessGrid = {};
export const PATCHES_SquareGrid = {};
export const PATCHES_HexagonalGrid = {};

PATCHES_GridlessGrid.BASIC = {};
PATCHES_SquareGrid.BASIC = {};
PATCHES_HexagonalGrid.BASIC = {};

// Store the flipped key/values. And lock the keys.
const CHANGE = {
  NONE: 0,
  V: 1,
  H: 2,
  D: 3,
  E: 4
};
Object.entries(CHANGE).forEach(([key, value]) => CHANGE[value] = key);
Object.freeze(CHANGE);


// ----- NOTE: GridlessGrid ----- //

/**
 * Wrap GridlessGrid#getDirectPath
 * Returns the sequence of grid offsets of a shortest, direct path passing through the given waypoints.
 * @param {RegionMovementWaypoint3d|GridCoordinates3d[]} waypoints    The waypoints the path must pass through
 * @returns {GridOffset[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function getDirectPathGridless(wrapped, waypoints) {
  const offsets2d = wrapped(waypoints);
  if ( !(waypoints[0] instanceof Point3d) ) return offsets2d;

  // 1-to-1 relationship between the waypoints and the offsets2d for gridless.
  return offsets2d.map((offset2d, idx) => {
    const offset3d = GridCoordinates3d.fromOffset(offset2d);
    const waypoint = GridCoordinates3d.fromObject(waypoints[idx]);
    offset3d.k = GridCoordinates3d.unitElevation(waypoint.elevation);
    return offset3d;
  });
}


// ----- NOTE: SquareGrid ----- //

/**
 * Constructs a direct path for a square grid, accounting for elevation and diagonal elevation
 * in a quasi-optimal manner. Spreads out the elevation moves over the course of the path.
 * Double-diagonals are slightly favored for some diagonal measurement
 * types, so this accounts for those by preferring to move elevation when moving 2d diagonally.
 * @param {RegionMovementWaypoint3d} start
 * @param {RegionMovementWaypoint3d} end
 * @param {GridOffset[]} [path2d]             Optional path2d for the start and end waypoints.
 * @returns {GridCoordinates3d[]}
 */
function directPath3dSquare(start, end) {
  start = GridCoordinates3d.fromObject(start);
  end = GridCoordinates3d.fromObject(end);
  const points = CONFIG.GeometryLib.utils.bresenhamLine3d(start.i, start.j, start.k, end.i, end.j, end.k);
  const path3d = [start];
  // Convert points to GridCoordinates3d. Start and end repeat; skip.
  for ( let i = 3, n = points.length - 3; i < n; i += 3 ) path3d.push(GridCoordinates3d.fromOffset({
    i: points[i],
    j: points[i + 1],
    k: points[i + 2] }));
  path3d.push(end);
  return path3d;
}

/**
 * Construct a function to determine the offset cost for this canvas for a single 3d move on a square grid.
 * @param {number} numDiagonals
 * @returns {function}
 *   - @param {GridCoordinates3d} prevOffset
 *   - @param {GridCoordinates3d} currOffset
 *   - @returns {number}
 */
function singleOffsetSquareDistanceFn(numDiagonals = 0) {
  const D = CONST.GRID_DIAGONALS;
  let nDiag = numDiagonals;
  let fn;
  if ( canvas.grid.diagonals === D.ALTERNATING_1 || canvas.grid.diagonals === D.ALTERNATING_2 ) {
    const kFn = canvas.grid.diagonals === D.ALTERNATING_1
      ? () => nDiag & 1 ? 2 : 1
      : () => nDiag & 1 ? 1 : 2;
    fn = (prevOffset, currOffset) => {
      const isElevationMove = prevOffset.k !== currOffset.k;
      const isStraight2dMove = (prevOffset.i === currOffset.i) ^ (prevOffset.j === currOffset.j);
      const isDiagonal2dMove = (prevOffset.i !== currOffset.i) && (prevOffset.j !== currOffset.j);
      const s = isStraight2dMove || (!isDiagonal2dMove && isElevationMove);
      const d1 = isDiagonal2dMove && !isElevationMove;
      const d2 = isDiagonal2dMove && isElevationMove;
      if ( d1 || d2 ) nDiag++;
      const k = kFn();
      return (s + (k * d1) + (k * d2)) * canvas.grid.distance;
    };
  } else {
    let k = 1;
    let k2 = 1;
    switch ( canvas.grid.diagonals ) {
      case D.EQUIDISTANT: k = 1; k2 = 1; break;
      case D.EXACT: k = Math.SQRT2; k2 = Math.SQRT3; break;
      case D.APPROXIMATE: k = 1.5; k2 = 1.75; break;
      case D.RECTILINEAR: k = 2; k2 = 3; break;
    }
    fn = (prevOffset, currOffset) => {
      const isElevationMove = prevOffset.k !== currOffset.k;
      const isStraight2dMove = (prevOffset.i === currOffset.i) ^ (prevOffset.j === currOffset.j);
      const isDiagonal2dMove = (prevOffset.i !== currOffset.i) && (prevOffset.j !== currOffset.j);
      const s = isStraight2dMove || (!isDiagonal2dMove && isElevationMove);
      const d1 = isDiagonal2dMove && !isElevationMove;
      const d2 = isDiagonal2dMove && isElevationMove;
      return (s + (k * d1) + (k2 * d2)) * canvas.grid.distance;
    };
  }
  Object.defineProperty(fn, "diagonals", {
    get: () => nDiag
  });
  return fn;
}

// ----- NOTE: HexagonalGrid ----- //

/**
 * Constructs a direct path for a hex grid, accounting for elevation and diagonal elevation.
 * Spreads out the elevation moves over the course of the path.
 * For a hex grid, there is no "double diagonal" to worry about.
 * @param {RegionMovementWaypoint3d} start
 * @param {RegionMovementWaypoint3d} end
 * @param {GridOffset[]} [path2d]             Optional path2d for the start and end waypoints.
 * @returns {HexGridCoordinates3d[]}
 */
function directPath3dHex(start, end) {
  start = HexGridCoordinates3d.fromObject(start);
  end = HexGridCoordinates3d.fromObject(end);
  const points = CONFIG.GeometryLib.utils.bresenhamLine4d(
    start.q, start.r, start.s, start.k,
    end.q, end.r, end.s, end.k);
  const path3d = [start];
  // Convert points to GridCoordinates3d. Start and end repeat; skip.
  for ( let i = 4, n = points.length - 4; i < n; i += 4 ) path3d.push(HexGridCoordinates3d.fromHexCube({
    q: points[i],
    r: points[i + 1],
    s: points[i + 2],
    k: points[i + 3] }));
  path3d.push(end);
  return path3d;
}

/**
 * Construct a function to determine the offset cost for this canvas for a single 3d move on a hex grid.
 * For hexes, the diagonal only occurs with an elevation + hex move.
 * @param {number} numDiagonals
 * @returns {function}
 *   - @param {GridCoordinates3d} prevOffset
 *   - @param {GridCoordinates3d} currOffset
 *   - @returns {number}
 */
function singleOffsetHexDistanceFn(numDiagonals = 0) {
  const D = CONST.GRID_DIAGONALS;
  let nDiag = numDiagonals;
  let fn;
  if ( canvas.grid.diagonals === D.ALTERNATING_1 || canvas.grid.diagonals === D.ALTERNATING_2 ) {
    const kFn = canvas.grid.diagonals === D.ALTERNATING_1
      ? () => nDiag & 1 ? 2 : 1
      : () => nDiag & 1 ? 1 : 2;
    fn = (prevOffset, currOffset) => {
      // For hex moves, no diagonal 2d. Just diagonal if both elevating and moving in 2d.
      const isElevationMove = prevOffset.k !== currOffset.k;
      const is2dMove = prevOffset.i !== currOffset.i || prevOffset.j !== currOffset.j;
      const s = isElevationMove ^ is2dMove;
      const d = !s;
      nDiag += d;
      const k = kFn();
      return (s + (k * d)) * canvas.grid.distance;
    };
  } else {
    let k = 1;
    switch ( canvas.grid.diagonals ) {
      case D.EQUIDISTANT: k = 1; break;
      case D.EXACT: k = Math.SQRT2; break;
      case D.APPROXIMATE: k = 1.5; break;
      case D.RECTILINEAR: k = 2; break;
    }
    fn = (prevOffset, currOffset) => {
      const isElevationMove = prevOffset.k !== currOffset.k;
      const is2dMove = prevOffset.i !== currOffset.i || prevOffset.j !== currOffset.j;
      const s = isElevationMove ^ is2dMove;
      const d = !s;
      return (s + (k * d)) * canvas.grid.distance;
    };
  }
  Object.defineProperty(fn, "diagonals", {
    get: () => nDiag
  });
  return fn;
}

/**
 * Get the function to measure the offset distance for a given distance with given previous diagonals.
 * @param {number} [diagonals=0]
 * @returns {function}
 */
export function getOffsetDistanceFn(diagonals = 0) {
  let offsetDistanceFn;
  switch ( canvas.grid.type ) {
    case CONST.GRID_TYPES.GRIDLESS:
      offsetDistanceFn = (a, b) => CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));
      break;
    case CONST.GRID_TYPES.SQUARE:
      offsetDistanceFn = singleOffsetSquareDistanceFn(diagonals);
      break;
    default: // All hex grids
      offsetDistanceFn = singleOffsetHexDistanceFn(diagonals);
  }
  return offsetDistanceFn;
}

/**
 * Measure a path for a gridded scene. Handles hex and square grids.
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */
function _measurePath(wrapped, waypoints, { cost }, result) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, { cost }, result);
  initializeResultObject(result);
  result.waypoints.forEach(waypoint => initializeResultObject(waypoint));
  result.segments.forEach(segment => initializeResultObject(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost
  // because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let start = waypoints[0];
  cost ??= (prevOffset, currOffset, offsetDistance) => offsetDistance;
  const offsetDistanceFn = getOffsetDistanceFn(0); // Diagonals = 0.
  const altGridDistanceFn = GridCoordinates3d.alternatingGridDistanceFn();
  let diagonals = canvas.grid.diagonals ?? game.settings.get("core", "gridDiagonals");
  const D = GridCoordinates3d.GRID_DIAGONALS;
  if ( diagonals === D.EXACT && Settings.get(Settings.KEYS.MEASURING.EUCLIDEAN_GRID_DISTANCE) ) diagonals = D.EUCLIDEAN;
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = waypoints[i];
    const path3d = canvas.grid.getDirectPath([start, end]);
    const segment = result.segments[i - 1];
    segment.spaces = path3d.length - 1;
    let prevPathPt = path3d[0]; // Path points are GridCoordinates3d.
    const prevDiagonals = offsetDistanceFn.diagonals;
    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      const currPathPt = path3d[j];
      const dist = GridCoordinates3d.gridDistanceBetween(prevPathPt, currPathPt, { altGridDistanceFn, diagonals });
      const offsetDistance = offsetDistanceFn(prevPathPt, currPathPt);
      segment.distance += dist;
      segment.offsetDistance += offsetDistance;
      segment.cost += cost(prevPathPt, currPathPt, offsetDistance);
      prevPathPt = currPathPt;
    }
    segment.diagonals = offsetDistanceFn.diagonals - prevDiagonals;

    // Accumulate the waypoint totals
    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment.distance;
    resultEndWaypoint.cost = resultStartWaypoint.cost + segment.cost;
    resultEndWaypoint.spaces = resultStartWaypoint.spaces + segment.spaces;
    resultEndWaypoint.diagonals = resultStartWaypoint.diagonals + segment.diagonals;
    resultEndWaypoint.offsetDistance = resultStartWaypoint.offsetDistance + segment.offsetDistance;

    // Accumulate the result totals
    result.distance += resultEndWaypoint.distance;
    result.cost += resultEndWaypoint.cost;
    result.spaces += resultEndWaypoint.spaces;
    result.diagonals += resultEndWaypoint.diagonals;
    result.offsetDistance += resultEndWaypoint.offsetDistance;

    // Iterate to next segment.
    start = end;
  }


  return result;
}

/**
 * Wrap HexagonalGrid#getDirectPath and SquareGrid#getDirectPath
 * Returns the sequence of grid offsets of a shortest, direct path passing through the given waypoints.
 * @param {Point3d[]} waypoints            The waypoints the path must pass through
 * @returns {GridOffset[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function getDirectPathGridded(wrapped, waypoints) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints);
  let prevWaypoint = GridCoordinates3d.fromObject(waypoints[0]);
  const path3d = [];
  const path3dFn = canvas.grid.isHexagonal ? directPath3dHex : directPath3dSquare;
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const currWaypoint = GridCoordinates3d.fromObject(waypoints[i]);
    const segments3d = path3dFn(prevWaypoint, currWaypoint);
    path3d.push(...segments3d);
    prevWaypoint = currWaypoint;
  }
  return path3d;
}

// ----- NOTE: Patches ----- //

PATCHES_GridlessGrid.BASIC.WRAPS = { getDirectPath: getDirectPathGridless };
PATCHES_SquareGrid.BASIC.WRAPS = { getDirectPath: getDirectPathGridded };
PATCHES_HexagonalGrid.BASIC.WRAPS = { getDirectPath: getDirectPathGridded };

PATCHES_GridlessGrid.BASIC.MIXES = { _measurePath };
PATCHES_SquareGrid.BASIC.MIXES = { _measurePath };
PATCHES_HexagonalGrid.BASIC.MIXES = { _measurePath };

// ----- NOTE: Helper functions ----- //

/**
 * Define certain parameters required in the result object.
 */
function initializeResultObject(obj) {
  obj.distance ??= 0;
  obj.spaces ??= 0;
  obj.cost ??= 0;
  obj.diagonals ??= 0;
  obj.offsetDistance ??= 0;
}


