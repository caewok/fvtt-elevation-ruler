/* globals
canvas,
game,
CONFIG,
ui,
PIXI
*/
"use strict";

/* Measure terrain elevation at a point.
Used by ruler to get elevation at waypoints and at the end of the ruler.
*/

import { log, MODULE_ID } from "./module.js";
import { SETTINGS, getSetting } from "./settings.js";

/**
 * Retrieve the elevation at the current ruler origin.
 * This is either the measuring token elevation or terrain elevation or 0.
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
  return token?.document?.elevation ?? 0;
}

/**
 * Determine if token elevation should be preferred
 * @returns {boolean}
 */
function preferTokenElevation() {
  if ( !getSetting(SETTINGS.PREFER_TOKEN_ELEVATION) ) return false;
  const token_controls = ui.controls.controls.find(elem => elem.name === "token");
  const prefer_token_control = token_controls.tools.find(elem => elem.name === SETTINGS.PREFER_TOKEN_ELEVATION);
  return prefer_token_control.active;
}

/**
 * Retrieve the terrain elevation at the current ruler destination
 * @param {object} [options]  Options that modify the calculation
 * @param {boolean} [options.considerTokens]    Consider token elevations at that point.
 */
export function terrainElevationAtDestination({ considerTokens = true } = {}) {
  return this.terrainElevationAtPoint(this.destination, { considerTokens });
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
 * @param {boolean} [options.considerTokens]    Consider token elevations at that point.
 * @returns {number} Elevation for the given point.
 */
export function terrainElevationAtPoint(p, { considerTokens = true } = {}) {

  const measuringToken = this._getMovementToken();
  const startingElevation = tokenElevation(measuringToken);
  const ignoreBelow = ( measuringToken && preferTokenElevation() ) ? startingElevation : Number.NEGATIVE_INFINITY;

  log(`Checking Elevation at (${p.x}, ${p.y}) ${(considerTokens ? "" : "not ") + "considering tokens"}\n\tstarting elevation ${startingElevation}\n\tignoring below ${ignoreBelow}`);

  if ( considerTokens ) {  // Check for tokens; take the highest one at a given position
    const tokens = retrieveVisibleTokens();
    const max_token_elevation = tokens.reduce((e, t) => {
      // Is the point within the token control area?
      if ( !t.bounds.contains(p.x, p.y) ) return e;
      return Math.max(tokenElevation(t), e);
    }, Number.NEGATIVE_INFINITY);
    log(`calculateEndElevation: ${tokens.length} tokens at (${p.x}, ${p.y}) with maximum elevation ${max_token_elevation}`);

    // Use tokens rather than elevation if available
    if ( isFinite(max_token_elevation) && max_token_elevation >= ignoreBelow ) return max_token_elevation;
  }

  // Try Levels
  const levels_elevation = LevelsElevationAtPoint(p, { startingElevation });
  if ( levels_elevation !== undefined && levels_elevation > ignoreBelow ) return levels_elevation;

  // Try Elevated Vision
  const ev_elevation = EVElevationAtPoint(p);
  if ( ev_elevation !== undefined && ev_elevation > ignoreBelow ) return ev_elevation;

  // Try Enhanced Terrain Layer
  const terrain_elevation = TerrainLayerElevationAtPoint(p);
  if ( terrain_elevation !== undefined && terrain_elevation > ignoreBelow ) return terrain_elevation;

  // Default to 0 elevation for the point
  return Math.max(ignoreBelow, 0);
}

function retrieveVisibleTokens() {
  return canvas.tokens.children[0].children.filter(c => c.visible);
}

// ----- HELPERS TO TRIGGER ELEVATION MEASURES ---- //
/**
 * Should Elevated Vision module be used?
 * @returns {boolean}
 */
function useElevatedVision() {
  return game.modules.get("elevatedvision")?.active
    && game.settings.get(MODULE_ID, "enable-elevated-vision-elevation");
}

/**
 * Should Terrain Layers module be used?
 * @returns {boolean}
 */
function useTerrainLayer() {
  return game.modules.get("enhanced-terrain-layer")?.active
    && game.settings.get(MODULE_ID, "enable-enhanced-terrain-elevation");
}

/**
 * Should Levels module be used?
 * @returns {boolean}
 */
function useLevels() {
  return game.modules.get("levels")?.active
    && game.settings.get(MODULE_ID, "enable-levels-elevation");
}

// ----- ELEVATED VISION ELEVATION ----- //
/**
 * Measure the terrain elevation at a given point using Elevated Vision.
 * @param {Point} {x,y}    Point to measure, in {x, y} format
 * @returns {Number|undefined} Point elevation or undefined if elevated vision layer is inactive
 */
function EVElevationAtPoint({x, y}) {
  if ( !useElevatedVision() ) return undefined;
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
  if ( !useTerrainLayer() ) return undefined;

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
// - if multiple, use the closest to the starting elevation
// starting point of the ruler is a token:
// - if the same level is present, stay at that level
//   (elevation should be found from the token, so no issue)

/*
 * Measure the elevation of any levels tiles at the point.
 * If the point is within a hole, return the bottom of that hole.
 * If the point is within a level, return the bottom of the level.
 * @param {PIXI.Point} p    Point to measure, in {x, y} format.
 * @return {Number|undefined} Levels elevation or undefined if levels is inactive or no levels found.
 */
function LevelsElevationAtPoint(p, { startingElevation = 0 } = {}) {
  if ( !useLevels() ) return undefined;

  let tiles = [...levelsTilesAtPoint(p)];
  if ( !tiles.length ) return undefined;

  tiles = tiles
    .filter(t => startingElevation >= t.document.flags.levels.rangeBottom && startingElevation < t.document.flags.levels.rangeTop)
    .sort((a, b) => a.document.flags.levels.rangeBottom - b.document.flags.levels.rangeBottom);

  const ln = tiles.length;
  if ( !ln ) return undefined;
  return tiles[ln - 1].document.flags.levels.rangeBottom;
}


/**
 * Get all tiles that have a levels range
 * @param {Point} {x, y}
 * @returns {Set<Tile>}
 */
function levelsTilesAtPoint({x, y}) {
  const bounds = new PIXI.Rectangle(x, y, 1, 1);
  const collisionTest = (o, rect) => { // eslint-disable-line no-unused-vars
    // The object o constains n (Quadtree node), r (rect), t (object to test)
    const flags = o.t.document?.flags?.levels;
    if ( !flags ) return false;
    if ( !isFinite(flags.rangeTop) || !isFinite(flags.rangeBottom) ) return false;
    return true;
  };

  return canvas.tiles.quadtree.getObjects(bounds, { collisionTest });
}
