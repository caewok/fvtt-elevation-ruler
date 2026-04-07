/* globals
canvas,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class
export const PATCHES = {};
PATCHES.BASIC = {};

import { Settings } from "./settings.js";
import { MODULE_ID, PATHFINDING_ID } from "./const.js";
import { GridCoordinates3d } from "./geometry/3d/GridCoordinates3d.js";
import { tokenTopLeftFromCenter, log } from "./util.js";

// ----- NOTE: Hooks ----- //

/**
 * Add a pathfinder when drawing the token.
 *
 * A hook event that fires when a {@link foundry.canvas.placeables.PlaceableObject} is initially drawn.
 * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "drawToken".
 * @event
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawToken(token) {
  if ( token.isPreview ) return;
  Settings.updateTokenPathfinder(token);
}

/**
 * Destroy the pathfinder when destroying the token.
 *
 * A hook event that fires when a {@link foundry.canvas.placeables.PlaceableObject} is destroyed.
 * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "destroyToken".
 * @event
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyToken(token) {
  const obj = token[MODULE_ID];
  if ( !obj ) return;
  delete obj[PATHFINDING_ID];
}
PATCHES.BASIC.HOOKS = { drawToken, destroyToken };


// ----- NOTE: Wraps ----- //

/**
 * Create the pathfinder class when dragging starts and initialize.
 */
function _initializeDragLeft(wrapped, event) {
  const pf = this[MODULE_ID]?.[PATHFINDING_ID];
  if ( !pf ) return wrapped(event);

  const start = GridCoordinates3d.fromObject(this.getCenterPoint());
  start.elevation = this.bottomE;
  pf.startPathfinding(start);
  wrapped(event);
}

function _onDragEnd(wrapped) {
  const pf = this[MODULE_ID]?.[PATHFINDING_ID];
  if ( pf ) pf.endPathfinding();
  wrapped();
}


/**
 * Recalculate the planned movement path of this Token for the current User.
 */
function findMovementPath(wrapped, waypoints, options) {
  if ( waypoints.length < 2 ) return wrapped(waypoints, options);
  const pf = this[MODULE_ID]?.[PATHFINDING_ID];
  if ( !pf || !Settings.doPathfinding ) return wrapped(waypoints, options);

  // For debugging.
  // const dist = canvas.grid.measurePath(waypoints).euclidean;
  // if ( dist > 20 ) console.log("\nfindMovementPath", ...waypoints);

  // Only pathfind over the last waypoints.
  const start = GridCoordinates3d.fromObject(waypoints.at(-2)).centerToGrid();
  const end = GridCoordinates3d.fromObject(waypoints.at(-1)).centerToGrid();

  // Add half the token elevation.
  // Different elevation amounts will result in different hurdling ability.
  // NOTE: Right now, token side faces are 1 pixel short, so a token at bottomZ === 0 will
  //       not intersect a line at 0. Same for top faces measuring along sides.
  const midE = (this.topE - this.bottomE) * 0.5;
  start.elevation = waypoints.at(-2).elevation + midE;
  end.elevation = waypoints.at(-1).elevation + midE;

  const pathfindingJob = pf.startJob();
  const path = pathfindingJob.findPath(start, end);
  return {
    result: undefined,
    promise: pathfind(path, wrapped, waypoints, options, this),
    cancel: () => { pf.cancelJob(pathfindingJob.jobId); } };
}

/**
 * TODO: Add token blocking handling to constrainMovementPath?.
 * Unclear if needed outside of collision pathfinding.
 */

PATCHES.BASIC.WRAPS = { findMovementPath, _initializeDragLeft, _onDragEnd };


// ----- NOTE: Helper functions ----- //

async function pathfind(path, wrapped, waypoints, options, token) {
  const foundPath = await path;

  // Construct pathfinding waypoints.
  // TODO: Handle elevation, hex; for now just pass through.
  if ( foundPath ) {
    const foundryEnd = waypoints.pop();
    const foundryStart = waypoints.at(-1);
    for ( let i = 1, iMax = foundPath.length - 1; i < iMax; i += 1 ) {
      // Adjust back the elevation of the path to account for token.
      const midE = (token.topE - token.bottomE) * 0.5;
      foundPath.elevation -= midE;

      // Adjust the path to the token TL.
      const pt = tokenTopLeftFromCenter(token, foundPath[i]);
      const prevW = waypoints[i - 1];
      if ( prevW.x.almostEqual(pt.x) && prevW.y.almostEqual(pt.y) ) continue;
      waypoints.push({ ...foundryStart, checkpoint: true, explicit: false, intermediate: false, x: pt.x, y: pt.y });
    }
    const prevW = waypoints.at(-1);
    if ( prevW.x.almostEqual(foundryEnd.x) && prevW.y.almostEqual(foundryEnd.y) ) waypoints.pop();
    waypoints.push(foundryEnd);
    // if ( PIXI.Point.distanceBetween(foundryStart, foundryEnd) > (6 * canvas.grid.size) ) { console.debug("Long path", { foundPath, waypoints }); }

    /*
    const pathStr = [];
    foundPath.forEach(pt => pathStr.push(`\t${pt}`));
    const start = GridCoordinates3d.fromLocationWithElevation(foundryStart, foundryStart.elevation);
    const end = GridCoordinates3d.fromLocationWithElevation(foundryEnd, foundryEnd.elevation);
    const waypointStr = [];
    waypoints.forEach(pt => waypointStr.push(`\t${GridCoordinates3d.fromLocationWithElevation(pt, pt.elevation)}`));
    log(`Found path for ${start} --> ${end}\n${pathStr.join("\n")}\nWaypoints:\n${waypointStr.join("\n")}`);
    */
  }

  // Rerun findMovementPath to account for regions, etc.
  const foundrySearch = wrapped(waypoints, options);
  return foundrySearch.result || foundrySearch.promise;
}
