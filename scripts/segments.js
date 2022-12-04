/* globals
game,
canvas,
Ray
*/
"use strict";

import { MODULE_ID } from "./const.js";
import {
  log,
  distance2dSquared,
  elevationCoordinateToUnit } from "./util.js";

import { Ray3d } from "./geometry/3d/Ray3d.js";

/**
 * Wrap Ruler.prototype._getMeasurementSegments
 * Add elevation information to the segments
 */
export function _getMeasurementSegmentsRuler(wrapped) {
  const segments = wrapped();

  // Add destination as the final waypoint
  this.destination._terrainElevation = this.terrainElevationAtDestination();
  this.destination._userElevationIncrements = this._userElevationIncrements;

  return elevateSegments(this, segments);
}

/**
 * Wrap DragRulerRuler.prototype._getMeasurementSegments
 * Add elevation information to the segments
 */
export function _getMeasurementSegmentsDragRulerRuler(wrapped) {
  const segments = wrapped();

  if ( !this.isDragRuler ) return segments; // Drag Ruler calls super in this situation

  // Add destination as the final waypoint
  this.destination._terrainElevation = this.terrainElevationAtDestination();
  this.destination._userElevationIncrements = this._userElevationIncrements;

  return elevateSegments(this, segments);
}

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
    const dist2 = distance2dSquared(p0, p1);
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
  if ( !segments.length || !(segments[0]?.ray instanceof Ray3d) ) return wrapped(segments, options);

  // Avoid modifying the segment rays.
  const ln = segments.length;
  const origRays = Array(ln);
  for ( let i = 0; i < ln; i += 1 ) {
    const s = segments[i];
    origRays[i] = s.ray;
    s.ray = s.ray.projectOntoCanvas();
  }

  const out = wrapped(segments, options);

  for ( let i = 0; i < ln; i += 1 ) segments[i].ray = origRays[i];
  return out;
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
  const level_name = levelNameAtElevation(elevationCoordinateToUnit(segment.ray.B.z));
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
  const units = canvas.scene.grid.units;
  const increment = s.ray.dz;
  const Bz = s.ray.B.z;

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
  log(`Updating token elevation for segment with destination ${destination.x},${destination.y},${destination.z} from elevation ${segment.ray.A.z} --> ${segment.ray.B.z}`, token, segment);
  const res = await wrapped(token, segment, destination);

  // Update elevation after the token move.
  if ( segment.ray.A.z !== segment.ray.B.z ) {
    await token.document.update({ elevation: elevationCoordinateToUnit(segment.ray.B.z) });
  }

  return res;
}

/**
 * Wrap Token.prototype._onDragLeftDrop
 * If Drag Ruler is active, use this to update token(s) after movement has completed.
 * Callback actions which occur on a mouse-move operation.
 * @see MouseInteractionManager#_handleDragDrop
 * @param {PIXI.InteractionEvent} event  The triggering canvas interaction event
 * @returns {Promise<*>}
 */
export async function _onDragLeftDropToken(wrapped, event) {
  // Assume the destination elevation is the desired elevation if dragging multiple tokens.
  // (Likely more useful than having a bunch of tokens move down 10'?)
  const ruler = canvas.controls.ruler;
  if ( !ruler.isDragRuler ) return wrapped(event);

  log("ending token drag");

  // Do before calling wrapper b/c ruler may get cleared.
  const elevation = elevationAtWaypoint(ruler.destination);
  const selectedTokens = [...canvas.tokens.controlled];
  if ( !selectedTokens.length ) selectedTokens.push(ruler.draggedEntity);

  const result = wrapped(event);
  if ( result === false ) return false; // Drag did not happen

  const updates = selectedTokens.map(t => {
    return { _id: t.id, elevation };
  });

  const t0 = selectedTokens[0];
  await t0.scene.updateEmbeddedDocuments(t0.constructor.embeddedName, updates);
  return true;
}
