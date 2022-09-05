/* globals
canvas,
game,
_levels
*/
"use strict";

/* Measure terrain elevation at a point.
Used by ruler to get elevation at waypoints and at the end of the ruler.
*/

import { log, MODULE_ID } from "./module.js";

/**
 * Retrieve the elevation at the current ruler origin.
 * This is either token elevation or terrain elevation or 0.
 */
export function elevationAtOrigin() {
  const measuringToken = this._getMovementToken();
  const origin = this.waypoints[0];
  return measuringToken
    ? tokenElevation(measuringToken)
    : this.terrainElevationAtPoint(origin, { considerTokens: false });
}

/**
 * Retrieve the token elevation, using:
 * 1. Wall Height / Levels
 * 2. Foundry default
 * @param {Token} token
 * @returns {number}
 */
function tokenElevation(token) {
  return token.document?.elevation ?? 0;
}

/**
 * Retrieve the terrain elevation at the current ruler destination
 */
export function terrainElevationAtDestination({
  startingElevation = 0,
  considerTokens = true,
  ignoreBelow = Number.NEGATIVE_INFINITY } = {}) {
  return this.terrainElevationAtPoint(this.destination, { startingElevation, considerTokens, ignoreBelow });
}

/**
 * Measure elevation at a given point.
 * Prioritize:
 *   1. Token found at point.
 *   2. Elevated Vision, if any
 *   3. Levels, if any
 *   4. Terrain Layer, if any
 *
 * @param {Point} p      Point to measure, in {x, y} format
 * @param {object} [options]  Options that modify the calculation
 * @param {number} [options.startingElevation]  The elevation of the ruler or measuring token, used for Levels
 * @param {boolean} [options.considerTokens]    Consider token elevations at that point.
 * @param {number} [options.ignoreBelow]        If elevation of a given source is below this number, ignore
 * @returns {number} Elevation for the given point.
 */
export function terrainElevationAtPoint({x, y}, {
  startingElevation = 0,
  considerTokens = true,
  ignoreBelow = Number.NEGATIVE_INFINITY } = {}) {
  log(`Checking Elevation at (${x}, ${y}) ${(considerTokens ? "" : "not ") + "considering tokens"}; ignoring below ${ignoreBelow}`);

  if ( considerTokens ) {  // Check for tokens; take the highest one at a given position
    const tokens = retrieveVisibleTokens();
    const max_token_elevation = tokens.reduce((e, t) => {
      // Is the point within the token control area?
      if ( !t.hitArea.contains(x, y) ) return e;
      return Math.max(t.data.elevation, e);
    }, Number.NEGATIVE_INFINITY);
    log(`calculateEndElevation: ${tokens.length} tokens at (${x}, ${y}) with maximum elevation ${max_token_elevation}`);

    // Use tokens rather than elevation if available
    if ( isFinite(max_token_elevation) && max_token_elevation >= ignoreBelow ) return max_token_elevation;
  }

  const ev_elevation = EVElevationAtPoint({x, y});
  if ( levels_elevation !== undefined && levels_elevation > ignoreBelow ) return ev_elevation;

  // Try levels
  const levels_elevation = LevelsElevationAtPoint({x, y}, startingElevation);
  if ( levels_elevation !== undefined && levels_elevation > ignoreBelow ) return levels_elevation;

  // Try terrain
  const terrain_elevation = TerrainLayerElevationAtPoint({x, y});
  if ( terrain_elevation !== undefined && terrain_elevation > ignoreBelow ) return terrain_elevation;

  // Default to 0 elevation for the point
  return Math.max(ignoreBelow, 0);
}

function retrieveVisibleTokens() {
  return canvas.tokens.children[0].children.filter(c => c.visible);
}

// ----- ELEVATED VISION ELEVATION ----- //
/**
 * Measure the terrain elevation at a given point using Elevated Vision.
 * @param {Point} {x,y}    Point to measure, in {x, y} format
 * @returns {Number|undefined} Point elevation or undefined if elevated vision layer is inactive
 */
function EVElevationAtPoint({x, y}) {
  if ( !game.modules.get("elevatedvision")?.active ) return undefined;
  return canvas.elevation.elevationAt(x, y);
}


// ----- TERRAIN LAYER ELEVATION ----- //
/**
 * Measure the terrain elevation at a given point.
 * Elevation should be the maximum terrain elevation.
 * @param {Point} {x, y}    Point to measure, in {x, y} format.
 * @return {Number|undefined} Point elevation or undefined if terrain layer is inactive or no terrain found.
 */
function TerrainLayerElevationAtPoint({x, y}) {
  if ( !game.settings.get(MODULE_ID, "enable-terrain-elevation")
    || !game.modules.get("enhanced-terrain-layer")?.active ) return undefined;

  const terrains = canvas.terrain.terrainFromPixels(x, y);
  if ( terrains.length === 0 ) return undefined; // No terrains found at the point.

  // Get the maximum non-infinite elevation point using terrain max
  // must account for possibility of
  // TO-DO: Allow user to ignore certain terrain types?
  let terrain_max_elevation = terrains.reduce((total, t) => {
    if ( !isFinite(t.max) ) return total;
    return Math.max(total, t.max);
  }, Number.NEGATIVE_INFINITY);

  // In case all the terrain maximums are infinite.
  terrain_max_elevation = isFinite(terrain_max_elevation) ? terrain_max_elevation : 0;

  log(`TerrainElevationAtPoint: Returning elevation ${terrain_max_elevation} for point ${x},${y}`, terrains);

  return terrain_max_elevation;
}

// ----- LEVELS ELEVATION ----- //
// use cases:
// generally:
// - if over a level-enabled object, use the bottom of that level.
// - if multiple, use the bottom
// - if hole, use the bottom
// starting point of the ruler is a token:
// - if the same level is present, stay at that level
//   (elevation should be found from the token, so no issue)
// - if a hole, go to bottom of the hole
// - display level as labeled in the levels object flag?

/*
 * Measure the elevation of any levels tiles at the point.
 * If the point is within a hole, return the bottom of that hole.
 * If the point is within a level, return the bottom of the level.
 * @param {PIXI.Point} p    Point to measure, in {x, y} format.
 * @return {Number|undefined} Levels elevation or undefined if levels is inactive or no levels found.
 */
function LevelsElevationAtPoint(p, starting_elevation) {
  if ( !game.settings.get(MODULE_ID, "enable-levels-elevation") || !game.modules.get("levels")?.active ) {
    return undefined;
  }

  // If in a hole, use that
  const hole_elevation = checkForHole(p, starting_elevation);
  if ( hole_elevation !== undefined ) return hole_elevation;

  // Use levels if found
  const levels_objects = _levels.getFloorsForPoint(p); // @returns {Object[]} returns an array of object each containing {tile,range,poly}
  log("LevelsElevationAtPoint levels_objects", levels_objects);
  return checkForLevel(p, starting_elevation);
}

// function levelNameAtPoint(p, zz) {
//   if ( !game.settings.get(MODULE_ID, "enable-levels-elevation") || !game.modules.get("levels")?.active ) {
//     return undefined;
//   }
//
//   const floors = _levels.getFloorsForPoint(p);
//   if ( !floors || floors.length < 1 ) { return undefined; }
//
//   const levels_data = canvas.scene.getFlag("levels", "sceneLevels"); // Array with [0]: bottom; [1]: top; [2]: name
//   if ( !levels_data ) { return undefined; }
//   for ( let l of levels_data ) {
//     if ( zz <= l[1] && zz >= l[0] ) return l[2];
//   }
//   return undefined;
// }


// Check for level; return bottom elevation
function checkForLevel(intersectionPT, zz) {
  // Poly undefined for tiles.
  const floors = _levels.getFloorsForPoint(intersectionPT); // @returns {Object[]} returns an array of object each containing {tile,range,poly}
  log("checkForLevel floors", floors);
  const floor_range = findCurrentFloorForElevation(zz, floors);
  log(`checkForLevel current floor range for elevation ${zz}: ${floor_range[0]} ${floor_range[1]}`);
  if ( !floor_range ) return undefined;
  return floor_range[0];
}

function findCurrentFloorForElevation(elevation, floors) {
  for ( let floor of floors ) {
  if ( elevation <= floor.range[1] && elevation >= floor.range[0] )
    return floor.range;
  }
  return false;
}

// Check if a floor is hollowed by a hole
// Based on Levels function, modified to return bottom elevation of the hole.
function checkForHole(intersectionPT, zz) {
  for ( let hole of _levels.levelsHoles ) {
    const hbottom = hole.range[0];
    const htop = hole.range[1];
    if ( zz > htop || zz < hbottom ) continue;
    if ( hole.poly.contains(intersectionPT.x, intersectionPT.y) ) return hbottom;
  }
  return undefined;
}
