/* globals
CONFIG,
game,
Token,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";
import { QBenchmarkLoopFn } from "../geometry/benchmark.js";
import { randomPoint } from "./random.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";

/**
 * Bench all pathfinding for a token and an endpoint.
 * @param {Point3d|token} start     If token, used as starting point
 * @param {Point3d|token} end       If token, will take the center
 * @param [opts]
 * @param {number} N                Number of benchmarks per algorithm
 * @param {Token} moveToken             Token, if not passed as the start
 */
export async function benchTokenPath(startOrToken, endOrToken, { N = 10, moveToken } = {}) {
  const { start, end, token } = getPathCoordinates(startOrToken, endOrToken, moveToken);
  const api = game.modules.get(MODULE_ID).api;
  const { ClockwiseSweepPathfinder, GriddedCollisionPathfinder, WebGPUPathfinder } = api.pathfinding;
  console.log(`Testing pathfinding for ${token.name} from ${start} --> ${end}.`);
  const pathfind = async (pf, type) => {
    const description = type ? `${pf.constructor.name}|${type}` : pf.constructor.name;
    await pf.startPathfinding(start);
    await QBenchmarkLoopFn(N, pf._findPath.bind(pf), description, start, end);
  };

  // GriddedCollisionPathfinder
  let pf = new GriddedCollisionPathfinder(token);
  const neighborFilter = CONFIG.elevationruler.graphPathfinding.neighborFilter;

  // GriddedCollisionPathfinder|occlusion
  let type = "occlusion";
  CONFIG.elevationruler.graphPathfinding.neighborFilter = type;
  await pathfind(pf, type);

  // GriddedCollisionPathfinder|occlusion
  type = "sceneGraph";
  CONFIG.elevationruler.graphPathfinding.neighborFilter = type;
  await pathfind(pf, type);

  // GriddedCollisionPathfinder|occlusion
  type = "clockwiseSweep";
  CONFIG.elevationruler.graphPathfinding.neighborFilter = type;
  await pathfind(pf, type);

  // Reset settings for graphPathfinding.
  CONFIG.elevationruler.graphPathfinding.neighborFilter = neighborFilter;

  // ClockwisePathfinder
  pf = new ClockwiseSweepPathfinder(token);
  await pathfind(pf);

  // WebGPUPathfinder
  await WebGPUPathfinder.initialize();
  pf = new WebGPUPathfinder(token);
  await pathfind(pf);
}

function getPathCoordinates(startOrToken, endOrToken, token) {
  if ( startOrToken instanceof foundry.canvas.placeables.Token ) token ??= startOrToken;
  if ( !token ) throw Error("benchTokenPath requires a valid token.");
  const midZ = (token.topZ - token.bottomZ) * 0.5;

  let start;
  let end;
  if ( startOrToken instanceof foundry.canvas.placeables.Token ) start = GridCoordinates3d.fromTokenCenter(token);
  else {
    start = GridCoordinates3d.fromObject(startOrToken);
    if ( !(Object.hasOwn(startOrToken, "z")
        || Object.hasOwn(startOrToken, "elevation")) ) start.z = midZ;
  }
  if ( endOrToken instanceof foundry.canvas.placeables.Token ) end = GridCoordinates3d.fromTokenCenter(endOrToken);
  else {
    end = GridCoordinates3d.fromObject(endOrToken);
    if ( !(Object.hasOwn(endOrToken, "z")
        || Object.hasOwn(endOrToken, "elevation")) ) end.z = midZ;
  }

  if ( start.elevation !== end.elevation || !start.elevation ) {
    console.warn(`Starting elevation is ${start.elevation} and ending elevation is ${end.elevation}.`);
  }

  return { start, end, token };
}
