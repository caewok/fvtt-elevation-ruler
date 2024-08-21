/* globals
canvas,
CONFIG
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { log } from "./util.js";
import { Pathfinder, hasCollision } from "./pathfinding/pathfinding.js";
import { MovePenalty } from "./measurement/MovePenalty.js";
import { GridCoordinates3d } from "./measurement/grid_coordinates_new.js";

/**
 * Measure a given segment, updating its distance labels accordingly.
 * Segment modified in place.
 * @param {RulerSegment} segment          Segment to measure
 * @param {Token} [token]                 Token to use for the measurement
 * @param {number} [numPrevDiagonal=0]    Number of previous diagonals for the segment
 * @returns {number} numPrevDiagonal
 */
export function measureSegment(segment, numPrevDiagonal = 0) {
  const res = GridCoordinates3d.gridMeasurementForSegment(segment.ray.A, segment.ray.B, numPrevDiagonal);
  segment.distance = res.distance;
  segment.offsetDistance = res.offsetDistance;
  segment.cost = res.cost;
  segment.numDiagonal = res.numDiagonal;
  return numPrevDiagonal + segment.numDiagonal;
}

/**
 * Calculate a path to get from points A to B on the segment.
 * @param {RulerMeasurementSegment} segment
 * @returns {PIXI.Point[]}
 */
export function calculatePathPointsForSegment(segment, token) {
  const A = Point3d.fromObject(segment.ray.A);
  const B = Point3d.fromObject(segment.ray.B);

  // If no collision present, no pathfinding required.
  const tC = performance.now();
  if ( !hasCollision(A, B, token)
    && !(CONFIG[MODULE_ID].pathfindingCheckTerrains && MovePenalty.anyTerrainPlaceablesAlongSegment(A, B, token)) ) {
    const tEnd = performance.now();
    log(`Determined no collision for ${Pathfinder.triangleEdges.size} edges in ${tEnd - tC} ms.`);
    return [];
  }

  const tEnd = performance.now();
  log(`Found collision for ${Pathfinder.triangleEdges.size} edges in ${tEnd - tC} ms.`);

  // Find path between last waypoint and destination.
  const t0 = performance.now();
  token[MODULE_ID] ??= {};
  const pf = token[MODULE_ID].pathfinder ??= new Pathfinder(token);
  const path = pf.runPath(A, B);
  let pathPoints = Pathfinder.getPathPoints(path);
  const t1 = performance.now();
  log(`Found ${pathPoints.length} path points between ${A.x},${A.y} -> ${B.x},${B.y} in ${t1 - t0} ms.`, pathPoints);

  // Clean the path
  const t2 = performance.now();
  pathPoints = pf.cleanPath(pathPoints);
  const t3 = performance.now();
  log(`Cleaned to ${pathPoints?.length} path points between ${A.x},${A.y} -> ${B.x},${B.y} in ${t3 - t2} ms.`, pathPoints);

  // Snap to grid
  if ( !canvas.grid.isGridless && Settings.get(Settings.KEYS.PATHFINDING.SNAP_TO_GRID) ) {
    const t4 = performance.now();
    pathPoints = pf.alignPathToGrid(pathPoints);
    const t5 = performance.now();
    log(`Snapped to grid to ${pathPoints?.length} path points between ${A.x},${A.y} -> ${B.x},${B.y} in ${t5 - t4} ms.`, pathPoints);
  }

  // If less than 3 points after cleaning, just use the original segment.
  if ( pathPoints.length < 2 ) {
    log(`Only ${pathPoints.length} path points found.`, [...pathPoints]);
    return [];
  }

  return pathPoints;
}


/**
 * Check provided array of segments against stored path points.
 * For each segment with pathfinding points, replace the segment with sub-segments
 * between each pathfinding point.
 * @param {RulerMeasurementSegment[]} segments
 * @returns {RulerMeasurementSegment[]} Updated segment array
 */
export function constructPathfindingSegments(segments, segmentMap) {
  // For each segment, check the map for pathfinding points.
  // If any, replace segment with the points.
  // Make sure to keep the label for the last segment piece only
  if ( !segmentMap.size ) return segments;
  const newSegments = [];
  for ( const segment of segments ) {
    const key = `${segment.ray.A.key}|${segment.ray.B.key}`;
    const pathPoints = segmentMap.get(key);
    if ( !pathPoints ) {
      newSegments.push(segment);
      continue;
    }
    const A = Point3d.fromObject(segment.ray.A);
    const B = Point3d.fromObject(segment.ray.B);
    const nPoints = pathPoints.length;
    let prevPt = pathPoints[0];
    prevPt.z ??= A.z;
    for ( let i = 1; i < nPoints; i += 1 ) {
      const currPt = pathPoints[i];
      currPt.z ??= A.z;
      const newSegment = { ray: new Ray3d(prevPt, currPt), waypoint: {} };
      newSegment.ray.pathfinding = true; // TODO: Was used by  canvas.grid.grid._getRulerDestination.
      newSegment.waypoint.idx = segment.waypoint.idx;
      newSegments.push(newSegment);
      prevPt = currPt;
    }

    const lastPathSegment = newSegments.at(-1);
    if ( lastPathSegment ) {
      lastPathSegment.ray.B.z = B.z;
      lastPathSegment.label = segment.label;
      lastPathSegment.ray.pathfinding = false;
    }
  }
  return newSegments;
}

/**
 * Take 2d segments and make 3d.
 * @param {Ruler} ruler
 * @param {object[]} segments
 */
export function elevateSegments(ruler, segments) {  // Add destination as the final waypoint
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;

  // Index the default measurement segments to waypoints, keeping in mind that some segments could refer to history.
  // waypointIdx refers to the segment.ray.A value.
  const nHistory = ruler.history.length;
  for ( let i = 0, n = segments.length; i < n; i += 1 ) {
    const segment = segments[i];
    // segment.first = i === 0;
    segment.waypoint = { idx: Math.max(i - nHistory, -1) };
  }

  // Add destination as the final waypoint
  const destWaypoint = {
    x: ruler.destination.x,
    y: ruler.destination.y,
    _userElevationIncrements: 0,
    _forceToGround: Settings.FORCE_TO_GROUND,
    elevation: ruler.destinationElevation
  }
  const waypoints = [...ruler.waypoints, destWaypoint];

  // Add the waypoint elevations to the corresponding segment endpoints.
  for ( const segment of segments ) {
    if ( !~segment.waypoint.idx ) continue;
    const startWaypoint = waypoints[segment.waypoint.idx];
    const endWaypoint = waypoints[segment.waypoint.idx + 1];
    if ( !startWaypoint || !endWaypoint ) continue; // Should not happen.

    // Convert to 3d Rays
    const Az = gridUnitsToPixels(startWaypoint.elevation);
    const Bz = gridUnitsToPixels(endWaypoint.elevation);
    segment.ray = Ray3d.from2d(segment.ray, { Az, Bz });
  }
}


