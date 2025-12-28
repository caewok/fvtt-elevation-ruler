/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class
export const PATCHES = {};
PATCHES.BASIC = {};

import { MODULE_ID } from "./const.js";
import { BFSPathfinder, UniformCostPathfinder, GreedyBestFirstPathfinder, AStarPathfinder } from "./pathfinding/SimplePathfinding.js";
import { GridCoordinates } from "./geometry/GridCoordinates.js";

// ----- NOTE: Hooks ----- //

// ----- NOTE: Wraps ----- //

/**
 * Recalculate the planned movement path of this Token for the current User.
 */
function findMovementPath(wrapped, waypoints, options) {
  if ( waypoints.length < 2 ) return wrapped(waypoints, options);

  const pf = new (pathfinderClass())(this); // TODO: Initialize this in advance.

  /* For debugging.
  const dist = canvas.grid.measurePath(waypoints).euclidean;
  if ( dist > 20 ) console.log("\nfindMovementPath", ...waypoints);
  */

  // Only pathfind over the last waypoints.
  const start = GridCoordinates.fromObject(waypoints.at(-2)).center; // TODO: Gridless?
  const end = GridCoordinates.fromObject(waypoints.at(-1)).center;
  const path = pf.findPath(start, end);
  return { result: undefined, promise: pathfind(path, wrapped, waypoints, options), cancel: () => { pf.stop = true; } }; // TODO: Better cancel handling?
}

PATCHES.BASIC.WRAPS = { findMovementPath };


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
  switch ( CONFIG[MODULE_ID].simplePathfindingAlgorithm ) {
    case "astar": return AStarPathfinder;
    case "breadthfirst": return BFSPathfinder;
    case "uniformcost": return UniformCostPathfinder;
    case "GreedyBestFirstPathfinder": return GreedyBestFirstPathfinder;
    default: return AStarPathfinder;
  }
}


