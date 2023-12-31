/* globals
game,
canvas,
PIXI,
CONFIG
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";

/**
 * Calculate the elevation for a given waypoint.
 * Terrain elevation + user increment
 * @param {object} waypoint
 * @returns {number}
 */
export function elevationAtWaypoint(waypoint) {
  return waypoint._terrainElevation + (waypoint._userElevationIncrements * canvas.dimensions.distance);
}

/**
 * Wrap Ruler.prototype._getMeasurementSegments
 * Add elevation information to the segments
 */
export function _getMeasurementSegments(wrapped) {
  const segments = wrapped();

  // Add destination as the final waypoint
  this.destination._terrainElevation = this.terrainElevationAtDestination();
  this.destination._userElevationIncrements = this._userElevationIncrements;

  return elevateSegments(this, segments);
}

/**
 * Wrap Ruler.prototype._getSegmentLabel
 * Add elevation information to the label
 */
export function _getSegmentLabel(wrapped, segment, totalDistance) {
  const orig_label = wrapped(segment, totalDistance);
  let elevation_label = segmentElevationLabel(segment);
  const level_name = levelNameAtElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z));
  if ( level_name ) elevation_label += `\n${level_name}`;
  return `${orig_label}\n${elevation_label}`;
}

/**
 * Wrap Ruler.prototype._animateSegment
 * When moving the token along the segments, update the token elevation to the destination + increment
 * for the given segment.
 */
export async function _animateSegment(wrapped, token, segment, destination) {
  const res = await wrapped(token, segment, destination);

  // Update elevation after the token move.
  if ( segment.ray.A.z !== segment.ray.B.z ) {
    await token.document.update({ elevation: CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z) });
  }

  return res;
}

/**
 * Take 2d segments and make 3d.
 * @param {Ruler} ruler
 * @param {object[]} segments
 */
function elevateSegments(ruler, segments) {  // Add destination as the final waypoint
  const waypoints = ruler.waypoints.concat([ruler.destination]);
  const { distance, size } = canvas.dimensions;
  const gridUnits = size / distance;

  const ln = waypoints.length;
  // Skip the first waypoint, which will (likely) end up as p0.
  for ( let i = 1, j = 0; i < ln; i += 1, j += 1 ) {
    const segment = segments[j];

    const p0 = waypoints[i - 1];
    const p1 = waypoints[i];
    const dist2 = PIXI.Point.distanceSquaredBetween(p0, p1);
    if ( dist2 < 100 ) { // 10 ^ 2, from _getMeasurementSegments
      j -= 1; // Stay on this segment and skip this waypoint
      continue;
    }

    // Convert to 3d Rays
    const Az = elevationAtWaypoint(p0) * gridUnits;
    const Bz = elevationAtWaypoint(p1) * gridUnits;
    segment.ray = Ray3d.from2d(segment.ray, { Az, Bz });
  }

  return segments;
}


/**
 * Should Levels floor labels be used?
 * @returns {boolean}
 */
function useLevelsLabels() {
  if ( !game.modules.get("levels")?.active ) return false;

  const labelOpt = Settings.get(MODULE_ID, Settings.KEYS.USE_LEVELS_LABEL);
  return labelOpt === Settings.KEYS.LEVELS_LABELS.ALWAYS
    || (labelOpt === Settings.KEYS.LEVELS_LABELS.UI_ONLY && CONFIG.Levels.UI.rendered);
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
  const units = canvas.scene.grid.units;
  const increment = s.ray.dz;
  const Bz = s.ray.B.z;

  const segmentArrow = (increment > 0) ? "↑"
    : (increment < 0) ? "↓" : "↕";

  // Take absolute value b/c segmentArrow will represent direction
  // Allow decimals to tenths ( Math.round(x * 10) / 10).
  let label = `${segmentArrow}${Math.abs(Math.round(CONFIG.GeometryLib.utils.pixelsToGridUnits(increment) * 10) / 10)} ${units}`;
  label += ` [@${Math.round(CONFIG.GeometryLib.utils.pixelsToGridUnits(Bz) * 10) / 10} ${units}]`;

  return label;
}
