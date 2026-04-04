/* globals
CONFIG,
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";
import { QBenchmarkLoopFn } from "../geometry/benchmark.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { dropIntermediatePoints, straightenPath, optimizeGridPath } from "./path_cleaning.js";
import { snapPathToGrid } from "./snap_to_grid.js";

/**
 * Bench all pathfinding for a token and an endpoint.
 * @param {Point3d|Token} startOrToken     If token, used as starting point
 * @param {Point3d|Token} endOrToken       If token, will take the center
 * @param [opts]
 * @param {number} N                    Number of benchmarks per algorithm
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
    console.warn(`Starting elevation is ${start.elevation} and ending elevation is ${end.elevation} Using start elevation.`);
    end.elevation = start.elevation;
  }

  return { start, end, token };
}

/**
 * Test and draw a path with a given pathfinding algorithm and settings.
 * @param {Point3d|Token} startOrToken      If token, used as starting point
 * @param {Point3d|Token} endOrToken        If token, will take the center
 * @param [opts]
 * @param {number} [opts.N]                 Number of benchmarks per algorithm
 * @param {Token} [opts.moveToken]          Token, if not passed as the start
 * @param {"webGPU"|"collision"|"clockwiseSweep"} [opts.algorithm]         Pathfinding algorithm
 * @param {}
 */
export async function testPathfinding(startOrToken, endOrToken, { moveToken, algorithm = "webGPU", graphPathfinding = {} }) {
  const api = game.modules.get(MODULE_ID).api;
  const { ClockwiseSweepPathfinder, GriddedCollisionPathfinder, WebGPUPathfinder } = api.pathfinding;

  const oldConfig = foundry.utils.duplicate(CONFIG[MODULE_ID].graphPathfinding);
  foundry.utils.mergeObject(CONFIG[MODULE_ID].graphPathfinding, graphPathfinding,
    { insertKeys: false, inplace: true });

  const { start, end, token } = getPathCoordinates(startOrToken, endOrToken, moveToken);
  let pf;
  switch ( algorithm ) {
    case "collision": pf = new GriddedCollisionPathfinder(token); break;
    case "clockwiseSweep": pf = new ClockwiseSweepPathfinder(token); break;
    case "webGPU": await WebGPUPathfinder.initialize(); pf = new WebGPUPathfinder(token); break;
  }

  console.time(`Pathfinding setup for ${algorithm}`);
  await pf.startPathfinding(start);
  console.timeEnd(`Pathfinding setup for ${algorithm}`);

  CONFIG[MODULE_ID].graphPathfinding = oldConfig;

  console.time(`Pathfinding using ${algorithm}`);
  const path = await pf._findPath(start, end); // Skip caching
  console.timeEnd(`Pathfinding using ${algorithm}`);

  if ( !path ) {
    console.warn("No path found!", { start, end });
    return;
  }
  pf.constructor.drawPath(path);

  let gridPath;
  let straightPath;
  switch ( algorithm ) {
    case "collision":
      straightPath = dropIntermediatePoints(path);
      straightPath = straightenPath(straightPath, pf.token);

      gridPath = dropIntermediatePoints(path);
      break;

    case "clockwiseSweep":
      straightPath = path;

      gridPath = await snapPathToGrid(path, pf.token);
      gridPath = optimizeGridPath(gridPath, pf.token);
      break;

    case "webGPU":
      straightPath = dropIntermediatePoints(path);
      straightPath = straightenPath(straightPath, pf.token);

      gridPath = dropIntermediatePoints(path);
      break;
  }


  pf.constructor.drawPath(straightPath, { color: Draw.COLORS.lightblue });
  pf.constructor.drawPath(gridPath, { color: Draw.COLORS.lightgreen });

  const origTest = pf.validatePath(path, start, end);
  const straightTest = pf.validatePath(straightPath, start, end);
  const gridTest = pf.validatePath(gridPath, start, end);

  console.log(`Original path: ${origTest}`);
  console.log(`Straight path (light blue): ${straightTest}`);
  console.log(`Gridded path (light green): ${gridTest}`);
}
