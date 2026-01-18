/* globals
canvas,
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class
export const PATCHES = {};
PATCHES.BASIC = {};

import { MODULE_ID, PATHFINDING_ID } from "./const.js";
import { BFSPathfinder, UniformCostPathfinder, GreedyBestFirstPathfinder, AStarPathfinder } from "./pathfinding/SimplePathfinding.js";
import { TestPathfinder } from "./pathfinding/AbstractPathfinder.js";
import { GridCoordinates3d } from "./geometry/3d/GridCoordinates3d.js";

// ----- NOTE: Hooks ----- //

// ----- NOTE: Wraps ----- //

/**
 * Create the pathfinder class when dragging starts and initialize.
 */
function _initializeDragLeft(wrapped, event) {
  // TODO: Create pathfinder on token creation? Only initialize or update scene here?
  const obj = this[MODULE_ID] ??= {};
  const pf = obj[PATHFINDING_ID] = new (pathfinderClass())(this);
  pf.initialize();

  wrapped(event);
}



/**
 * Recalculate the planned movement path of this Token for the current User.
 */
function findMovementPath(wrapped, waypoints, options) {
  if ( waypoints.length < 2 ) return wrapped(waypoints, options);
  const pf = this[MODULE_ID]?.[PATHFINDING_ID];
  if ( !pf ) return wrapped(waypoints, options);

  /* For debugging.
  const dist = canvas.grid.measurePath(waypoints).euclidean;
  if ( dist > 20 ) console.log("\nfindMovementPath", ...waypoints);
  */

  // Only pathfind over the last waypoints.
  const start = GridCoordinates3d.fromObject(waypoints.at(-2)).center; // TODO: Gridless?
  const end = GridCoordinates3d.fromObject(waypoints.at(-1)).center;
  const pathfindingJob = pf.startJob();
  const path = pathfindingJob.findPath(start, end);
  return {
    result: undefined,
    promise: pathfind(path, wrapped, waypoints, options),
    cancel: () => { pf.cancelJob(pathfindingJob.jobId); } };
}

PATCHES.BASIC.WRAPS = { findMovementPath, _initializeDragLeft };


// ----- NOTE: Helper functions ----- //
async function pathfind(path, wrapped, waypoints, options) {
  const foundPath = await path;

  // Construct pathfinding waypoints.
  // TODO: Handle elevation, hex; for now just pass through.
  if ( foundPath ) {
    const foundryEnd = waypoints.pop();
    const foundryStart = waypoints.at(-1);
    for ( let i = 1, iMax = foundPath.length - 1; i < iMax; i += 1 ) {
      const pt = canvas.grid.getTopLeftPoint(foundPath[i]); // Foundry ruler uses top left coordinates.
      waypoints.push({ ...foundryStart, checkpoint: false, explicit: false, x: pt.x, y: pt.y });
    }
    waypoints.push(foundryEnd);
  }

  // Rerun findMovementPath to account for regions, etc.
  const foundrySearch = wrapped(waypoints, options);
  return foundrySearch.result || foundrySearch.promise;
}


function pathfinderClass() {
  switch ( CONFIG[MODULE_ID].simplePathfinding.algorithm ) {
    case "astar": return AStarPathfinder;
    case "breadth": return BFSPathfinder;
    case "uniform": return UniformCostPathfinder;
    case "greedy": return GreedyBestFirstPathfinder;
    case "test": return TestPathfinder;
    default: return AStarPathfinder;
  }
}


