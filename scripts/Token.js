/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class
export const PATCHES = {};
PATCHES.BASIC = {};

import { Settings } from "./settings.js";
import { MODULE_ID, PATHFINDING_ID } from "./const.js";
import { GridCoordinates3d } from "./geometry/3d/GridCoordinates3d.js";
import { tokenTopLeftFromCenter } from "./util.js";

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
  if ( !pf ) return wrapped(waypoints, options);

  // For debugging.
  // const dist = canvas.grid.measurePath(waypoints).euclidean;
  // if ( dist > 20 ) console.log("\nfindMovementPath", ...waypoints);


  // Only pathfind over the last waypoints.
  const start = GridCoordinates3d.fromObject(this.getCenterPoint(waypoints.at(-2)));
  const end = GridCoordinates3d.fromObject(this.getCenterPoint(waypoints.at(-1)));
  start.elevation = waypoints.at(-2).elevation;
  end.elevation = waypoints.at(-1).elevation;

  const pathfindingJob = pf.startJob();
  const path = pathfindingJob.findPath(start, end);
  return {
    result: undefined,
    promise: pathfind(path, wrapped, waypoints, options, this),
    cancel: () => { pf.cancelJob(pathfindingJob.jobId); } };
}

PATCHES.BASIC.WRAPS = { findMovementPath, _initializeDragLeft, _onDragEnd };


// ----- NOTE: Helper functions ----- //

async function pathfind(path, wrapped, waypoints, options, token) {
  const foundPath = await path;

  // Construct pathfinding waypoints.
  // TODO: Handle elevation, hex; for now just pass through.
  if ( foundPath ) {
    const foundryEnd = waypoints.pop();
    const foundryStart = waypoints.at(-1);
    if ( PIXI.Point.distanceBetween(foundryStart, foundryEnd) > (6 * canvas.grid.size) ) { console.debug("Long path", foundPath); }

    for ( let i = 1, iMax = foundPath.length - 1; i < iMax; i += 1 ) {
      // const pt = canvas.grid.getTopLeftPoint(foundPath[i]); // Foundry ruler uses top left coordinates.
      const pt = tokenTopLeftFromCenter(token, foundPath[i]);
      const prevW = waypoints[i - 1];
      if ( prevW.x.almostEqual(pt.x) && prevW.y.almostEqual(pt.y) ) continue;
      waypoints.push({ ...foundryStart, checkpoint: false, explicit: false, x: pt.x, y: pt.y });
    }
    const prevW = waypoints.at(-1);
    if ( prevW.x.almostEqual(foundryEnd.x) && prevW.y.almostEqual(foundryEnd.y) ) waypoints.pop();
    waypoints.push(foundryEnd);
  }

  // Rerun findMovementPath to account for regions, etc.
  const foundrySearch = wrapped(waypoints, options);
  return foundrySearch.result || foundrySearch.promise;
}


