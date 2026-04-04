/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { PriorityQueue } from "./PriorityQueue.js";
import { IdleTaskRunner } from "../IdleTaskRunner.js";

/* Basic pathfinding algorithms.

Abstract
- getNeighbors
  - adjacentOffsets
  - filterNeighbors
- cost
- heuristic
- buildNode
- initialize
- closestNode
*/

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function sleepSync(ms) {
    const start = Date.now();
    while (Date.now() < start + ms) {
        // Do nothing, just wait
    }
}

/**
 * Basic frontier that simply uses an array.
 * Mimics PriorityQueue so that can be used as a frontier.
 */
class Frontier extends Array {
  // Priority is ignored in base version.
  enqueue(value, _priority) { return this.push(value); }

  dequeue() { return this.shift(); }

  clear() { this.length = 0; }
}


class AbstractGraph {

  /** @type {AbstractPathfindingWorld} */
  world;

  /** @type {boolean} */
  debug = false;

  /** @type {number} */
  debugDelay = 0;

  constructor(world) { this.world = world; }

  static newFrontier() { return new Frontier(); }

  /**
   * @typedef GraphRunState
   * @prop {Node} start
   * @prop {Node} goal
   * @prop {Frontier} frontier
   * @prop {Map<Node.key, Node|null>} cameFrom
   * @prop {Set<Node.key>} closedSet
   * @prop {number} iter
   */

  /**
   * Generate a fresh state for each pathfinding run.
   * Child classes may override this to inject PriorityQueues or track costs.
   * @param {Node} start
   * @param {Node} goal
   * @returns {GraphRunState}
   */
  createRunState(start, goal) {
    const frontier = this.constructor.newFrontier();
    frontier.enqueue(start, 0);

    const cameFrom = new Map();
    cameFrom.set(start.key, null);

    return {
      start,
      goal,
      frontier,
      cameFrom,
      closedSet: new Set(),
      iter: 0,
    };
  }

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} start       Start point for the graph
   * @param {Point} goal        End point for the graph
   * @param {AbortSignal} [signal]
   * @returns {GridCoordinates3d[]|null}
   */
  async findPath(start, goal, signal = {}) {
    const state = this._startRun(start, goal);
    if ( !state ) return null;
    if ( signal.aborted ) {
      if ( this.debug )  console.debug(`${this.constructor.name}|Pathfinding run aborted.`);
      return null;
    }

    // const t0 = performance.now();
    const reachedGoal = await this.doRun(state, signal);
    // console.debug(`findPath|${Math.round(performance.now() - t0)} ms`)

    if ( signal.aborted ) {
      if ( this.debug )  console.debug(`${this.constructor.name}|Pathfinding run aborted.`);
      return null;
    }
    if ( !reachedGoal ) {
      if ( this.debug ) console.debug(`${start} -> ${goal}: No path after examining ${state.closedSet.size} nodes over ${state.iter} iterations.`);
      return null;
    }

    return this._endRun(start, goal, state);
  }


  /**
   * Being a pathfinding run.
   * @param {Point} start       Start point for the graph
   * @param {Point} goal        End point for the graph
   * @returns {GraphState|null} Null if no path; state otherwise.
   */
  _startRun(start, goal) {
    const startNode = this.world.buildNode(start);
    const goalNode = this.world.buildNode(goal);
    if ( this.world.nodeIsUnreachable(goalNode, startNode) ) {
      console.warn(`${this.constructor.name}|Node unreachable.`, { startNode, goalNode });
      return null;
    }

    // Initialize the isolated run state.
    const state = this.createRunState(startNode, goalNode);
    if ( this.debug ) {
      this.lastState = state;
      Draw.star(start);
      Draw.point(goal, { color: Draw.COLORS.green });
    }
    return state;
  }

  /**
   * Core algorithm logic.
   * @param {GraphState} state       Current graph state
   * @param {AbortSignal} signal
   * @returns {GridCoordinates3d[]|null}
   */
  async doRun(state, signal) {
    const iter = this._doRun(state);

    // Try one iteration to see if it is easily solved before moving to idle task .
    const result = iter.next();
    if ( result.done ) return result.value;

    /*
    let result = iter.next();
    while ( !result.done ) {
      if ( signal.aborted ) return null;
      result = iter.next();
    }
    return result.value;
    */

    return Boolean(this.world.constructor.idleYield)
      ? IdleTaskRunner.runIdle(iter, signal)
      : IdleTaskRunner.runPriority(iter, signal);
  }

  *_doRun(state) {
    const yieldIter = this.world.constructor.idleYield;
    let MAX_ITER = this.world.constructor.maxIterations(state.start, state.goal) || 1e03;
    while ( state.iter < MAX_ITER ) {
      state.iter += 1;
      if ( !state.frontier.length ) return false;
      const reachedGoal = this._processNextFrontier(state);
      if ( reachedGoal ) return true;

      // Yield every X iterations to allow the runner to check time/abort.
      if ( (state.iter % yieldIter) === 0 ) yield;
    }
    console.warn(`${this.constructor.name}|findPath stuck in loop.`, state);
    return false;
  }

  _endRun(start, goal, state) {
    const path = this.constructor.reconstructPath(state);
    if ( this.debug ) console.debug(`${start} -> ${goal}: Found length ${path?.length} path by examining ${state.closedSet.size} nodes over ${state.iter} iterations.`);

    if ( !path.at(0).almostEqual(start) ) path.unshift(start); // World must handle checks between start and startNode.
    if ( !path.at(-1).almostEqual(goal) ) path.push(goal);  // World must handle checks between goal and goalNode.
    return path;
  }

  _processNextFrontier(state) {
    const current = state.frontier.dequeue();
    state.closedSet.add(current.key);
    if ( this.debug ) {
      if ( this.debugDelay ) sleepSync(this.debugDelay);
      this.world.drawNode(current, { color: Draw.COLORS.blue, alpha: 0.2, radius: 3 });
    }

    if ( this.world.reachedGoal(current, state.goal) ) {
      if ( !state.cameFrom.has(state.goal.key) ) state.cameFrom.set(state.goal.key, current); // CWSweep, for example, does not use current.key === goalNode.key.
      return true;
    }

    for ( const n of this.world.getNeighbors(current) ) this.processFrontierNeighbor(current, n, state);
    return false;
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   * The child class should set the frontier and cameFrom map accoridngly.
   * @param {Node} current          The current position
   * @param {Node} next             The neighbor to consider
   * @param {Object} state          Running state, from createRunState
   */
  processFrontierNeighbor(_current, _next, _state) { throw new Error("_processFrontierNeighbor must be defined by child class."); }

  /**
   * For a given goal, reconstruct the path to the beginning.
   * @param {Map<number, GridCoordinate|null>} cameFrom
   * @param {GridCoordinate} goal
   * @returns {GridCoordinate[]}
   */
  static reconstructPath(state) {
    let current = state.goal;
    const path = [];
    while ( current !== null ) {
      path.push(current); // Push + reverse likely faster then unshift.
      current = state.cameFrom.get(current.key);
    }
    return path.reverse();
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(state, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    opts.fill ??= Draw.COLORS.blue;
    opts.fillAlpha ??= 0.10;
    opts.alpha ??= 0;
    for ( const node of state.cameFrom.values() ) {
      if ( !node ) continue;
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}

export class TestGraph extends AbstractGraph {
  async findPath(startPoint, endPoint, signal = {}) {
    const id = foundry.utils.randomID();
    console.debug(`TestPathfinder ${id}|starting.`);
    let iter = 0;
    while ( iter < 100 ) {
      if ( signal.aborted ) {
        console.debug(`\tTestPathfinder ${id}|stopped at iteration ${iter}.`);
        return null;
      }
      await sleep(100);
      iter += 1;
      console.debug(`\tTestPathfinder ${id}|iteration ${iter}.`);
    }
    console.debug(`\tTestPathfinder ${id}|Reached iteration ${iter}.`);
    return canvas.grid.getDirectPath([startPoint, endPoint]);
  }
}

/**
 * BFS explores neighbors layer by layer.
 * It is optimal for unweighted graphs (where every step costs exactly 1).
 */
export class BFSGraph extends AbstractGraph {

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   * @param {Node} current          The current position
   * @param {Node} next             The neighbor to consider
   * @param {Object} state          Running state, from createRunState
   */
  processFrontierNeighbor(current, next, state) {
    if ( state.closedSet.has(next.key) ) return;
    if ( !state.cameFrom.has(next.key) ) {
      state.frontier.enqueue(next);
      state.cameFrom.set(next.key, current);
    }
  }
}

/**
 * UCS is essentially Dijkstra’s Algorithm.
 * It expands the node with the lowest cumulative cost g(n) from the start.
 */
export class UniformCostGraph extends BFSGraph {

  static newFrontier() { return new PriorityQueue("low"); }

  /**
   * Generate a fresh state for each pathfinding run.
   * @param {Node} start
   * @returns {Object}
   */
  createRunState(start, goal) {
    const state = super.createRunState(start, goal);
    state.costSoFar = new Map();
    state.costSoFar.set(start.key, 0);
    return state;
  }

  /**
   * Prioritize the neighbor based on cost and add to the
   * @param {Node} current          The current position
   * @param {Node} next             The neighbor to consider
   * @param {Object} state          Running state, from createRunState
   */
  processFrontierNeighbor(current, next, state) {
    if ( state.closedSet.has(next.key) ) return;
    const costSoFar = state.costSoFar;
    const newCost = costSoFar.get(current.key) + this.world.cost(current, next, this.token);
    if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
      costSoFar.set(next.key, newCost);
      state.frontier.enqueue(next, newCost);
      state.cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(state, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    const costMinMax = Math.minMax(...state.costSoFar.values());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    for ( const node of state.cameFrom.values() ) {
      if ( !node ) continue;
      const nodeCost = state.costSoFar.get(node.key);
      opts.fillAlpha = (nodeCost - costMinMax.min) / (costMinMax.max - costMinMax.min);
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}

/**
 * This algorithm uses a heuristic $h(n)$ to estimate the distance to the goal.
 * It is fast but not guaranteed to find the shortest path because it ignores the cost already traveled.
 */
export class GreedyBestFirstGraph extends BFSGraph {

  static newFrontier() { return new PriorityQueue("low"); }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   * @param {Node} current          The current position
   * @param {Node} next             The neighbor to consider
   * @param {Object} state          Running state, from createRunState
   */
  processFrontierNeighbor(current, next, state) {
    if ( state.closedSet.has(next.key) ) return;
    if ( !state.cameFrom.has(next.key) ) {
      const priority = this.world.heuristic(next, state.goal);
      state.frontier.enqueue(next, priority);
      state.cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(state, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    const nodesSeen = new Set();
    const costMax = this.world.heuristic(state.start, state.goal);
    for ( const node of state.cameFrom.values() ) {
      if ( !node || nodesSeen.has(node.key) ) continue;
      nodesSeen.add(node.key);
      const nodeCost = this.world.heuristic(node, state.goal);
      opts.fillAlpha = nodeCost / costMax;
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}

/**
 * A* combines the strengths of UCS and Greedy search.
 * It uses f(n) = g(n) + h(n) to stay efficient while guaranteeing the shortest path
 * (provided the heuristic is admissible).
 */
export class AStarGraph extends UniformCostGraph {
  /**
   * Apply a given algorithm to process neighbors along the frontier.
   * @param {Node} current          The current position
   * @param {Node} next             The neighbor to consider
   * @param {Object} state          Running state, from createRunState
   */
  processFrontierNeighbor(current, next, state) {
    if ( state.closedSet.has(next.key) ) return;
    const costSoFar = state.costSoFar;
    const newCost = costSoFar.get(current.key) + this.world.cost(current, next, this.token);
    if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
      costSoFar.set(next.key, newCost);
      state.cameFrom.set(next.key, current);

      // Priority = g(n) + h(n).
      const priority = newCost + this.world.heuristic(next, state.goal);
      state.frontier.enqueue(next, priority);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(state, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    const costMinMax = Math.minMax(...state.costSoFar.values());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    const nodesSeen = new Set();
    for ( const node of state.cameFrom.values() ) {
      if ( !node || nodesSeen.has(node) ) continue;
      nodesSeen.add(node);
      const nodeCost = state.costSoFar.get(node.key) + this.world.heuristic(node, state.goal);
      opts.fillAlpha = (nodeCost - costMinMax.min) / (costMinMax.max - costMinMax.min);
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}


/* Testing
MODULE_ID = "elevationruler"
Draw = CONFIG.GeometryLib.lib.Draw;
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
GridCoordinates = CONFIG.GeometryLib.lib.GridCoordinates
api = game.modules.get("elevationruler").api
let { ClockwiseSweepPathfinder, GriddedCollisionPathfinder, WebGPUPathfinder, worldBuilderGriddedCollision, ClockwiseSweepPathfindingNode } = api.pathfinding;
let { solveSegment,
      pathIsValid,
      optimizeGridPath,
      dropIntermediatePoints,
      snapPathToGrid,
      straightenPath,
      removeDuplicatePoints,
      snapPathToGrid2,
} = api.pathCleaning
benchTokenPath = api.pathfinding.benchTokenPath
testPathfinding = api.pathfinding.testPathfinding

await WebGPUPathfinder.initialize();


let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")
let beiro = canvas.tokens.placeables.find(t => t.name === "Beiro")
let riswynn = canvas.tokens.placeables.find(t => t.name === "Riswynn")
let akra = canvas.tokens.placeables.find(t => t.name === "Akra")
let perrin = canvas.tokens.placeables.find(t => t.name === "Perrin")

// collision, webGPU, clockwiseSweep
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v"  // |"v"|"edge"
algorithm = "clockwiseSweep"
graphPathfinding = {
  cost: "terrain",      // "manhattan"|"euclidean"|"foundry"|"terrain"
  heuristic: "terrain", //"manhattan"|"euclidean"|"foundry"|"terrain"
  neighborFilter: "occlusion" // "clockwiseSweep"|"occlusion"|"sceneGraph"
}
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })


// Test all

console.log("\n\n-----Collision: Occlusion -----")
algorithm = "collision"
graphPathfinding.neighborFilter = "occlusion"
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })

console.log("\n\n-----Collision: CWSweep -----")
algorithm = "collision"
graphPathfinding.neighborFilter = "occlusion"
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })

console.log("\n\n-----Collision: Scene Graph -----")
algorithm = "collision"
graphPathfinding.neighborFilter = "occlusion"
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })

console.log("\n\n-----Clockwise Sweep: 'V' -----")
algorithm = "clockwiseSweep"
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v"
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })

console.log("\n\n-----Clockwise Sweep: 'Edge' -----")
algorithm = "clockwiseSweep"
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "edge"
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })

console.log("\n\n-----WebGPU -----")
algorithm = "webGPU"
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })

 **
 * Uses bresenham to draw pixels under each wall in the scene.
 * @param {Wall[]} [walls]      Walls to approximate
 * @returns {Set<key>} Unique pixels, coded by point key.
 *
function uniquePixelsForCanvasWalls(walls) {
  const blIterator = CONFIG.GeometryLib.lib.utils.bresenhamLineIterator;
  const coveredPixels = new Set();
  walls ??= canvas.walls.placeables;
  walls.forEach(wall => {
    const edge = wall.edge;
    for ( const pt of blIterator(edge.a, edge.b) ) {
      coveredPixels.add(pt.key);
      pt.release();
    }
  });
  return coveredPixels;
}
coveredPixels = uniquePixelsForCanvasWalls()
coveredPixels.forEach(key => Draw.point(PIXI.Point.invertKey(key), { radius: 1 }))

canvas.walls.placeables.forEach(wall => {
  const edge = wall.edge;
  const points = CONFIG.GeometryLib.lib.utils.bresenhamLine(edge.a.x, edge.a.y, edge.b.x, edge.b.y);
  const pt = PIXI.Point.tmp.set()
  for ( let i = 0; i < points.length; i += 2 ) {
    pt.set(points[i], points[i+1]);
    Draw.point(pt, { radius: 1 })
  }
  pt.release();
});

canvas.walls.placeables.forEach(wall => {
  const edge = wall.edge;
  const iter = CONFIG.GeometryLib.lib.utils.bresenhamLineIterator(edge.a, edge.b);
  for ( const pt of iter ) {
    Draw.point(pt, { radius: 1 });
    pt.release();
  }
});



percentArea = uniquePixelsForCanvasWalls().size / canvas.scene.dimensions.sceneRect.area

// Need to account for resolution. Because the walls are stuck at 1 pixel,
// they shrink by res, not res^2.
// Original coverage: length * 1 pixel / (W * H)
// New coverage: length * res * 1 / (W * res) * (H * res) = length / (W * H * res)
// Cnew ~= C orig / res

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)
pf = new ClockwiseSweepPathfinder(randal)

res = pf.constructor.worker.resolution
uniquePixelsForCanvasWalls().size * res

percentArea / res

console.log(`
\tScene width: \t${canvas.scene.dimensions.sceneWidth} \theight: \t${canvas.scene.dimensions.sceneHeight}
\tGrid width: \t${pf.constructor.worker.gridDims.x} \theight: \t${pf.constructor.worker.gridDims.y}
\tResolution: \t${pf.constructor.worker.resolution}
\tWall pixels: \t${uniquePixelsForCanvasWalls().size}
\tStart Coords:
\t\tRandal: \t${randal.center.x - canvas.scene.dimensions.sceneX},${randal.center.y - canvas.scene.dimensions.sceneX}
\t\Beiro: \t${beiro.center.x - canvas.scene.dimensions.sceneX},${beiro.center.y - canvas.scene.dimensions.sceneX}
\t\Akra: \t${akra.center.x - canvas.scene.dimensions.sceneX},${akra.center.y - canvas.scene.dimensions.sceneX}
`)










start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)
pf = new ClockwiseSweepPathfinder(randal)


start = GridCoordinates3d.fromObject(beiro.center)
end = GridCoordinates3d.fromObject(riswynn.center)
pf = new ClockwiseSweepPathfinder(beiro)

start = GridCoordinates3d.fromObject(akra.center)
end = GridCoordinates3d.fromObject(perrin.center)
pf = new ClockwiseSweepPathfinder(akra)

midE = (pf.token.topE - pf.token.bottomE) * 0.5;
start.elevation += midE;
end.elevation += midE;

pf.debug = true
pf.debugDelay = 50;

await pf.startPathfinding(start);
path = await pf._findPath(start, end)
pf.constructor.drawPath(path)
pf.validatePath(path, start, end)

res = await snapPathToGrid(path, pf.token)
pf.constructor.drawPath(res.gridPath)

path = path.map(pt => GridCoordinates3d.fromObject(pt));
res.pf.debug = true
res.pf.debugDelay = 100
await res.pf.findPath(path[0], path.at(-1))

// Clockwise sweep
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v"
await pf.startPathfinding(start);
pf.world._cornerMap.keys().forEach(key => Draw.point(PIXI.Point.invertKey(key)))
pf.world._cornerMap.values().forEach(v => {
  v.offsetCornerKeys.forEach(key => Draw.point(PIXI.Point.invertKey(key), { color: Draw.COLORS.blue, radius: 1 }))
})
pf.world._terrainPointKeys.forEach(key => Draw.point(PIXI.Point.invertKey(key), { color: Draw.COLORS.green }));

pf.world.existingNodes.values().forEach(node => Draw.point(node, { color: Draw.COLORS.green, radius: 2 }))



CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v" // gap|v|edge
node = ClockwiseSweepPathfindingNode.create(start)
ClockwiseSweepPathfindingNode.CORNER_OFFSET = 20

Draw.star(node)
Draw.shape(node.sweep, { fill: Draw.COLORS.blue, fillAlpha: 0.3 })
neighborKeys = node.getNeighbors(pf.world._cornerMap, pf.world._terrainPointGrid)

neighborNodes = pf.world.adjacentOffsets(node)
for ( let i = 0; i < neighborNodes.length; i += 1 ) {
   const node = neighborNodes[i]
   Draw.point(node, { radius: 1 })
   Draw.shape(node.sweep, { fill: Draw.COLORS.green, fillAlpha: 0.3 })

}


})

corners = offsetGapCorners(node.sweep, 20)
corners.forEach(key => Draw.point(PIXI.Point.invertKey(key)))

await benchTokenPath(randal, zanna.center, { N: 3 });
await benchTokenPath(beiro, riswynn.center, { N: 3 });
await benchTokenPath(akra, perrin.center, { N: 3 });

// Benchmark collision testing
QBenchmarkLoopFn = CONFIG.GeometryLib.lib.bench.QBenchmarkLoopFn
N = 1000

CONFIG.elevationruler.graphPathfinding.neighborFilter = "occlusion"
await pf.startPathfinding(start);
pf.world.testCollision(start, end, pf.token);
await QBenchmarkLoopFn(N, pf.world.testCollision.bind(pf.world), "occlusion", start, end, pf.token)

CONFIG.elevationruler.graphPathfinding.neighborFilter = "sceneGraph"
await pf.startPathfinding(start);
pf.world.testCollision(start, end, pf.token);
await QBenchmarkLoopFn(N, pf.world.testCollision.bind(pf.world), "sceneGraph", start, end, pf.token)

CONFIG.elevationruler.graphPathfinding.neighborFilter = "clockwiseSweep"
await pf.startPathfinding(start);
pf.world.testCollision(start, end, pf.token);
pf.world.testCollision2(start, end, pf.token);
await QBenchmarkLoopFn(N, pf.world.testCollision.bind(pf.world), "clockwiseSweep", start, end, pf.token)
await QBenchmarkLoopFn(N, pf.world.testCollision2.bind(pf.world), "foundry sweep", start, end, pf.token)



CONFIG.elevationruler.graphPathfinding.neighborFilter = "occlusion"
CONFIG.elevationruler.graphPathfinding.neighborFilter = "sceneGraph"
CONFIG.elevationruler.graphPathfinding.neighborFilter = "clockwiseSweep"

console.time("Pathfinding setup")
await pf.startPathfinding(start);
console.timeEnd("Pathfinding setup")
console.time("Pathfinding")
path = await pf._findPath(start, end) // Skip caching
console.timeEnd("Pathfinding")
pf.constructor.drawPath(path)
pf.validatePath(path, start, end)

// Straightened path for collision
gridPath = dropIntermediatePoints(path)
gridPath = straightenPath(gridPath, pf.token);
pf.validatePath(gridPath, start, end)
pf.constructor.drawPath(gridPath)

// Gridded path for collision
gridPath = dropIntermediatePoints(path)
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Straightened path for clockwise is just clockwise path.
// Gridded path for clockwise
gridPath = await snapPathToGrid(path, pf.token);
gridPath = optimizeGridPath(gridPath, pf.token) ;
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Straightened path for webgpu
gridPath = dropIntermediatePoints(path)
gridPath = straightenPath(gridPath, pf.token);
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Gridded path for webgpu
gridPath = dropIntermediatePoints(path)
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Gridded path for webgpu, change resolution
await WebGPUPathfinder.initialize(2 / canvas.dimensions.size);

// Confirm WebGPU distance map
PixelCache = CONFIG.GeometryLib.lib.PixelCache
await pf.startPathfinding(start);
path = await pf._findPath(start, end)
worker = pf.constructor.worker

bufferData = await worker.extractBufferData({ bufferType: "static" })
bufferData = await worker.extractBufferData({ bufferType: "subject" })
bufferData = await worker.extractBufferData({ bufferType: "transient" })
bufferData = await worker.extractBufferData({ bufferType: "combined" })
bufferData = await worker.extractBufferData({ bufferType: "distance" })

uniqueValues = CONFIG.GeometryLib.lib.utils.sortedUnique(bufferData.buffer).reverse()


heatMap = PixelCache.createHeatMap(2, 254);
colorFn = value => {
  switch ( value ) {
    case 1: return Draw.COLORS.white;
    case 255: return Draw.COLORS.red;
    default: return heatMap(value);
  }
}
alphaFn = value => value === 255 ? 1 : 1 ? 0.1 : 0.5

maxBufferValue = uniqueValues[1]; // Second-largest.
wallValue = uniqueValues[0]
heatMap = PixelCache.createHeatMap(2, maxBufferValue);
colorFn = value => {
  switch ( value ) {
    case 1: return Draw.COLORS.white;
    case wallValue: return Draw.COLORS.red;
    default: return heatMap(value);
  }
}
alphaFn = value => value === 255 ? 1 : 1 ? 1 : 1

cache = PixelCache.fromPixelArray(bufferData.buffer, bufferData.width, { resolution: worker.resolution })
cache.translation = worker.sceneTranslation
cache.draw({ maximumPixelValue: 255, local: false, skip: 0, radius: 5, colorFn, alphaFn })


gridPath = dropIntermediatePoints(path)
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

gridPath = await snapPathToGrid(path, pf.token)
pf.constructor.drawPath(gridPath, { color: Draw.COLORS.lightgreen, alpha: 0.5 })
pf.constructor.drawPath(gridPath, { color: Draw.COLORS.green })

gridPath.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.yellow }))

ObstacleSweep = api.pathfinding.ObstacleSweep
geom = ogre.GeometryLib.geometry
dir = end.subtract(start)
ix = start.projectToward(end, geom.rayIntersection(start, dir))
ixNode = pf.world.buildNode(ix)
Draw.star(ixNode)
neighbors = pf.world.getNeighbors(ixNode)

sweep = new ObstacleSweep();
addedEdges = ObstacleSweep.identifyBlockingTokenEdges(pf.token);
addedEdges.forEach(edge => Draw.segment(edge))


token = randal
a = GridCoordinates3d.fromObject(path[0]);
b = GridCoordinates3d.fromObject(path[1]);



gridPath = await snapPathToGrid(path, randal)
gridPath.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.yellow }))


gridPath0 = snapSegmentToGrid(path[0], path[1], randal)
gridPath1 = snapSegmentToGrid(path[1], path[2], randal)
gridPath2 = snapSegmentToGrid(path[2], path[3], randal)

gridPath0.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.yellow }))
gridPath1.forEach(pt => Draw.point(pt, { radius: 2, color: Draw.COLORS.orange }))
gridPath2.forEach(pt => Draw.point(pt, { radius: 3, color: Draw.COLORS.red }))


// Simple world to get a gridded pathfind.
pf = new GriddedCollisionPathfinder(randal)


let cost = "foundry"; // Would account for terrain.
let heuristic;
switch ( canvas.grid.diagonals ) {
  case CONST.GRID_DIAGONALS.ILLEGAL:
  case CONST.GRID_DIAGONALS.EQUIDISTANT: heuristic = "manhattan"; break;

  case CONST.GRID_DIAGONALS.EXACT: heuristic = "euclidean"; break;
  case CONST.GRID_DIAGONALS.APPROXIMATE: heuristic = "euclidean"; break;

  default: heuristic = "foundry"; break;
}

worldClass = worldBuilderGriddedCollision({ cost, heuristic, use3d: false, pt3d: true, neighborFilter: "sceneGraph" })
pf.world = new worldClass()


pf.startPathfinding(path[0])
gridPath0 = await pf._findPath(path[0], path[1])

pf.startPathfinding(path[1])
gridPath1 = await pf.findPath(path[1], path[2])

pf.startPathfinding(path[2])
gridPath2 = await pf.findPath(path[2], path[3])


nodes = [...pf.world.existingNodes.values()]
colors = Object.values(Draw.COLORS)
i = 0
Draw.point(nodes[i], { color: colors[i], radius: 3 })
nodes[i].drawShape({ fill: colors[i], width: 0 })
nodes[i].drawGapEdges({ color: colors[i] })
nodes[i].drawGapPoints({ color: colors[i], alpha: 0.5 })


nodes.forEach(node => Draw.point(node))

Pathfinder VKC3FgTw46ki8yHD|{x: 2650, y: 2550, z: 0} --> {x: 1950, y: 2650, z: 0} path has collision at 3:
	{x: 2650, y: 2550, z: 0}
	{x: 2177.885437667892, y: 3042.2040753400374, z: 0}
	{x: 2170.4, y: 3040.2, z: 0}
	{x: 2004.0249223594997, y: 2696.8695048315003, z: 0}
	{x: 1950, y: 2650, z: 0}


AbstractPathfinder.js:111 Pathfinder V4s4gx9T3tSXwgzv|{x: 2150, y: 3050, z: 0} --> {x: 1750, y: 2650, z: 0} path has collision at 4:
	{x: 2150, y: 3050, z: 0}
	{x: 2183, y: 2824, z: 0}
	{x: 1888, y: 2915, z: 0}
	{x: 1710, y: 2920, z: 0}
	{x: 1749, y: 2976, z: 0}
	{x: 1560, y: 2700, z: 0}
	{x: 1750, y: 2650, z: 0}

AbstractPathfinder.js:111 Pathfinder NKZT67jDDiyacusU|{x: 1750, y: 2550, z: 0} --> {x: 1850, y: 2550, z: 0} path has collision at 3:
	{x: 1750, y: 2550, z: 0}
	{x: 1590, y: 2498, z: 0}
	{x: 1600, y: 2290, z: 0}
	{x: 1810, y: 2300, z: 0}
	{x: 1850, y: 2550, z: 0}

AbstractPathfinder.js:137 ClockwiseSweepPathfinder UDY8OEpN0gXbyYqb|Cleaned|{x: 1750, y: 2750, z: 0} --> {x: 2650, y: 2550, z: 0} path has collision at 9:
	{x: 1750, y: 2750, z: 0}
	{x: 1950, y: 2750, z: 0}
	{x: 2050, y: 2750, z: 0}
	{x: 2050, y: 2550, z: 0}
	{x: 2050, y: 2350, z: 0}
	{x: 2250, y: 2350, z: 0}
	{x: 2250, y: 2350, z: 0}
	{x: 2350, y: 2450, z: 0}
	{x: 2450, y: 2450, z: 0}
	{x: 2550, y: 2550, z: 0}
	{x: 2650, y: 2550, z: 0}


pf.world = new (worldBuilder())()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)


// Test with terrain cost
pf.world = new (worldBuilder({ cost: "terrain" }))()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)

// Change to occlusion
pf.world = new (worldBuilder({ neighborFilter: "occlusion" }))()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)

// Occlusion + cost
pf.world = new (worldBuilder({ neighborFilter: "occlusion", cost: "terrain" }))()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)

// Test with token dragging
CONFIG.elevationruler.graphPathfinding.cost = "terrain"
CONFIG.elevationruler.graphPathfinding.neighborFilter = "occlusion"


geom = randal.GeometryLib.geometry
geom.rayIntersection(start, end.subtract(start))

waypoints = randal.createTerrainMovementPath([start, end])
randal.measureMovementPath(waypoints)
// end.y += 25


pathfindingCfg = CONFIG.elevationruler.graphPathfinding;

pf = new BFSPathfinder(randal)
pf = new UniformCostPathfinder(randal)
pf = new GreedyBestFirstPathfinder(randal)
pf = new AStarPathfinder(randal)

path = await pf.findPath(start, end)
pf.drawDebug()
AStarPathfinder.drawPath(path)

end = GridCoordinates.fromObject(zanna.center)
end.y += 25
path = pf.findPath(start, end)
setTimeout(() => {
  console.log("--- Cancel button clicked! ---");
  pf.stop = true
}, 1);


path = pf.findPath(start, end)
pf.stop = true;


// Test

class TestClass {
  isRunning = false;

  progress = 0;

  async longRunningProcess() {
    this.isRunning = true;
    this.progress = 0;

    console.log("Starting loop...");

    while (this.isRunning) {
      // 1. Perform an async task
      console.log(`Processing step ${this.progress}...`);
      // await new Promise(resolve => setTimeout(resolve, 1000));
      await this.subprocess();

      // 2. IMMEDIATE CHECK
      // If the flag was flipped during the 'await' above, exit now.
      if (!this.isRunning) {
        break;
      }

      // 3. Update internal logic
      this.progress++;

      if (this.progress >= 10) {
        console.log("Task finished naturally.");
        break;
      }
    }

    console.log("Loop has exited. Cleaning up resources...");
    this.isRunning = false;
  }

//   async subprocess() {
//     console.log("...running subprocess");
//     await new Promise(resolve => setTimeout(resolve, 1000));
//     console.log("...finished subprocess");
//   }

  async subprocess() {
    return new Promise(resolve => {
      pf.findPath
    })

    const path = await pf.findPath(start, end)
  }
}

// Start the process
test = new TestClass()

test.longRunningProcess();

// Simulate a user clicking "Cancel" after 3.5 seconds
setTimeout(() => {
  console.log("--- Cancel button clicked! ---");
  test.isRunning = false;
}, 3500);


let isCancelled = false;

// A generic async function that might be doing
// file I/O, heavy calculation, or database work
async function processChunk(id) {
  // Simulating any async work
  let a = 1;
  for ( let i = 0; i < 1000000; i += 1 ) a *= i;
//   return new Promise(resolve => {
//     console.log(`Working on ID: ${id}`);
//     resolve(`Result ${id}`);
//   });
}

async function runHeavyTask() {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  for (const item of items) {
    // 1. Check BEFORE starting the next task
    if (isCancelled) {
      console.log("Cancelled before.")
      break;
    }

    // 2. The generic async call
    const result = await processChunk(item);

    // 3. Check AFTER the task finishes
    if (isCancelled) {
      console.log("Stopping after task finished.");
      return;
    }

    console.log("Processed:", result);
  }

}

// Start the loop
runHeavyTask();

// Later, an external event cancels it
isCancelled = true;

*/
