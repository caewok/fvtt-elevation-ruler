/* globals
game,
canvas,
Ray
*/
"use strict";

import { MODULE_ID, log } from "./module.js";
import {
  projectElevatedPoint,
  distance2dSquared,
  elevationCoordinateToUnit } from "./utility.js";

/**
 * Wrap Ruler.prototype._getMeasurementSegments
 * Add elevation information to the segments
 */
export function _getMeasurementSegmentsRuler(wrapped) {
  const segments = wrapped();

  // Add destination as the final waypoint
  this.destination._terrainElevation = this.terrainElevationAtDestination();
  this.destination._userElevationIncrements = this._userElevationIncrements;

  const waypoints = this.waypoints.concat([this.destination]);

  const { distance, size } = canvas.dimensions;
  const gridUnits = size / distance;

  const ln = waypoints.length;
  // Skip the first waypoint, which will (likely) end up as p0.
  for ( let i = 1, j = 0; i < ln; i += 1, j += 1 ) {
    const segment = segments[j];

    const p0 = waypoints[i - 1];
    const p1 = waypoints[i];
    const dist2 = distance2dSquared(p0, p1);
    if ( dist2 < 100 ) { // 10 ^ 2, from _getMeasurementSegments
      j -= 1; // Stay on this segment and skip this waypoint
      continue;
    }

    // Could add z coordinate to the ray but other modules could mess with the Ray info.
    segment._elevation = { A: 0, B: 0 };

    segment._elevation.A = elevationAtWaypoint(p0);
    segment._elevation.B = elevationAtWaypoint(p1);

    segment._elevation.A *= gridUnits;
    segment._elevation.B *= gridUnits;
  }

  return segments;
}

/**
 * Calculate the elevation for a given waypoint.
 * Terrain elevation + user increment
 * @param {object} waypoint
 * @returns {number}
 */
function elevationAtWaypoint(waypoint) {
  return waypoint._terrainElevation + (waypoint._userElevationIncrements * canvas.dimensions.distance);
}
/**
 * Wrap GridLayer.prototype.measureDistances
 * Called by Ruler.prototype._computeDistance
 * If a segment ray has a z-dimension, re-do the segment by projecting the hypotenuse
 * between the ray A and B endpoints in 3d onto the 2d canvas. Use the projected
 * hypotenuse to do the measurement.
 */
export function measureDistancesGridLayer(wrapped, segments, options = {}) {
  const newSegments = [];
  for ( const s of segments ) {
    if ( !s._elevation?.A && !s._elevation?.B ) {
      newSegments.push(s);
      continue;
    }

    // Shallow-copy the segments so as not to affect the original segment.ray
    const newSegment = {...s};

    // Project the 3d path onto the 2d canvas
    const A = { x: s.ray.A.x, y: s.ray.A.y, z: s._elevation.A };
    const B = { x: s.ray.B.x, y: s.ray.B.y, z: s._elevation.B };
    const [newA, newB] = projectElevatedPoint(A, B);
    newSegment.ray = new Ray(newA, newB);
    newSegments.push(newSegment);
  }

  return wrapped(newSegments, options);
}

/**
 * Should Levels floor labels be used?
 * @returns {boolean}
 */
function useLevelsLabels() {
  return game.modules.get("levels")?.active
    && game.settings.get(MODULE_ID, "enable-levels-floor-label");
}

/**
 * Wrap Ruler.prototype._getSegmentLabel
 * Add elevation information to the label
 */
export function _getSegmentLabelRuler(wrapped, segment, totalDistance) {
  const orig_label = wrapped(segment, totalDistance);

  let elevation_label = segmentElevationLabel(segment);
  const level_name = levelNameAtElevation(elevationCoordinateToUnit(segment._elevation.B));
  if ( level_name ) elevation_label += `\n${level_name}`;

  return `${orig_label}\n${elevation_label}`;
}

/**
 * Find the name of the level, if any, at a given elevation.
 * @param {number} e    Elevation to use.
 * @returns First elevation found that is named and has e within its range.
 */
function levelNameAtElevation(e) {
  if ( !useLevelsLabels() ) return undefined;
  const sceneLevels = canvas.scene.getFlag("levels", "sceneLevels"); // Array with [0]: bottom; [1]: top; [2]: name
  if ( !sceneLevels ) return undefined;

  // Just get the first labeled
  const lvl = sceneLevels.find(arr => arr[2] !== "" && e >= arr[0] && e <= arr[1]);
  return lvl ? lvl[2] : undefined;
}


/*
 * Construct a label to represent elevation changes in the ruler.
 * Waypoint version: 10 ft↑ [@10 ft]
 * Total version: 10 ft↑ [@20 ft]
 * @param {object} s  Ruler segment
 * @return {string}
 */
function segmentElevationLabel(s) {
  const Az = s._elevation.A;
  const Bz = s._elevation.B;
  const units = canvas.scene.grid.units;
  const increment = Bz - Az;

  const segmentArrow = (increment > 0) ? "↑"
    : (increment < 0) ? "↓" : "";

  // Take absolute value b/c segmentArrow will represent direction
  // Allow decimals to tenths ( Math.round(x * 10) / 10).
  let label = `${Math.abs(Math.round(elevationCoordinateToUnit(increment) * 10) / 10)} ${units}${segmentArrow}`;
  label += ` [@${Math.round(elevationCoordinateToUnit(Bz) * 10) / 10} ${units}]`;

  return label;
}

/**
 * Wrap Ruler.prototype._animateSegment
 * When moving the token along the segments, update the token elevation to the destination + increment
 * for the given segment.
 */
export async function _animateSegmentRuler(wrapped, token, segment, destination) {
  log(`Updating token elevation for segment with destination ${destination.x},${destination.y},${destination.z} from elevation ${segment._elevation.A} --> ${segment._elevation.B}`, token, segment);
  destination.elevation = elevationCoordinateToUnit(segment._elevation.A); // Just in case
  const res = await wrapped(token, segment, destination);

  // Update elevation after the token move.
  if ( segment._elevation.A !== segment._elevation.B ) {
    await token.document.update({ elevation: elevationCoordinateToUnit(segment._elevation.B) });
  }

  return res;
}
