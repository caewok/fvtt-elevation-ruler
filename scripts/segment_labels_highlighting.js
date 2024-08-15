/* globals
canvas,
CONFIG,
CONST,
game,
PIXI
*/
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { Settings } from "./settings.js";
import { perpendicularPoints, roundMultiple } from "./util.js";

/**
 * Highlight a rectangular shaped portion of the line.
 * For use on gridless maps where ruler does not highlight.
 * @param {RulerMeasurementSegment} segment
 * @param {Color} color   Color to use
 * @param {string} name   Name of the ruler for tracking the highlight graphics
 */
export function highlightLineRectangle(segment, color, name) {
  const { A, B } = segment.ray;
  const width = Math.floor(canvas.scene.dimensions.size * (CONFIG[MODULE_ID].gridlessHighlightWidthMultiplier ?? 0.2));
  const ptsA = perpendicularPoints(A, B, width * 0.5);
  const ptsB = perpendicularPoints(B, A, width * 0.5);
  const shape = new PIXI.Polygon([
    ptsA[0],
    ptsA[1],
    ptsB[0],
    ptsB[1]
  ]);
  canvas.interface.grid.highlightPosition(name, { x: A.x, y: A.y, color, shape});
}

/**
 * Adjust a distance value by the multiple so it displays with limited decimal positions.
 * @param {number} dist
 * @returns {number}
 */
export function distanceLabel(dist) {
  return roundMultiple(dist);
}

/**
 * Return modified segment and total distance labels
 * @param {number} segmentDistance
 * @param {number} segmentMoveDistance
 * @param {number} totalDistance
 * @returns {object}
 */
export function _getDistanceLabels(segmentDistance, moveDistance, totalDistance) {
  if ( canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS ) return {
    newSegmentDistance: segmentDistance,
    newMoveDistance: Number(moveDistance.toFixed(2)),
    newTotalDistance: totalDistance
  };

  const newSegmentDistance = roundMultiple(segmentDistance);
  const newMoveDistance = roundMultiple(moveDistance);
  const newTotalDistance = roundMultiple(totalDistance);

  return { newSegmentDistance, newMoveDistance, newTotalDistance };
}

/**
 * Should Levels floor labels be used?
 * @returns {boolean}
 */
function useLevelsLabels() {
  if ( !MODULES_ACTIVE.LEVELS ) return false;
  const labelOpt = Settings.get(Settings.KEYS.USE_LEVELS_LABEL);
  return labelOpt === Settings.KEYS.LEVELS_LABELS.ALWAYS
    || (labelOpt === Settings.KEYS.LEVELS_LABELS.UI_ONLY && CONFIG.Levels.UI.rendered);
}

/**
 * Find the name of the level, if any, at a given elevation.
 * @param {number} e    Elevation to use.
 * @returns First elevation found that is named and has e within its range.
 */
export function levelNameAtElevation(e) {
  if ( !useLevelsLabels() ) return undefined;
  const sceneLevels = canvas.scene.getFlag("levels", "sceneLevels"); // Array with [0]: bottom; [1]: top; [2]: name
  if ( !sceneLevels ) return undefined;

  // Just get the first labeled
  const lvl = sceneLevels.find(arr => arr[2] !== "" && e >= arr[0] && e <= arr[1]);
  return lvl ? lvl[2] : undefined;
}

/*
 * Construct a label to represent elevation changes in the ruler.
 * Waypoint version: @10 ft
 * Total version: @10 ft [↑10 ft] (Bracketed is the total elevation)
 * Total version for Token Ruler: none
 * Display current elevation if there was a previous change in elevation or not a token measurement
 * and the current elevation is nonzero.
 * @param {object} s  Ruler segment
 * @return {string}
 */
export function segmentElevationLabel(ruler, s) {
  // Arrows: ↑ ↓ ↕
  // Token ruler uses the preview token for elevation.
  if ( s.last && ruler.isTokenRuler ) return "";


  // If this is the last segment, show the total elevation change if any.
  const elevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(s.ray.B.z);
  const totalE = elevation - canvas.controls.ruler.originElevation;
  const displayTotalChange = Boolean(totalE) && s.last;

  // Determine if any previous waypoint had an elevation change.
  let elevationChanged = false;
  let currE = elevation;
  for ( let i = s.waypointIdx; i > -1; i -= 1 ) {
    const prevE = ruler.waypoints[i].elevation;
    if ( currE !== prevE ) {
      elevationChanged = true;
      break;
    }
    currE = prevE;
  }

  // For basic ruler measurements, it is not obvious what the elevation is at start.
  // So display any nonzero elevation at that point.
  const displayCurrentElevation = elevationChanged || (!ruler.token && elevation);

  // Put together the two parts of the label: current elevation and total elevation.
  const labelParts = [];
  const units = canvas.scene.grid.units;
  if ( displayCurrentElevation ) labelParts.push(`@${Number(roundMultiple(elevation))} ${units}`);
  if ( displayTotalChange ) {
    const segmentArrow = (totalE > 0) ? "↑" :"↓";
    const totalChange = `[${segmentArrow}${Math.abs(Number(roundMultiple(totalE)))} ${units}]`;
    labelParts.push(totalChange);
  }
  s.label.style.align = s.last ? "center" : "right";
  return labelParts.join(" ");
}

/**
 * Construct a label to represent difficult terrain in the ruler.
 * Difficult terrain is signified by a difference in the segment distance versus its move distance.
 * @param {object} s    Ruler segment
 * @returns {string} The label or "" if none.
 */
export function segmentTerrainLabel(s) {
  if ( s.waypointDistance.almostEqual(s.waypointMoveDistance) ) return "";
  const units = (canvas.scene.grid.units) ? ` ${canvas.scene.grid.units}` : "";
  const moveDistance = distanceLabel(s.waypointMoveDistance);
  if ( CONFIG[MODULE_ID].SPEED.useFontAwesome ) {
    const style = s.label.style;
    if ( !style.fontFamily.includes("fontAwesome") ) style.fontFamily += ",fontAwesome";
    return `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${moveDistance}${units}`;
  }
  return `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${moveDistance}${units}`;
}

/**
 * Construct a label to represent prior movement in combat.
 * @param {object} s    Ruler segment
 * @returns {string} The label or "" if none.
 */
export function segmentCombatLabel(token, priorDistance) {
  const units = (canvas.scene.grid.units) ? ` ${canvas.scene.grid.units}` : "";
  if ( priorDistance ) return `\nPrior: ${priorDistance}${units}`;
  return "";
}

export function getPriorDistance(token) {
  if ( game.combat?.started && Settings.get(Settings.KEYS.SPEED_HIGHLIGHTING.COMBAT_HISTORY) ) {
    return distanceLabel(token?.lastMoveDistance) || 0;
  }
  return 0;
}
