/* globals
canvas,
CONFIG,
PIXI,
ui
*/
"use strict";

/* When dragging tokens
Origin: each token elevation
Other: terrain elevation for each token
*/

/* When using ruler from a movement token
Origin: token elevation
Other:
 - Hovering over token: highest token elevation unless prefer token elevation
 - Otherwise: terrain elevation
*/

/* When using ruler without movement token_controls
Origin: terrain elevation
Other:
 - Hovering over token: highest token elevation unless prefer token elevation
 - terrain elevation
*/

/* Key methods
Ruler.terrainElevationAtLocation(location, { movementToken, startingElevation = 0 })
Ruler.prototype.elevationAtLocation(location, token)
Ruler.elevationAtWaypoint

Getters:
  - originElevation
  - destinationElevation

elevationAtLocation -- all ruler types
*/


/* Measure terrain elevation at a point.
Used by ruler to get elevation at waypoints and at the end of the ruler.
*/

import { MODULES_ACTIVE, MOVEMENT_TYPES } from "./const.js";
import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";

/**
 * Calculate the elevation for a given waypoint.
 * Terrain elevation + user increment
 * @param {object} waypoint
 * @returns {number}
 */
export function elevationAtWaypoint(waypoint) {
  const incr = waypoint._userElevationIncrements ?? 0;
  const terrainE = waypoint._terrainElevation ?? 0;
  return terrainE + (incr * canvas.dimensions.distance);
}

/**
 * Add getter Ruler.prototype.originElevation
 * Retrieve the elevation at the current ruler origin waypoint.
 * @returns {number|undefined} Elevation, in grid units. Undefined if the ruler has no waypoints.
 */
export function originElevation() {
  const firstWaypoint = this.waypoints[0];
  return firstWaypoint ? elevationAtWaypoint(firstWaypoint) : undefined;
}

/**
 * Retrieve the terrain elevation at the current ruler destination
 * @param {object} [options]  Options that modify the calculation
 * @param {boolean} [options.considerTokens]    Consider token elevations at that point.
 * @returns {number|undefined} Elevation, in grid units. Undefined if ruler not active.
 */
export function destinationElevation() {
  if ( !this.destination ) return undefined;
  return this.elevationAtLocation(this.destination);
}

/**
 * Ruler.terrainElevationAtLocation
 * Measure elevation at a given location.
 * @param {Point} location      Location to measure
 * @param {object} [opts]       Options that modify the calculation
 * @param {number} [opts.startingElevation=0]   Assumed starting elevation. Relevant for EV or Levels.
 * @param {Token} [opts.movementToken]          Assumed token for the measurement. Relevant for EV.
 * @returns {number} Elevation, in grid units.
 */
export function terrainElevationAtLocation(location, { startingElevation, movementToken } = {}) {
  startingElevation ??= movementToken?.elevationE ?? 0;

  // If certain modules are active, use them to calculate elevation.
  let elevation = 0;
  if ( MODULES_ACTIVE.ELEVATED_VISION ) elevation = EVElevationAtPoint(location, startingElevation, movementToken);
  else if ( MODULES_ACTIVE.LEVELS ) elevation = LevelsElevationAtPoint(location, startingElevation);
  if ( isFinite(elevation) ) return elevation;

  // Default is the scene elevation.
  return 0;
}

/**
 * Ruler.prototype.elevationAtLocation.
 * Measure elevation for a given ruler position and token.
 * Accounts for whether we are using regular Ruler or Token Ruler.
 * @param {Point} location      Position on canvas to measure
 * @param {Token} [token]       Token that is assumed to be moving if not this._movementToken
 * @returns {number}
 */
export function elevationAtLocation(location, token) {
  location = PIXI.Point.fromObject(location);
  token ??= this._getMovementToken();
  const isTokenRuler = Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED)
    && ui.controls.activeControl === "token"
    && ui.controls.activeTool === "select"
    && token;

  // 1. If forcing to ground, always use the terrain elevation.

  /* If not forcing to ground:
  2. No move token
    --> Default: Use origin elevation
    --> If hovering over a token, use that token's elevation
  3. Move token, normal ruler
    --> Default: Use move token elevation
    --> If hovering over a token, use that token's elevation
  4. Token ruler
    --> Default: Use move token elevation
    --> If token is walking, use terrain elevation
  */
  const terrainElevationFn = () => this.constructor.terrainElevationAtLocation(location, {
    movementToken: token,
    startingElevation: this.originElevation
  });

  // #1 Forcing to ground
  if ( Settings.FORCE_TO_GROUND ) return terrainElevationFn();

  // #4 token ruler
  if ( isTokenRuler ) {
    if ( token.movementType === MOVEMENT_TYPES.WALK ) return terrainElevationFn();
    return token.elevationE;
  }

  // If at the token, use the token's elevation.
  // if ( token && location.almostEqual(token.center) ) return token.elevationE;

  // Check for other tokens at destination and use that elevation.
  const maxTokenE = retrieveVisibleTokens()
    .filter(t => t.constrainedTokenBorder.contains(location.x, location.y))
    .reduce((e, t) => Math.max(t.elevationE, e), Number.NEGATIVE_INFINITY);
  if ( isFinite(maxTokenE) ) return maxTokenE; // #2 or #3

  // #3 move token
  if ( token ) return token.elevationE;

  // #2 no move token
  return this.originElevation;
}

// ----- NOTE: HELPER FUNCTIONS ----- //

function retrieveVisibleTokens() {
  return canvas.tokens.children[0].children.filter(c => c.visible);
}

// ----- NOTE: ELEVATED VISION ELEVATION ----- //
/**
 * Measure the terrain elevation at a given point using Elevated Vision.
 * @param {Point} {x,y}         Point to measure, in {x, y} format
 * @param {number} elevation    Elevation from which to measure, in grid units.
 * @returns {Number|undefined} Point elevation or undefined if elevated vision layer is inactive
 */
function EVElevationAtPoint(location, elevation, measuringToken) {
  let EVCalc;
  if ( measuringToken) {
    elevation ??= measuringToken.elevationE;
    EVCalc = new canvas.elevation.TokenElevationCalculator(measuringToken,
      { location, elevation, overrideTokenPosition: true });
  } else {
    elevation = isFinite(elevation) ? elevation : Number.MAX_SAFE_INTEGER;
    const location3d = Point3d.fromObject(location);
    location3d.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation ?? 0);
    EVCalc = new canvas.elevation.CoordinateElevationCalculator(location3d);
    EVCalc.options.tileStep = Number.POSITIVE_INFINITY;
    EVCalc.options.terrainStep = Number.POSITIVE_INFINITY;
  }

  return EVCalc.groundElevation();
}

// ----- NOTE: LEVELS ELEVATION ----- //
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
export function LevelsElevationAtPoint(p, startingElevation = 0) {
  let tiles = [...levelsTilesAtPoint(p)];
  if ( !tiles.length ) return undefined;

  tiles = tiles
    .filter(t => startingElevation >= t.document.flags.levels.rangeBottom
      && startingElevation < t.document.flags.levels.rangeTop)
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
