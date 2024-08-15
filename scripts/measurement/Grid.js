/* globals
canvas,
CONST,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GridCoordinates, GridCoordinates3d } from "./grid_coordinates_new.js";
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
  let start = GridCoordinates3d.fromObject(waypoints[0]);
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = GridCoordinates3d.fromObject(waypoints[i]);
    const { origin2d, destination2d } = project3dLineGridless(start, end);
    const result2d = constructGridMeasurePathResult([origin2d, destination2d]);

    // Determine distance for projected 2d segment.
    wrapped([origin2d, destination2d], {}, result2d); // canvas.grid._measurePath([origin2d, destination2d], {}, result2d)

    // Add the distance results of the projected segment to overall results.
    result.distance += result2d.distance;

    // Mark distance for segment (not cumulative) and waypoint (cumulative)
    const segment2d = result2d.segments[0];
    const resultSegment = result.segments[i - 1];
    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultSegment.distance = segment2d.distance;
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment2d.distance;

    // Number of spaces for gridless is 0, so can ignore.
    // result.spaces += segment2d.spaces;

    // Apply the cost function to each 3d point.
    // For gridless, can simply give the cost function the 3d waypoint offsets. (Technically should be same as the waypoints.)
    const costForSegment = cost ? cost(start, end, segment2d.distance) : segment2d.distance;
    result.cost += costForSegment;
    resultSegment.cost = costForSegment;
    resultEndWaypoint.cost = resultStartWaypoint.cost + costForSegment;

    // Iterate to next segment.
    start = end;
  }
  return result;
}

// ----- NOTE: SquareGrid ----- //

/**
 * Wrap SquareGrid.prototype._measurePath
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */
function _measurePathSquareGrid(wrapped, waypoints, {cost}, result) {
  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Difficult b/c we need to re-construct the 3d grid movement for each segment.
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  initializeResultObjectSquareGrid(result);
  result.waypoints.forEach(waypoint => initializeResultObjectSquareGrid(waypoint));
  result.segments.forEach(segment => initializeResultObjectSquareGrid(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let start = GridCoordinates3d.fromObject(waypoints[0]);
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = GridCoordinates3d.fromObject(waypoints[i]);
    const { origin2d, destination2d } = project3dLineSquareGrid(start, end);
    destination2d.centerToOffset();
    const result2d = constructGridMeasurePathResult([origin2d, destination2d]);

    // Determine the distance for the projected 2d segment.
    wrapped([origin2d, destination2d], {}, result2d); // canvas.grid._measurePath([origin2d, destination2d], {}, result2d)

    // Add the distance results of the projected segment to overall results.
    result.distance += result2d.distance;

    // Mark distance for segment (not cumulative) and waypoint (cumulative)
    const segment2d = result2d.segments[0];
    const resultSegment = result.segments[i - 1];
    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultSegment.distance = segment2d.distance;
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment2d.distance;



    // Apply the cost function to each 3d point.
    // For gridless, can simply give the cost function the 3d waypoint offsets. (Technically should be same as the waypoints.)
    // Trick: Need the grid steps, in 3d, to pass to the cost function.
    // Get these by using the direct path.
    const pts3d = gridUnder3dLine(start, end);
    let costForSegment = 0;
    if ( cost ) pts3d.reduce((acc, curr) => {
      costForSegment += cost(acc, curr) // TODO: Need to pass the distance either from the original wrapped or recalculated.
      acc = curr;
    });
    else cost = 0; // TODO: Need to pass the cost either from the original wrapped or recalculated.
    result.cost += costForSegment;
    resultSegment.cost = costForSegment;
    resultEndWaypoint.cost = resultStartWaypoint.cost + costForSegment;

    // Add in spaces.
    const nSpaces = pts3d.length - 1;
    result.spaces += nSpaces;
    resultSegment.spaces = nSpaces;
    resultEndWaypoint.spaces = resultStartWaypoint.spaces + nSpaces;

    // Iterate to next segment.
    start = end;
  }
  return result;
}



// ----- NOTE: HexagonalGrid ----- //

/**
 * Wrap HexagonalGrid.prototype._measurePath
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */

function _measurePathHexagonalGrid(wrapped, waypoints, {cost}, result) {
  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Difficult b/c we need to re-construct the 3d grid movement for each segment.
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints, {cost}, result);
  initializeResultObject(result);
  result.waypoints.forEach(waypoint => initializeResultObject(waypoint));
  result.segments.forEach(segment => initializeResultObject(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let start = GridCoordinates3d.fromObject(waypoints[0]);
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = GridCoordinates3d.fromObject(waypoints[i]);
    const { origin2d, destination2d } = project3dLineSquareGrid(start, end);
    destination2d.centerToOffset(); // Necessary for hex grids so the distance is correct.
    const result2d = constructGridMeasurePathResult([origin2d, destination2d]);

    // Determine the distance for the projected 2d segment.
    wrapped([origin2d, destination2d], {}, result2d); // canvas.grid._measurePath([origin2d, destination2d], {}, result2d)

    // Add the distance results of the projected segment to overall results.
    result.distance += result2d.distance;

    // Mark distance for segment (not cumulative) and waypoint (cumulative)
    const segment2d = result2d.segments[0];
    const resultSegment = result.segments[i - 1];
    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultSegment.distance = segment2d.distance;
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment2d.distance;

    // Apply the cost function to each 3d point.
    // For gridless, can simply give the cost function the 3d waypoint offsets. (Technically should be same as the waypoints.)
    // Trick: Need the grid steps, in 3d, to pass to the cost function.
    // Get these by using the direct path.
    const pts3d = gridUnder3dLine(start, end);
    let costForSegment = 0;
    if ( cost ) pts3d.reduce((acc, curr) => {
      costForSegment += cost(acc, curr) // TODO: Need to pass the distance either from the original wrapped or recalculated.
      acc = curr;
    });
    else cost = 0; // TODO: Need to pass the cost either from the original wrapped or recalculated.
    result.cost += costForSegment;
    resultSegment.cost = costForSegment;
    resultEndWaypoint.cost = resultStartWaypoint.cost + costForSegment;

    // Add in spaces.
    const nSpaces = pts3d.length - 1;
    result.spaces += nSpaces;
    resultSegment.spaces = nSpaces;
    resultEndWaypoint.spaces = resultStartWaypoint.spaces + nSpaces;

    // Iterate to next segment.
    start = end;
  }
  return result;
}



// ----- NOTE: Patches ----- //

PATCHES_GridlessGrid.BASIC.WRAPS = { _measurePath: _measurePathGridless };
PATCHES_SquareGrid.BASIC.WRAPS = { _measurePath: _measurePathSquareGrid };
PATCHES_HexagonalGrid.BASIC.WRAPS = { _measurePath: _measurePathHexagonalGrid };

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
  const cOrigin = origin.center;
  const cDest = destination.center;
  const zElev = cDest.z - cOrigin.z;

  // Projected distance.
  const dist2d = PIXI.Point.distanceBetween(cOrigin, cDest);
  const b = isHexRow()
    ? new GridCoordinates(cOrigin.x + zElev, cOrigin.y + dist2d)
    : new GridCoordinates(cOrigin.x + dist2d, cOrigin.y + zElev);
  return { origin2d: cOrigin, destination2d: b };
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
  const cOrigin = origin.center;
  const cDest = destination.center;
  const zElev = cDest.z - cOrigin.z;

  // Projected distance.
  const dist2d = PIXI.Point.distanceBetween(cOrigin, cDest);
  const b = new GridCoordinates(cOrigin.x + dist2d, cOrigin.y + zElev);
  return { origin2d: cOrigin, destination2d: b };
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
  const pts2d = canvas.grid.getDirectPath([origin, destination]).map(pt => GridCoordinates.fromOffset(pt));
  const { origin2d, destination2d } = project3dLine(origin, destination);
  const projPts2d = canvas.grid.getDirectPath([origin2d, destination2d]).map(pt => GridCoordinates.fromOffset(pt));

  // Link the pts to the projected point movement.
  // If vertical projection, increment elevation only.
  // If diagonal or horizontal, increment both elevation and grid step.
  // Flip horizontal/vertical for hex rows.
  const diagAllowed = canvas.grid.diagonals !== CONST.GRID_DIAGONALS.ILLEGAL;
  const [elevOnlyMove, canvasOnlyMove] = isHexRow() ? ["H", "V"] : ["V", "H"];

  let prevPt = pts2d[0];
  let stepIdx = 1;

  // Start by adding the origin point at the origin elevation.
  prevPt.k = origin.k;
  const resPts = [prevPt];

  const elevationOnlyStep = () => {
    prevPt = prevPt.clone();
    prevPt.k += elevSign;
    resPts.push(prevPt);
  };

  const canvasStep = (elevStep = 0) => {
    const currPt2d = pts2d[stepIdx];
    stepIdx += 1;
    if ( !currPt2d ) {
      if ( elevStep ) elevationOnlyStep();
      return false;
    }
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

  // Cycle through each elevation change. If moving both elevation and 2d, or just 2d,
  // increment to the next 2d point. Otherwise add an interval point with the elevation-only change.
  let prevProjPt = projPts2d[0];
  for ( let i = 1, n = projPts2d.length; i < n; i += 1 ) {
    const nextProjPt = projPts2d[i];
    const elevChangeType = gridChangeType2d(prevProjPt, nextProjPt);
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
export function testGridUnder3dLine() {
  const start = { i: 20, j: 30 };

  // Move vertical 4 spaces.

  // Move horizontal 4 spaces.

  // Move diagonal 4 spaces.

  // Move up 4 spaces.

  // Move vertical 4, up 1.

  // Move horizontal 4, down 1.

  // Move diagonal 5, up 2.

  // Move diagonal 5, up 3.

}

