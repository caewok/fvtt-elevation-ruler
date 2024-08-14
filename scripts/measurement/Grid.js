/* globals
isHexRow,
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
    const { origin2d, dest2d } = project3dLineGridless(start, end);
    const result2d = constructGridMeasurePathResult([origin2d, dest2d]);
    wrapped([origin2d, dest2d], {}, result2d); // canvas.grid._measurePath([origin2d, dest2d], {}, result2d)

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
    const costForSegment = cost ? cost(start.matchOffset(), end.matchOffset(), segment2d.distance) : segment2d.distance;
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


}



// ----- NOTE: HexGrid ----- //

/**
 * Wrap HexagonalGrid.prototype._measurePath
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */





// ----- NOTE: Patches ----- //

PATCHES_GridlessGrid.BASIC.WRAPS = { _measurePath: _measurePathGridless };
// PATCHES_SquareGrid.BASIC.WRAPS = { _measurePath: _measurePathSquareGrid };
// PATCHES_HexagonalGrid.BASIC.WRAPS = { _measurePath: _measurePathHexagonalGrid };

// ----- NOTE: Helper functions ----- //

/**
 * Define certain parameters required in the result object.
 */
function initializeResultObject(obj, diagonal = false) {
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
 *   - @prop {PIXI.Point} dest2d
 */
function project3dLineGridless(origin, destination) {
  const dist2d = PIXI.Point.distanceBetween(origin, destination);
  const zElev = destination.z - origin.z;
  return {
    origin2d: origin.to2d(),
    dest2d: new PIXI.Point(origin.x + dist2d, origin.y + zElev)
  };
}

/*
 * Project a 3d segment to 2d for a gridded scene.
 * Projected in a specific manner such that a straight line move represents elevation-only travel.
 * For hex rows, this is a horizontal move. For hex columns or squares, this is a vertical move.
 * @param {Point3d} origin       Origination point
 * @param {Point3d} destination  Destination point
 * @returns {object} Starting and ending points for the
 */
function project3dLineGridded(origin, destination) {
  // Determine the number of elevation steps.
  const cOrigin = origin.center;
  const cDest = destination.center;
  const zElev = cDest.z - cOrigin.z;

  // Projected distance.
  const dist2d = PIXI.Point.distanceBetween(cOrigin, cDest);
  const b = isHexRow()
    ? new PIXI.Point(cOrigin.x + zElev, cOrigin.y + dist2d)
    : new PIXI.Point(cOrigin.x + dist2d, cOrigin.y + zElev);
  return { origin2d: cOrigin, dest2d: b };
}