/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { QBenchmarkLoopFn } from "./benchmark_functions.js";
import { randomPoint } from "./random.js";
import { Pathfinder } from "./pathfinding.js";

// Methods to benchmark pathfinding.

/* Use
api = game.modules.get("elevationruler").api;

N = 1000
await api.pathfinding.benchPathfinding(N)


*/

export async function benchPathfinding(nPaths = 100, type = "all", nIterations = 10) {
  Pathfinder.initialize(); // TODO: Only needed until wall updating is fixed.
  const token = canvas.tokens.controlled[0];
  const pf = new Pathfinder(token);

  let message = `Testing pathfinding for ${nPaths} random start/end locations.`;
  if ( token ) message += ` Using size of ${token.name} token.`;
  console.log(message);

  const startPoints = Array.fromRange(nPaths).map(elem => randomPoint());
  const endPoints = Array.fromRange(nPaths).map(elem => randomPoint());

  const types = type === "all" ? Object.keys(Pathfinder.ALGORITHMS) : type;
  for ( const type of types ) await QBenchmarkLoopFn(nIterations, benchPointSet, type, pf, type, startPoints, endPoints);
}

function benchPointSet(pf, type, startPoints, endPoints) {
  const nPoints = startPoints.length;
  for ( let i = 0; i < nPoints; i += 1 ) {
    pf.runPath(startPoints[i], endPoints[i], "breadth");
  }
}


