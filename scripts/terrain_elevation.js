/* globals
canvas,
CONFIG,
PIXI,
ui
*/
"use strict";

/*
Ruler should measure from fixed starting position ---> waypoint where waypoint can be incremented/decremented.

For terrain, this would mean the ruler defaults to terrain ground but that waypoint can be moved up/down.
--> causes it to go to fly or burrow mode.

For tokens, this would mean the path always starts from token position. Elevate token manually if you need to.
Path endpoint is adjusted such that it goes up/down.

Elevation increments here are relative to ground position. To avoid recursion and infinite loops:
- Get the ground at the destination based on starting elevation ± user increments.
- Measure a path from start to destination at the ending elevation. May or may not be at the end elevation.
- Each waypoint has a set elevation, based on its measured path. Only the destination waypoint can change, and only it is measured.


Ruler Foundry default display:
                (Waypoint)
•--------------------•----------•
                   20 ft       10 ft [30 ft]

Two types of measurement:
1. Ruler point to ruler point. No token movement, so not a "path".
- Terrain: Ground elevation at the destination point.
- Inc/Dec Elevation: Change the destination.

                (Waypoint)
•--------------------•----------•
                   20 ft      10 ft [30 ft]
                   @10 ft    @15 ft          <-- Lose the up/down arrows, align the unit measure

2. Token to ruler point. Token movement, so follow a "path".
- Terrain: Construct path. Measure distance based on path. Destination elevation based on path.
- Inc/Dec Elevation: Change end elevation for the path based on the current dest. Forces to fly/burrow mode.

2a. Basic ruler, starting at a token.

(Token)
                (Waypoint)
•--------------------•----------•
                   30 ft      10 ft [40 ft]
                  @10 ft     @15 ft         <-- Lose the up/down arrows, align the unit measure

2b. Token Ruler, dragging a token.

                                +15 ft
                (Waypoint)     (Token)
•--------------------•----------•
                   30 ft      10 ft [40 ft]
                  @10 ft               <-- Lose the up/down arrows, align the unit measure


waypoint 0:
- token elevation or ground elevation.
Properties:
• forceToGround: false (cannot force-to-ground)
• userElevationIncrements
• elevation (accounts for prior waypoint userElevationIncrements, path, terrainElevation)
• terrainElevation (at the waypoint).

segment 0:
• ray: Ray3d. Elevation is after processing the destination elevation and path
• cost
• cumulativeCost
• cumulativeDistance
• distance
• first
• last
• moveDistance
• numDiagonal
• numPrevDiagonalf


*/




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

import { MODULES_ACTIVE, MODULE_ID, FLAGS, MOVEMENT_TYPES } from "./const.js";
import { Settings } from "./settings.js";
import { movementTypeForTokenAt } from "./token_hud.js";

/**
 * Calculate the user change to elevation at this waypoint.
 * @param {Point} waypoint
 * @returns {number} Elevation delta in grid units
 */
export function userElevationChangeAtWaypoint(waypoint) {
  return (waypoint._userElevationIncrements ?? 0) * canvas.dimensions.distance;
}


/**
 * Add getter Ruler.prototype.originElevation
 * Retrieve the elevation at the origin, taking into account terrain, token, and move-to-ground setting.
 * @returns {number|undefined} Elevation, in grid units. Undefined if the ruler has no waypoints.
 */
export function originElevation() { return this.origin?.elevation; }

/**
 * Retrieve the terrain elevation at the current ruler destination
 * @param {object} [options]  Options that modify the calculation
 * @param {boolean} [options.considerTokens]    Consider token elevations at that point.
 * @returns {number|undefined} Elevation, in grid units. Undefined if ruler not active.
 */
export function destinationElevation() {
  if ( !this.destination ) return undefined;
  const waypoint = this.waypoints.at(-1);
  return elevationFromWaypoint(waypoint, this.destination, this.token);
}

/**
 * Measure elevation from a given waypoint to a location.
 * Accounts for whether we are using regular Ruler or Token Ruler.
 * Assumes straight-line movement from the prior waypoint to the location.
 * @param {Point} waypoint      Waypoint to assume as the starting point. Uses that waypoint's elevation
 * @param {Point} location      Position on canvas to measure
 * @param {Token} [token]       Token that is assumed to be moving if not this._movementToken
 * @returns {number} Elevation, in grid units.
 */
export function elevationFromWaypoint(waypoint, location, token) {
  const isTokenRuler = Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED)
    && ui.controls.activeControl === "token"
    && ui.controls.activeTool === "select"
    && token;

  // For debugging, test at certain distance
  if ( CONFIG[MODULE_ID].debug ) {
    const dist = CONFIG.GeometryLib.utils.pixelsToGridUnits(PIXI.Point.distanceBetween(waypoint, location));
    if ( dist > 40 ) console.debug(`elevationFromWaypoint ${dist}`);
    else if ( dist > 30 ) console.debug(`elevationFromWaypoint ${dist}`);
    else if ( dist > 20 ) console.debug(`elevationFromWaypoint ${dist}`);
    else if ( dist > 10 ) console.debug(`elevationFromWaypoint ${dist}`);
    else if ( dist > 5 ) console.debug(`elevationFromWaypoint ${dist}`);
  }

  let locationElevation;
  if ( !isTokenRuler ) {
    let maxTokenE;
    const terrainE = terrainElevationAtLocation(location, waypoint.elevation);

    // For normal ruler, if hovering over a token, use that token's elevation.
    // Use the maximum token elevation unless terrain is above us (e.g., tile above).
    if ( !Settings.FORCE_TO_GROUND ) maxTokenE = maxTokenElevationAtLocation(location, terrainE > waypoint.elevation ? terrainE : undefined);
    if ( maxTokenE ) locationElevation = maxTokenE;

    // If the starting elevation is on the ground or force-to-ground is enabled, use the ground elevation.
    else locationElevation = elevationAtLocation(location, {
      startE: waypoint.elevation,
      forceToGround: Settings.FORCE_TO_GROUND || waypoint.elevation.almostEqual(terrainElevationAtLocation(waypoint, waypoint.elevation))
    });
  } else locationElevation = tokenElevationForMovement(waypoint, location, {
    token,
    forceToGround: Settings.FORCE_TO_GROUND
  });
  return locationElevation + userElevationChangeAtWaypoint(waypoint);
}

/**
 * Measure elevation at a destination
 * @param {Point} location                              Location for which elevation is desired
 * @param {number} startE                               Elevation at the starting point
 * @param {object} [opts]
 * @param {boolean} [opts.forceToGround=false]          If true, override the end elevation with nearest ground to that 3d point.
 * @returns {number} The destination elevation, in grid units
 */
function elevationAtLocation(location, { startE = 0, forceToGround = false } ) {
  const terrainE = terrainElevationAtLocation(location, startE);
  return forceToGround ? terrainE : Math.max(terrainE, startE);
}

/**
 * Measure elevation at a destination for a token movement from a start location to the destination.
 * @param {RegionMovementWaypoint} start                Start location with elevation property
 * @param {Point} location                              Desired end location
 * @param {object} [opts]
 * @param {boolean} [opts.forceToGround=false]          If true, override the end elevation with nearest ground to that 3d point.
 * @returns {number} The destination elevation, in grid units
 */
function tokenElevationForMovement(start, location, opts = {}) {
  const forceToGround = opts.forceToGround ?? false;
  const end = { ...location };
  end.elevation = forceToGround ? terrainElevationAtLocation(location, start.elevation) : start.elevation;
  if ( opts.token && !forceToGround ) {
    const movementTypeStart = movementTypeForTokenAt(opts.token, start);
    opts.flying ??= movementTypeStart === MOVEMENT_TYPES.FLY;
    opts.burrowing ??= movementTypeStart === MOVEMENT_TYPES.BURROW;
  }
  return terrainElevationForMovement(start, end, opts);
}

/**
 * Determine if a token exists at the location and return its elevation.
 * @param {Point} location
 * @returns {number|null} The elevation of the highest token, in grid units.
 */
function maxTokenElevationAtLocation(location, ceiling = Number.POSITIVE_INFINITY) {
  const maxTokenE = retrieveVisibleTokens()
    .filter(t => t.constrainedTokenBorder.contains(location.x, location.y))
    .reduce((e, t) => t.elevationE < ceiling ? Math.max(t.elevationE, e) : e, Number.NEGATIVE_INFINITY);
  return isFinite(maxTokenE) ? maxTokenE : null;
}

/**
 * Ruler.terrainElevationAtLocation
 * Measure elevation at a given location. Terrain level: at or below this elevation.
 * @param {Point} location      Location to measure
 * @param {object} [opts]       Options that modify the calculation
 * @param {number} [opts.fixedElevation]        Any area that contains this elevation counts
 * @param {number} [opts.maxElevation]          Any area below or equal to this grid elevation counts
 * @param {Token} [opts.movementToken]          Assumed token for the measurement. Relevant for EV.
 * @returns {number} Elevation, in grid units.
 */
export function terrainElevationAtLocation(location, startingElevation = 0) {
  // If certain modules are active, use them to calculate elevation.
  // For now, take the first one that is present.
  const tmRes = TMElevationAtPoint(location, startingElevation);
  if ( isFinite(tmRes) ) return tmRes;

  const levelsRes = LevelsElevationAtPoint(location, startingElevation);
  if ( levelsRes !== null && isFinite(levelsRes) ) return levelsRes;

  // Default is the scene or location elevation.
  return location.elevation ?? 0;
}

/**
 * Ruler.terrainElevationForMovement
 * For a given token move along segment start|end, return the elevation at location.
 * @param {RegionMovementWaypoint} start                Start location with elevation property
 * @param {RegionMovementWaypoint} end                  Desired end location
 * @param {object} [opts]                               Options passed to TerrainMapper. Should include token.
 * @returns {number} Elevation, in grid units
 */
export function terrainElevationForMovement(start, end, opts) {
  end.elevation ??= start.elevation;
  const res = TMElevationForMovement(start, end, opts);
  return res ?? terrainElevationAtLocation(end, start.elevation);
}

/**
 * Ruler.terrainPathForMovement
 * For a given token move along a segment start|end, return the path points for the terrain elevation changes.
 * @param {RegionMovementWaypoint} start                Start location with elevation property
 * @param {RegionMovementWaypoint} end                  Desired end location
 * @param {object} [opts]                               Options passed to TerrainMapper. Should include token.
 * @returns {StraightLinePath<RegionMovementWaypoint>} Array of path points.
 */
export function terrainPathForMovement(start, end, opts) {
  return TMPathForMovement(start, end, opts);
}


// ----- NOTE: HELPER FUNCTIONS ----- //

function retrieveVisibleTokens() {
  return canvas.tokens.children[0].children.filter(c => c.visible);
}

// ----- NOTE: TerrainMapper Elevation ----- //

/**
 * Measure the terrain elevation at a given point using Terrain Mapper.
 * @param {Point} location                    Point to measure, in {x, y} format
 * @param {number} [startingElevation=0]      Measure nearest ground from this elevation
 * @returns {Number|undefined} Point elevation or null if module not active or no region at location.
 */
function TMElevationAtPoint(location, startingElevation = Number.POSITIVE_INFINITY) {
  const api = MODULES_ACTIVE.API.TERRAIN_MAPPER
  if ( !api || !api.ElevationHandler ) return undefined;
  const waypoint = { ...location, elevation: startingElevation };
  const res = api.ElevationHandler.nearestGroundElevation(waypoint);
  if ( isFinite(res) ) return res;
  return canvas.scene?.flags?.terrainmapper?.[FLAGS.SCENE.BACKGROUND_ELEVATION] ?? 0;
}

/**
 * Measure the terrain elevation when moving a token with Terrain Mapper.
 * @param {RegionMovementWaypoint} start                Start location with elevation property
 * @param {RegionMovementWaypoint} end                  Desired end location
 * @param {object} [opts]                               Options passed to TerrainMapper. Should include token.
 * @returns {number|undefined} Elevation, in grid units
 */
function TMElevationForMovement(start, end, opts) {
  const api = MODULES_ACTIVE.API.TERRAIN_MAPPER
  if ( !api || !api.ElevationHandler ) return undefined;
  return TMPathForMovement(start, end, opts).at(-1)?.elevation;
}

/**
 * Retrieve a path that is modified (in elevation) by terrain when moving a token
 * with Terrain Mapper.
 * @param {RegionMovementWaypoint} start                Start location with elevation property
 * @param {RegionMovementWaypoint} end                  Desired end location
 * @param {object} [opts]                               Options passed to TerrainMapper. Should include token.
 * @returns {StraightLinePath<RegionMovementWaypoint>} Array of path points.
 */
function TMPathForMovement(start, end, opts) {
  start.elevation ??= CONFIG.GeometryLib.utils.pixelsToGridUnits(start.z);
  end.elevation ??= CONFIG.GeometryLib.utils.pixelsToGridUnits(end.z);
  const api = MODULES_ACTIVE.API.TERRAIN_MAPPER
  if ( !api || !api.ElevationHandler ) return [start, end];
  return api.ElevationHandler.constructPath(start, end, opts);
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
  if ( !MODULES_ACTIVE.LEVELS ) return undefined;

  let tiles = [...levelsTilesAtPoint(p)];
  if ( !tiles.length ) return null;

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
