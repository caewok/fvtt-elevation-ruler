/* globals
canvas,
CONFIG,
CONST,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GridCoordinates, GridCoordinates3d, RegionMovementWaypoint3d } from "./grid_coordinates_new.js";
import { Point3d } from "../geometry/3d/Point3d.js";

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
 * Wrap GridlessGrid.prototype._measurePath
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */
function _measurePathGridless(wrapped, waypoints, {cost}, result) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  initializeResultObject(result);
  result.waypoints.forEach(waypoint => initializeResultObject(waypoint));
  result.segments.forEach(segment => initializeResultObject(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let diagonals = 0;
  let start = waypoints[0];
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = waypoints[i];
    const path3d = directPath3dGridless(start, end);
    const segment = result.segments[i - 1];
    segment.spaces = path3d.length;
    let costForSegment = 0;
    let distanceForSegment = 0;
    let prevOffset = path3d[0];
    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      const currOffset = path3d[j];
      const isElevationMove = prevOffset.k !== currOffset.k;
      const offsetDistance = Point3d.distanceBetween(prevOffset, currOffset);
      segment.distance += offsetDistance;
      segment.cost += cost(prevOffset, currOffset, offsetDistance);

      // Iterate to next offset.
      prevOffset = currOffset;
    }

    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment.distance;
    resultEndWaypoint.cost = resultStartWaypoint.cost + segment.cost;
    resultEndWaypoint.spaces = resultStartWaypoint.space + segment.spaces;

    // Iterate to next segment.
    start = end;
  }
  return result;
}

/**
 * Mixed wrap GridlessGrid#getDirectPath
 * Returns the sequence of grid offsets of a shortest, direct path passing through the given waypoints.
 * @param {GridCoordinates[]} waypoints    The waypoints the path must pass through
 * @returns {GridOffset[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function getDirectPathGridless(wrapped, waypoints) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  let prevWaypoint = waypoints[0];
  const path3d = [];
  for ( let i = 1, n < waypoints.length; i += 1 ) {
    const currWaypoint = waypoints[i];
    path3d.push(...directPathGridless(prevWaypoint, currWaypoint));
    prevWaypoint = currWaypoint;
  }
  return path3d;
}

/**
 * Constructs a direct path for a gridless grid, accounting for elevation.
 * While this returns GridCoordinates3d, the direct path here is simply the offset coordinates.
 * @param {RegionMovementWaypoint3d} start
 * @param {RegionMovementWaypoint3d} end
 * @returns {GridCoordinates3d[]}
 */
function directPathGridless(start, end) {
  return [start, end]
    .map(pt => GridCoordinates3d.fromObject(pt).centerToOffset());
}


// ----- NOTE: SquareGrid ----- //

// Note: result.cost is the grid space distance. result.distance is the euclidean distance modified by the diagonal distance rule.

/**
 * Wrap SquareGrid.prototype._measurePath
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */
function _measurePathSquareGrid(wrapped, waypoints, {cost}, result) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  initializeResultObject(result);
  result.waypoints.forEach(waypoint => initializeResultObject(waypoint));
  result.segments.forEach(segment => initializeResultObject(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let diagonals = 0;
  let start = waypoints[0];
  const offsetDistanceFn = singleOffsetSquareDistanceFn(diagonals);
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = waypoints[i];
    const path3d = directPath3dSquare(start, end);
    const segment = result.segments[i - 1];
    segment.spaces = path3d.length;
    let costForSegment = 0;
    let distanceForSegment = 0;
    let prevOffset = path3d[0];
    const prevDiagonals = offsetDistanceFn.diagonals;
    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      const currOffset = path3d[j];
      const isElevationMove = prevOffset.k !== currOffset.k;
      const isStraight2dMove = (prevOffset.i === currOffset.i) ^ (prevOffset.j === currOffset.j);
      const isDiagonal2dMove = (prevOffset.i !== currOffset.i) && (prevOffset.j !== currOffset.j);
      const offsetDistance = offsetDistanceFn(isElevationMove, true, false, );
      segment.distance += offsetDistance;
      segment.cost += cost(prevOffset, currOffset, offsetDistance);

      // Iterate to next offset.
      prevOffset = currOffset;
    }
    segment.diagonals = offsetDistanceFn.diagonals - prevDiagonals;
    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment.distance;
    resultEndWaypoint.cost = resultStartWaypoint.cost + segment.cost;
    resultEndWaypoint.spaces = resultStartWaypoint.space + segment.spaces;
    resultEndWaypoint.diagonals = resultStartWaypoint.diagonals + segment.diagonals;

    // Iterate to next segment.
    start = end;
  }
  return result;
}

/**
 * Mixed wrap SquareGrid#getDirectPath
 * Returns the sequence of grid offsets of a shortest, direct path passing through the given waypoints.
 * @param {GridCoordinates[]} waypoints    The waypoints the path must pass through
 * @returns {GridOffset[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function getDirectPathSquareGrid(wrapped, waypoints) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  let prevWaypoint = waypoints[0];
  const path3d = [];
  for ( let i = 1, n < waypoints.length; i += 1 ) {
    const currWaypoint = waypoints[i];
    path3d.push(...directPath3dSquare(prevWaypoint, currWaypoint));
    prevWaypoint = currWaypoint;
  }
  return path3d;
}


/**
 * Constructs a direct path for a square grid, accounting for elevation and diagonal elevation
 * in a quasi-optimal manner. Spreads out the elevation moves over the course of the path.
 * Double-diagonals are slightly favored for some diagonal measurement
 * types, so this accounts for those by preferring to move elevation when moving 2d diagonally.
 * @param {RegionMovementWaypoint3d} start
 * @param {RegionMovementWaypoint3d} end
 * @returns {GridCoordinates3d[]}
 */
function directPath3dSquare(start, end) {
  const path2d = canvas.grid.getDirectPath([start.to2d(), end.to2d()]);
  if ( start.z.almostEqual(end.z) ) {
    const elev = start.elevation;
    return path2d.map(pt => GridCoordinates3d.fromOffset(pt, elev));
  }

  const num2dMoves = path2d.length - 1;
  const prevOffset = GridCoordinates3d.fromObject(start);
  prevOffset.centerToOffset();
  prevOffset.i = path2d[0].i;
  prevOffset.j = path2d[0].j;

  // currOffset will be modified in the loop but needs to have the starting elevation.
  const currOffset = new GridCoordinates3d();
  currOffset.k = prevOffset.k;

  // Do 1 elevation move for each 2d diagonal move. Spread out over the diagonal steps.
  const num2dDiagonal = 0;
  let prev = path2d[0];
  for ( let i = 1, n = path2d.length; i < n; i += 1 ) {
    const curr = path2d[i];
    num2dDiagonal += ((prev.i !== curr.i) && (prev.j !== curr.j));
    prev = curr;
  }
  const elevationStepsRemaining = Math.abs(prevOffset.k - endOffset.k);
  let doubleDiagonalElevationStepsRemaining = Math.min(num2dDiagonal, elevationStepsRemaining);
  let doubleDiagonalElevationStep = 0;
  const doDoubleDiagonalElevationStepMod = Math.ceil(num2dDiagonal / (doubleDiagonalElevationStepsRemaining + 1));

  // Do 1 elevation move for each 2d non-diagonal move. Spread out over the non-diagonal steps.
  const num2dStraight = num2dMoves - num2dDiagonal;
  let diagonalElevationStepsRemaining = Math.min(elevationStepsRemaining - doubleDiagonalElevationStepsRemaining, num2dStraight);
  let diagonalElevationStep = 0;
  const doDiagonalElevationStepMod = Math.ceil(num2dStraight / (diagonalElevationStepsRemaining + 1));

  // Rest are all additional elevation-only moves. Spread out evenly.
  let additionalElevationStepsRemaining = Math.max(0, elevationStepsRemaining - diagonalElevationStepsRemaining - diagonalElevationStepsRemaining);
  const doAdditionalElevationStepMod = Math.ceil(num2dMoves / (additionalElevationStepsRemaining + 1));

  const path3d = [startOffset.clone()];
  for ( let i = 1, stepsRemaining = num2dMoves, n = num2dMoves + 1; i < n; i += 1, stepsRemaining -= 1 ) {
    currOffset.i = path2d[i].i;
    currOffset.j = path2d[i].j;

    const is2dDiagonal = (currOffset.i !== prevOffset.i) && (currOffset.j !== prevOffset.j);
    const doDoubleDiagonalElevationStep = is2dDiagonal && doubleDiagonalElevationStepsRemaining > 0 && ((doubleDiagonalElevationStep + 1) % doDoubleDiagonalElevationStepMod) === 0;
    const doDiagonalElevationStep = !is2dDiagonal && diagonalElevationStepsRemaining > 0 && ((diagonalElevationStep + 1) % doDiagonalElevationStepMod) === 0;
    const doAdditionalElevationSteps = additionalElevationStepsRemaining > 0 && ((i + 1) % doAdditionalElevationStepMod) === 0;

    console.log(`${i} ${stepsRemaining}`,
      { doDoubleDiagonalElevationStep, doDiagonalElevationStep, doAdditionalElevationSteps },
      { doubleDiagonalElevationStepsRemaining, diagonalElevationStepsRemaining, additionalElevationStepsRemaining });

    // Either double or normal diagonals are the same but have separate tracking.
    if ( doDoubleDiagonalElevationStep ) {
      currOffset.k += 1;
      doubleDiagonalElevationStepsRemaining -= 1;
      doubleDiagonalElevationStep += 1;
    } else if ( doDiagonalElevationStep ) {
      currOffset.k += 1;
      diagonalElevationStepsRemaining -= 1;
      diagonalElevationStep += 1;
    }
    path3d.push(currOffset.clone());

    if ( doAdditionalElevationSteps ) {
      let elevationSteps =  Math.ceil(additionalElevationStepsRemaining / stepsRemaining);
      console.log("\t", { elevationSteps });
      while ( elevationSteps > 0 ) {
        currOffset.k += 1;
        elevationSteps -= 1;
        additionalElevationStepsRemaining -= 1;
        path3d.push(currOffset.clone());
      }
    }
    prevOffset.setOffset(currOffset);
  }
  return path3d;
}


/**
 * Construct a function to determine the offset cost for this canvas for a single 3d move on a hex grid.
 * For hexes, the diagonal only occurs with an elevation + hex move.
 * @param {number} numDiagonals
 * @returns {function}
 *   - @param {boolean} elevationMove
 *   - @param {boolean} canvasStraightMove
 *   - @returns {number}
 */
function singleOffsetHexDistanceFn(numDiagonals = 0) {
  const D = CONST.GRID_DIAGONALS;
  let nDiag = numDiagonals;
  let fn;
  if ( canvas.grid.diagonals === D.ALTERNATING_1 || canvas.grid.diagonals === D.ALTERNATING_2 ) {
    const kFn = canvas.grid.diagonals === D.ALTERNATING_1
      ? () => d & 1 ? 2 : 1;
        : () => d & 1 ? 1 : 2;
    fn = (elevationMove, canvasStraightMove) => {
      const s = canvasStraightMove || (!canvasDiagonalMove && elevationMove);
      const d = canvasStraightMove && elevationMove;
      nDiag += d;
      const k = kFn();
      return (s + k * d) * canvas.grid.distance;
    };
  } else {
    let k = 1;
    switch ( canvas.grid.diagonals ) {
        case D.EQUIDISTANT: k = 1; break;
        case D.EXACT: k = Math.SQRT2; break;
        case D.APPROXIMATE: k = 1.5;  break;
        case D.RECTILINEAR: k = 2; break;
    }
    fn = (elevationMove, canvasStraightMove) => {
      const s = canvasStraightMove || (!canvasDiagonalMove && elevationMove);
      const d = canvasStraightMove && elevationMove;
      return (s + k * d) * canvas.grid.distance;
    };
  }
  Object.defineProperty(fn, "diagonals", {
    get : () => nDiag
  });
  return fn;
}

/**
 * Construct a function to determine the offset cost for this canvas for a single 3d move on a square grid.
 * @param {number} numDiagonals
 * @returns {function}
 *   - @param {boolean} elevationMove
 *   - @param {boolean} canvasStraightMove
 *   - @param {boolean} canvasDiagonalMove
 *   - @returns {number}
 */
function singleOffsetSquareDistanceFn(numDiagonals = 0) {
  const D = CONST.GRID_DIAGONALS;
  let nDiag = numDiagonals;
  let fn;
  if ( canvas.grid.diagonals === D.ALTERNATING_1 || canvas.grid.diagonals === D.ALTERNATING_2 ) {
    const kFn = canvas.grid.diagonals === D.ALTERNATING_1
      ? () => d & 1 ? 2 : 1;
        : () => d & 1 ? 1 : 2;
    fn = (elevationMove, canvasStraightMove, canvasDiagonalMove) => {
      const s = canvasStraightMove || (!canvasDiagonalMove && elevationMove);
      const d1 = canvasDiagonalMove && !elevationMove;
      const d2 = canvasDiagonalMove && elevationMove;
      if ( d1 || d2 ) nDiag++;
      const k = kFn();
      return (s + k * d1 + k * d2) * canvas.grid.distance;
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
    fn = (elevationMove, canvasStraightMove, canvasDiagonalMove) => {
      const s = canvasStraightMove || (!canvasDiagonalMove && elevationMove);
      const d1 = canvasDiagonalMove && !elevationMove;
      const d2 = canvasDiagonalMove && elevationMove;
      return (s + k * d1 + k2 * d2) * canvas.grid.distance;
    };
  }
  Object.defineProperty(fn, "diagonals", {
    get : () => nDiag
  });
  return fn;
}






/**
 * Determine the cost for a single move from one offset to the next.
 * Offsets come from gridUnder3dLine.
 * @param {number} diagonals    Diagonals previous to this.
 * @returns {function} A function used to track diagonals and return the next distance.
 *   - @prop {number} diagonals
 *   - @param {GridCoordinates3d} a
 *   - @param {GridCoordinates3d} b
 *   - @returns {number} Cost of the move
 */
function offsetMoveCost(diagonals = 0) {
  const D = CONST.GRID_DIAGONALS;
  let fnDiagonals = diagonals;
  const fn = (a, b) => {
    const change = gridChangeType3d(a, b);
    let k = 1;
    if ( change === CHANGE.D ) {
      switch ( canvas.grid.diagonals ) {
        case D.EQUIDISTANT: k = 1; break;
        case D.EXACT: k = Math.SQRT2; break;
        case D.APPROXIMATE: k = 1.5; break;
        case D.RECTILINEAR: k = 2; break;
        case D.ALTERNATING_1: k = fnDiagonals & 1 ? 2 : 1; break;
        case D.ALTERNATING_2: k = fnDiagonals & 1 ? 1 : 2; break;
      }
      fnDiagonals += 1;
    }
    return k * canvas.dimensions.distance;
  };
  Object.defineProperty(fn, "diagonals", {
    get : () => fnDiagonals
  });
  return fn;
}

/**
 * Type of change between two 3d grid coordinates.
 * @param {GridCoordinates3d} a
 * @param {GridCoordinates3d} b
 * @returns {CHANGE}
 */
function gridChangeType3d(a, b) {
  const xChange = a.j !== b.j;
  const yChange = a.i !== b.i;
  const zChange = a.k !== b.k;
  const change2d = CHANGE[((xChange * 2) + yChange)];
  if ( !zChange ) return change2d; // No elevation, so return the 2d change.
  return change2d ? CHANGE.D : CHANGE.V; // Any elevation plus 2d is a diagonal; otherwise elevation is a V.
}

// ----- NOTE: HexagonalGrid ----- //

/**
 * Mixed wrap HexagonalGrid.prototype._measurePath
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */

function _measurePathHexagonalGrid(wrapped, waypoints, {cost}, result) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  initializeResultObject(result);
  result.waypoints.forEach(waypoint => initializeResultObject(waypoint));
  result.segments.forEach(segment => initializeResultObject(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let diagonals = 0;
  let start = waypoints[0];
  const offsetDistanceFn = singleOffsetDistanceFn(diagonals);
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = waypoints[i];
    const path3d = directPath3dHex(start, end);
    const segment = result.segments[i - 1];
    segment.spaces = path3d.length;
    let costForSegment = 0;
    let distanceForSegment = 0;
    let prevOffset = path3d[0];
    const prevDiagonals = offsetDistanceFn.diagonals;
    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      const currOffset = path3d[j];
      const isElevationMove = prevOffset.k !== currOffset.k;
      const offsetDistance = offsetDistanceFn(true, false, isElevationMove);
      segment.distance += offsetDistance;
      segment.cost += cost(prevOffset, currOffset, offsetDistance);

      // Iterate to next offset.
      prevOffset = currOffset;
    }
    segment.diagonals = offsetDistanceFn.diagonals - prevDiagonals;

    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment.distance;
    resultEndWaypoint.cost = resultStartWaypoint.cost + segment.cost;
    resultEndWaypoint.spaces = resultStartWaypoint.space + segment.spaces;

    // Iterate to next segment.
    start = end;
  }
  return result;
}

/**
 * Mixed wrap HexagonalGrid#getDirectPath
 * Returns the sequence of grid offsets of a shortest, direct path passing through the given waypoints.
 * @param {GridCoordinates[]} waypoints    The waypoints the path must pass through
 * @returns {GridOffset[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function getDirectPathHexagonalGrid(wrapped, waypoints) {
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  let prevWaypoint = waypoints[0];
  const path3d = [];
  for ( let i = 1, n < waypoints.length; i += 1 ) {
    const currWaypoint = waypoints[i];
    path3d.push(...directPath3dHex(prevWaypoint, currWaypoint));
    prevWaypoint = currWaypoint;
  }
  return path3d;
}

/**
 * Measure a path for a gridded scene. Handles hex and square grids.
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */
function _measurePathGridded(waypoints, { cost }, result) {
  initializeResultObject(result);
  result.waypoints.forEach(waypoint => initializeResultObject(waypoint));
  result.segments.forEach(segment => initializeResultObject(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let diagonals = 0;
  let start = waypoints[0];
  const offsetDistanceFn = canvas.grid.isHexagonal ? singleOffsetHexDistanceFn(diagonals) : singleOffsetSquareDistanceFn(diagonals);
  const pathFn = canvas.grid.isHexagonal ? directPath3dHex : directPath3dSquare;
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = waypoints[i];
    const path3d = pathFn(start, end);
    const segment = result.segments[i - 1];
    segment.spaces = path3d.length;
    let costForSegment = 0;
    let distanceForSegment = 0;
    let prevOffset = path3d[0];
    const prevDiagonals = offsetDistanceFn.diagonals;
    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      const currOffset = path3d[j];
      const isElevationMove = prevOffset.k !== currOffset.k;
      const isStraight2dMove = (prevOffset.i === currOffset.i) ^ (prevOffset.j === currOffset.j);
      const isDiagonal2dMove = (prevOffset.i !== currOffset.i) && (prevOffset.j !== currOffset.j);
      const offsetDistance = offsetDistanceFn(isElevationMove, isStraight2dMove, isDiagonal2dMove);
      segment.distance += offsetDistance;
      segment.cost += cost(prevOffset, currOffset, offsetDistance);

      // Iterate to next offset.
      prevOffset = currOffset;
    }
    segment.diagonals = offsetDistanceFn.diagonals - prevDiagonals;
    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment.distance;
    resultEndWaypoint.cost = resultStartWaypoint.cost + segment.cost;
    resultEndWaypoint.spaces = resultStartWaypoint.space + segment.spaces;
    resultEndWaypoint.diagonals = resultStartWaypoint.diagonals + segment.diagonals;

    // Iterate to next segment.
    start = end;
  }
  return result;
}


/**
 * Constructs a direct path for a hex grid, accounting for elevation and diagonal elevation.
 * Spreads out the elevation moves over the course of the path.
 * For a hex grid, there is no "double diagonal" to worry about.
 * @param {RegionMovementWaypoint3d} start
 * @param {RegionMovementWaypoint3d} end
 * @returns {GridCoordinates3d[]}
 */
function directPath3dHex(start, end) {
  const path2d = canvas.grid.getDirectPath([start.to2d(), end.to2d()]);
  if ( start.z.almostEqual(end.z) ) {
    const elev = start.elevation;
    return path2d.map(pt => GridCoordinates3d.fromOffset(pt, elev));
  }

  const num2dMoves = path2d.length - 1;
  const startOffset = GridCoordinates3d.fromObject(start);
  startOffset.centerToOffset();
  startOffset.i = path2d[0].i;
  startOffset.j = path2d[0].j;

  // currOffset will be modified in the loop but needs to have the starting elevation.
  const currOffset = new GridCoordinates3d();
  currOffset.k = startOffset.k;

  const path3d = [startOffset.clone()];
  let elevationStepsRemaining = Math.abs(startOffset.k - endOffset.k);
  const doElevationStepMod = Math.ceil((num2dMoves) / (elevationStepsRemaining + 1));
  for ( let i = 1, stepsRemaining = num2dMoves, n = num2dMoves + 1; i < n; i += 1, stepsRemaining -= 1 ) {
    currOffset.i = path2d[i].i;
    currOffset.j = path2d[i].j;

    const doElevationStep = ((i + 1) % doElevationStepMod) === 0;
    let elevationSteps = doElevationStep && (elevationStepsRemaining > 0) ? Math.ceil(elevationStepsRemaining / stepsRemaining) : 0;
    console.log(`${i} ${stepsRemaining} | elevationSteps: ${elevationSteps}`)
    elevationStepsRemaining -= elevationSteps

    // Apply the first elevation step as a diagonal upwards move in combination with the canvas 2d move.
    if ( elevationSteps ) {
      currOffset.k += 1;
      elevationSteps -= 1;
    }
    path3d.push(currOffset.clone());

    // Add additional elevation-only moves as necessary.
    while ( elevationSteps > 0 ) {
      currOffset.k += 1;
      elevationSteps -= 1;
      path3d.push(currOffset.clone());
    }
  }
  return path3d;
}


// ----- NOTE: Patches ----- //

PATCHES_GridlessGrid.BASIC.WRAPS = { _measurePath: _measurePathGridless, getDirectPath: getDirectPathGridless };
PATCHES_SquareGrid.BASIC.WRAPS = { _measurePath: _measurePathSquareGrid, getDirectPath: getDirectPathSquareGrid };
PATCHES_HexagonalGrid.BASIC.WRAPS = { _measurePath: _measurePathHexagonalGrid, getDirectPath: getDirectPathHexagonalGrid };

// ----- NOTE: Helper functions ----- //

/**
 * Define certain parameters required in the result object.
 */
function initializeResultObject(obj) {
  obj.distance ??= 0;
  obj.spaces ??= 0;
  obj.cost ??= 0;
}

/**
 * Define certain parameters required in the result object.
 */
function initializeResultObjectSquareGrid(obj) {
  obj.distance ??= 0;
  obj.spaces ??= 0;
  obj.cost ??= 0;
  obj.diagonals ??= 0;
}

/* Debugging
  result = {
      waypoints: [],
      segments: []
    };
    if ( waypoints.length !== 0 ) {
      let from = {backward: null, forward: null};
      result.waypoints.push(from);
      for ( let i = 1; i < waypoints.length; i++ ) {
        const to = {backward: null, forward: null};
        const segment = {from, to};
        from.forward = to.backward = segment;
        result.waypoints.push(to);
        result.segments.push(segment);
        from = to;
      }
    }
*/

/**
 * Construct a result object for use when passing projected waypoints to _measurePath.
 * See BaseGrid.prototype.measurePath.
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @returns {GridMeasurePathResult}
 */
function constructGridMeasurePathResult(waypoints) {
  const result = {
    waypoints: [],
    segments: []
  };
  if ( waypoints.length !== 0 ) {
    let from = {backward: null, forward: null};
    result.waypoints.push(from);
    for ( let i = 1; i < waypoints.length; i++ ) {
      const to = {backward: null, forward: null};
      const segment = {from, to};
      from.forward = to.backward = segment;
      result.waypoints.push(to);
      result.segments.push(segment);
      from = to;
    }
  }
  return result;
}


/*
 * Project a 3d segment to 2d.
 * @param {Point3d} origin
 * @param {Point3d} destination
 * @returns {object} The starting and ending points.
 *   - @prop {PIXI.Point} origin2d
 *   - @prop {PIXI.Point} destination2d
 */
function project3dLineGridless(origin, destination) {
  const dist2d = PIXI.Point.distanceBetween(origin, destination);
  const zElev = destination.z - origin.z;
  return {
    origin2d: origin.to2d(),
    destination2d: new PIXI.Point(origin.x + dist2d, origin.y + zElev)
  };
}

/*
 * Project a 3d segment to 2d for a hex grid.
 * Projected in a specific manner such that a straight line move represents elevation-only travel.
 * For hex rows, this is a horizontal move. For hex columns or squares, this is a vertical move.
 * @param {GridCoordinates3d} origin       Origination point
 * @param {GridCoordinates3d} destination  Destination point
 * @returns {object} Starting and ending points for the projected line segment
 *   - @prop {GridCoordinates} origin2d
 *   - @prop {GridCoordinates} destination2d
 */
function project3dLineHexagonalGrid(origin, destination) {
  // Determine the number of elevation steps.
  // const cOrigin = GridCoordinates3d.gridCenterForPoint(origin);
  // const cDest = GridCoordinates3d.gridCenterForPoint(destination);
  const zElev = destination.z - origin.z;

  // Projected distance.
  const dist2d = PIXI.Point.distanceBetween(origin, destination);
  const origin2d = GridCoordinates.fromObject(origin);
  const destination2d = isHexRow()
    ? new GridCoordinates(origin.x + zElev, origin.y + dist2d)
    : new GridCoordinates(origin.x + dist2d, origin.y + zElev);
  return { origin2d, destination2d };
}

/*
 * Project a 3d segment to 2d for a gridded scene.
 * Projected in a specific manner such that a straight line move represents elevation-only travel.
 * @param {GridCoordinates3d} origin       Origination point
 * @param {GridCoordinates3d} destination  Destination point
 * @returns {object} Starting and ending points for the projected line segment
 *   - @prop {GridCoordinates} origin2d
 *   - @prop {GridCoordinates} destination2d
 */
function project3dLineSquareGrid(origin, destination) {
  // Determine the number of elevation steps.
  // const cOrigin = GridCoordinates3d.gridCenterForPoint(origin);
  // const cDest = GridCoordinates3d.gridCenterForPoint(destination);
  const zElev = destination.z - origin.z;

  // Projected distance.
  const dist2d = PIXI.Point.distanceBetween(origin, destination);
  const origin2d = GridCoordinates.fromObject(origin);
  const destination2d = new GridCoordinates(origin.x + dist2d, origin.y + zElev);
  return { origin2d, destination2d };
}

/*
 * Project a 3d segment to 2d for a scene. Depends on grid type.
 * Projected in a specific manner such that a straight line move represents elevation-only travel.
 * @param {Point3d} origin       Origination point
 * @param {Point3d} destination  Destination point
 * @returns {object} Starting and ending points for the
 */
export function project3dLine(origin, destination) {
  if ( canvas.grid.isGridless ) return project3dLineGridless(origin, destination);
  if ( canvas.grid.isHexagonal ) return project3dLineHexagonalGrid(origin, destination);
  return project3dLineSquareGrid(origin, destination);
}

/**
 * @returns {boolean} True if the grid is a row hex.
 */
function isHexRow() {
  return canvas.grid.type === CONST.GRID_TYPES.HEXODDR
    || canvas.grid.type === CONST.GRID_TYPES.HEXEVENR;
}

/**
 * Get the grid coordinates for a segment between origin and destination.
 * Supplies coordinates in 3 dimensions.
 * @param {GridCoordinates3d} origin        Origination point
 * @param {GridCoordinates3d} destination   Destination point
 * @returns {GridCoordinates3d[]} Array containing each grid point under the line.
 */
export function gridUnder3dLine(origin, destination) {
  // If no elevation change, return the 2d version.
  const elevSign = Math.sign(destination.z - origin.z);
  if ( !elevSign ) {
    const elev = destination.elevation;
    return canvas.grid.getDirectPath([origin, destination]).map(pt => GridCoordinates3d.fromOffset(pt, elev));
  }

  // Determine the grid coordinates for the 2d line and the projected 2d line.
  const path2d = canvas.grid.getDirectPath([origin, destination]);
  const { origin2d, destination2d } = project3dLine(origin, destination);
  const pathProj = canvas.grid.getDirectPath([origin2d, destination2d]);
  const diagAllowed = canvas.grid.diagonals !== CONST.GRID_DIAGONALS.ILLEGAL;
  const [elevationAxis, canvasAxis] = isHexRow() ? ["j", "i"] : ["i", "j"];

  // const [elevOnlyMove, canvasOnlyMove] = isHexRow() ? ["H", "V"] : ["V", "H"];

  // How many moves do we need?
  let numElevationSteps = Math.abs(pathProj.at(0)[elevationAxis] - pathProj.at(-1)[elevationAxis]);
  const di2d = Math.abs(path2d.at(0).i - path2d.at(-1).i);
  const dj2d = Math.abs(path2d.at(0).j - path2d.at(-1).j);
  const numberDiagonal2d = Math.min(di2d, dj2d);
  let numberFreeElevSteps = Math.max(0, numberElevSteps - numberDiagonal2d);

  // Link the pts to the projected point movement.
  // Follow the projected path and compare to the path2d.
  // If the path2d step is diagonal, increment elevation. Otherwise increment if extra elevations needed (beyond diagonals).
  // If the pathProj step is elevation-only, don't increment the path2d step.
  // Trick is we want to change elevation every time we move diagonally.
  // If we don't have sufficient diagonal moves, we want to move diagonally before reaching the end.
  // --> follow the projection moves in that case.
  const num2dSteps = path2d.length;
  const numProjSteps = pathProj.length;
  let currPosition = GridCoordinates3d.fromOffset(path2d[0]);
  currPosition.z = origin.z;
  const resPts = [currPosition];
  let prevProjPt = projPath[0];
  for ( let i = 0, j = 0; i < numProjSteps && j < num2dSteps; i += 1, j += 1) {
    const currProjPt = projPath[i];
    let hasElevChange = numElevationSteps && prevProjPt[elevationAxis] !== currProjPt[elevationAxis];
    const hasCanvasChange = prevProjPt[canvasAxis] !== currProjPt[canvasAxis];


  }

  // If vertical projection, increment elevation only.
  // If diagonal or horizontal, increment both elevation and grid step.
  // Flip horizontal/vertical for hex rows.


  let prevPt = GridCoordinates3d.fromOffset(path2d[0]);
  let stepIdx = 1;

  // Start by adding the origin point at the origin elevation.
  prevPt.z = origin.z;
  const resPts = [prevPt];

  const elevationOnlyStep = () => {
    if ( !numberElevationStep ) return;
    prevPt = prevPt.clone();
    prevPt.k += elevSign;
    numberElevationStep -= 1;
    resPts.push(prevPt);
  };

  const canvasStep = (elevStep = 0) => {
    if ( !numberElevationStep )  elevStep = 0;
    else if ( elevStep ) numberElevationStep -= 1;
    const currPathStep = path2d[stepIdx];
    stepIdx += 1;
    if ( !currPathStep ) {
      if ( elevStep ) elevationOnlyStep();
      return false;
    }
    const currPt2d = GridCoordinates3d.fromOffset(currPathStep);
    currPt2d.k = prevPt.k + elevStep;
    resPts.push(currPt2d);
    prevPt = currPt2d;
    return true;
  };

  const dualStep = diagAllowed
    ? () => canvasStep(elevSign)
    : () => {
      canvasStep(0);
      elevationOnlyStep();
    };




  // Trick is we want to change elevation every time we move diagonally.
  // If we don't have sufficient diagonal moves, we want to move diagonally before reaching the end.
  // --> follow the projection moves in that case.
  const di2d = Math.abs(path2d[0].i - path2d.at(-1).i)
  const dj2d = Math.abs(path2d[0].j - path2d.at(-1).j)
  const numberDiagonal2d = Math.min(di2d, dj2d);
  const numberElevSteps = isHexRow() ? Math.abs(projPath[0].j - projPath.at(-1).j) : Math.abs(projPath[0].i - projPath.at(-1).i);
  let numberFreeElevSteps = Math.max(0, numberElevSteps - numberDiagonal2d);

  // Cycle through each elevation change. If moving both elevation and 2d, or just 2d,
  // increment to the next 2d point. Otherwise add an interval point with the elevation-only change.
  let prevProjPt = projPath[0];
  for ( let i = 1, n = projPath.length; i < n; i += 1 ) {
    const nextProjPt = projPath[i];
    const changeType2d = gridChangeType2d(path2d[i - 1], path2d[i]);
    let elevChangeType;
    if ( changeType2d === "D" ) elevChangeType = "D"; // Always commit an elevation step with diagonal move.
    else if ( numberFreeElevSteps && (changeType2d === "H"|| changeType2d === "V") ) {
      elevChangeType = "D";
      numberFreeElevSteps -= 1;
    } else elevChangeType = gridChangeType2d(prevProjPt, nextProjPt);

    switch ( elevChangeType ) {
      case elevOnlyMove: elevationOnlyStep(); break;
      case canvasOnlyMove: canvasStep(0); break;
      case "NONE": console.warn("gridUnder3dLine|unexpected elevOnlyMoveType === NONE"); break;
      default: dualStep(); break;
    }
    prevProjPt = nextProjPt;
  }

  // Add in remaining 2d moves, if any.
  while ( canvasStep(0) ) { } // eslint-disable-line no-empty
  return resPts;
}

/**
 * Type of change between two grid coordinates.
 * @param {number[2]} prevGridCoord
 * @param {number[2]} nextGridCoord
 * @returns {CHANGE}
 */
function gridChangeType2d(prevGridCoord, nextGridCoord) {
  const xChange = (prevGridCoord.j !== nextGridCoord.j) || (prevGridCoord.x !== nextGridCoord.x);
  const yChange = (prevGridCoord.i !== nextGridCoord.i) || (prevGridCoord.y !== nextGridCoord.y);
  return CHANGE[((xChange * 2) + yChange)];
}

// ----- NOTE: Debugging ----- //

/**
 * Test gridUnder3dLine.
 */
export function testMeasurePath() {
  console.group("testMeasurePath");
  const pixelsToGridUnits = CONFIG.GeometryLib.utils.pixelsToGridUnits;
  const start = new RegionMovementWaypoint3d(1000, 1200);
  const startOffset = GridCoordinates3d.fromOffset({i: 10, j: 12});
  let end, res, baseline;

  // Move north 4 spaces.
  end = start.add({x: 0, y: 400});
  res = canvas.grid.measurePath([start, end])
  baseline = canvas.grid.measurePath([start.to2d(), end.to2d()])
  logComparison("Move north 400 pixels", baseline, res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 4, j: 0}));
  res = canvas.grid.measurePath([start, end])
  baseline = canvas.grid.measurePath([start.to2d(), end.to2d()])
  logComparison("Move north 4 spaces", baseline, res);

  // Move horizontal 4 spaces.
  end = start.add({x: 400, y: 0});
  res = canvas.grid.measurePath([start, end])
  baseline = canvas.grid.measurePath([start.to2d(), end.to2d()])
  logComparison("Move east 400 pixels", baseline, res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 0, j: 4}));
  res = canvas.grid.measurePath([start, end])
  baseline = canvas.grid.measurePath([start.to2d(), end.to2d()])
  logComparison("Move east 4 spaces", baseline, res);

  // Move diagonal 4 spaces.
  end = start.add({x: 400, y: 400});
  res = canvas.grid.measurePath([start, end])
  baseline = canvas.grid.measurePath([start.to2d(), end.to2d()])
  logComparison("Move northeast 400 pixels", baseline, res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 4, j: 4}));
  res = canvas.grid.measurePath([start, end])
  baseline = canvas.grid.measurePath([start.to2d(), end.to2d()])
  logComparison("Move northeast 4 spaces", baseline, res);

  // NOTE: Elevation. Use known values.
  console.log("\nElevation");

  // Move up 4 spaces.
  end = start.add({x: 0, y: 0, z: 400});
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move up 400 pixels", start, end, GridCoordinates3d.unitElevation(pixelsToGridUnits(400)), res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 0, j: 0, k: 4}));
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move up 4 spaces", start, end, 4, res);

  // Move vertical 4, up 1.
  end = start.add({x: 0, y: 400, z: 100});
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move north 400 pixels, up 100 pixels", start, end, GridCoordinates3d.unitElevation(pixelsToGridUnits(400)), res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 4, j: 0, k: 1}));
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move north 4 spaces, up 1 space", start, end, 4, res);

  // Move horizontal 4, down 1.
  end = start.add({x: 0, y: 400, z: -100});
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move east 400 pixels, down 100 pixels", start, end, GridCoordinates3d.unitElevation(pixelsToGridUnits(400)), res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 4, j: 0, k: -1}));
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move east 4 spaces, down 1 space", start, end, 4, res);

  // Move diagonal 5, up 2.
  end = start.add({x: 500, y: 500, z: 200});
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move diagonal 500 pixels, up 200 pixels", start, end, GridCoordinates3d.unitElevation(pixelsToGridUnits(500)), res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 4, j: 0, k: 2}));
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move diagonal 5 spaces, up 2 spaces", start, end, 5, res);

  // Move diagonal 5, up 3.
  end = start.add({x: 500, y: 500, z: 300});
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move diagonal 500 pixels, up 300 pixels", start, end, GridCoordinates3d.unitElevation(pixelsToGridUnits(500)), res);

  end = startOffset.add(GridCoordinates3d.fromOffset({ i: 5, j: 5, k: 3}));
  res = canvas.grid.measurePath([start, end])
  logElevationComparison("Move diagonal 5 spaces, up 3 spaces", start, end, 5, res);

  console.groupEnd("testGridUnder3dLine")
}

function logComparison(description, baseline, res) {
  const labelFn = bool => bool ? "Ã" : "X";
  const totalDistanceSame = baseline.distance.almostEqual(res.distance)
  const totalsSame = movementResultTotalsEqual(baseline, res);
  const segmentsSame = movementResultSegmentsEqual(baseline, res);
  const waypointsSame = movementResultWaypointsEqual(baseline, res)
  console.log(`${description}. distance: ${labelFn(totalDistanceSame)} | totals:  ${labelFn(totalsSame)} | segments: ${labelFn(segmentsSame)} | waypoints: ${labelFn(waypointsSame)}`)
}

function logElevationComparison(description, a, b, spaces, res) {
  const pixelsToGridUnits = CONFIG.GeometryLib.utils.pixelsToGridUnits;
  console.log(`${description}. \
  distance: ${res.distance.almostEqual(pixelsToGridUnits(Point3d.distanceBetween(a, b))) ? "Ã" : "X"} \
  spaces: ${res.spaces === spaces ? "Ã" : "X"}`);
}


function movementResultObjectsEqual(obj1, obj2) {
  let allSame = true;
  allSame &&= obj1.distance.almostEqual(obj2.distance);
  allSame &&= obj1.spaces.almostEqual(obj2.spaces);
  allSame &&= obj1.cost.almostEqual(obj2.cost);
  if ( typeof obj1.diagonals !== "undefined" ) allSame &&= obj1.diagonals.almostEqual(obj2.diagonals);
  return allSame;
}

function movementResultTotalsEqual(res1, res2) { return movementResultObjectsEqual(res1, res2); }

function movementResultSegmentsEqual(res1, res2) {
  const segments1 = res1.segments;
  const segments2 = res2.segments;
  if ( segments1.length !== segments2.length ) return false;
  for ( let i = 0; i < segments1.length; i += 1 ) {
    const s1 = segments1[i];
    const s2 = segments2[i];
    if ( !movementResultObjectsEqual(s1, s2) ) return false;
  }
  return true;
}

function movementResultWaypointsEqual(res1, res2) {
  const waypoints1 = res1.waypoints;
  const waypoints2 = res2.waypoints;
  if ( waypoints1.length !== waypoints2.length ) return false;
  for ( let i = 0; i < waypoints1.length; i += 1 ) {
    const w1 = waypoints1[i];
    const w2 = waypoints2[i];
    if ( !movementResultObjectsEqual(w1, w2) ) return false;
  }
  return true;
}
