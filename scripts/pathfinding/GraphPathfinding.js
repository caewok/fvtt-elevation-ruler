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
import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { PriorityQueue } from "./PriorityQueue.js";
import { Settings } from "../settings.js";

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


// Each pathfinding should create a new GraphPathfinder, so properties are not mixed up
// between async jobs.
export class GraphingPathfinder extends AbstractPathfinder {
  /** @type {AbstractGraph} */
  lastGraph; // For debugging.

  world = null;

  static get worldClass() { return Settings.pathfindingWorldClass; }

  graphClass = AStarGraph;

  startPathfinding(start) {
    super.startPathfinding(start);

    // Set up world
    this.world = new this.constructor.worldClass;
    this.world.initialize(this.token);
    this.world.startPathfinding(start);

    // Determine the graph class to use.
    let graphCl;
    switch ( CONFIG[MODULE_ID].simplePathfinding.algorithm ) {
      case "astar": graphCl = AStarGraph; break;
      case "breadth": graphCl = BFSGraph; break;
      case "uniform": graphCl = UniformCostGraph; break;
      case "greedy": graphCl = GreedyBestFirstGraph; break;
      case "test": graphCl = TestGraph; break;
      default: graphCl = AStarGraph;
    }
    this.graphClass = graphCl;
  }

  async _findPath(start, goal, signal) {
    const graph = this.lastGraph = new this.graphClass(this.world);
    graph.debug = this.debug;
    graph.debugDelay = this.debugDelay;
    return graph.findPath(start, goal, signal);
  }
}

/**
 * Settings specific to the algorithm used with the graph to define nodes.
 * This is ostensibly stateless. Only saved values should be objects that can be
 * cached over multiple find paths for a single start point (e.g., single token drag).
 */
export class GraphPathfindingWorld {

  /** @type {object} */
  config = {};

  /**
   * @typedef {GridCoordinates|GridCoordinates3d} Node
   */

  /**
   * Cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  cost() { return 0; }

  /**
   * Estimated cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  heuristic() { return 0; }

  /**
   * From a location on the canvas, construct the corresponding node.
   * @param {Point|Point3d} pt
   * @returns {Node}
   */
  buildNode(pt) { return pt; }

  /**
   * Initialize this world for a given path construction.
   * @param {Token} token     Token doing the movement
   */
  initialize(_token) { }

  /**
   * Filter the neighbors for this node, keeping only valid neighbors.
   * @param {Node[]} neighbors    Neighbors to the originating node
   * @param {Node} node           The originating node
   * @returns {Node[]}
   */
  filterNeighbors(neighbors, _node) { return neighbors; }

  /**
   * Determine adjacent offsets to a node.
   * @param {Node} node
   * @returns {Node[]}
   */
  adjacentOffsets(node) { return canvas.grid.getAdjacentOffsets(node); }

  /**
   * Get valid adjacent neighbors to a node.
   * @param {Node} node
   * @returns {Node[]}
   */
  getNeighbors(node) {
    const neighbors = this.adjacentOffsets(node);
    return this.filterNeighbors(neighbors, node);
  }

  /**
   * Check if a node is definitely unreachable. For example, within a blocking token.
   * @param {Node} node
   * @param {Node} start
   * @returns {boolean}
   */
  nodeIsUnreachable(node, _start) {
    if ( !canvas.scene.dimensions.sceneRect.contains(node.x, node.y) ) return true;
    if ( CONFIG[MODULE_ID].sceneGraph.pointIsInFace(node) ) return true;
    return false;
  }

  startPathfinding(_start, _goal) { }

  /**
   * Did we reach the goal node?
   * @param {Node} curr
   * @param {Node} goal
   */
  reachedGoal(curr, goal) { return curr.key === goal.key; }

  /**
   * Maximum number of iterations given a start and end coordinate.
   * Used to stop if no path.
   * @param {Node} start
   * @param {Node} goal
   * @returns {number}
   */
  maxIterations(start, _goal) {
    // Number of steps from start to the edge of the scene.
    // For a grid, 1 step is one grid square.
    const { sceneRect, size } = canvas.scene.dimensions;
    if ( canvas.grid.isGridless ) {
      const maxDist = Math.max(
        sceneRect.width - start.x,
        start.x - sceneRect.x,
        sceneRect.height - start.y,
        start.y - sceneRect.y,
      );
      return Math.ceil(maxDist / (this.resolution || 1)); // TODO: Resolution for gridless.

    } else {
      const maxDist = Math.max(
        sceneRect.width - start.x,
        start.x - sceneRect.x,
        sceneRect.height - start.y,
        start.y - sceneRect.y,
      );
      return Math.ceil(maxDist / size);
    }
  }

  /**
   * Given obstacles in the world, determine what the maximum and minimum z values should be
   * for obstacle avoidance in 3d.
   * @returns {object}
   * - @prop {number} min
   * - @prop {number} max
   */
  static zMaxMin() {
    const token0 = canvas.tokens.placeables[0];
    let min = token0.bottomZ;
    let max = token0.topZ;

    canvas.walls.placeables.forEach(wall => {
      ({ min, max } = Math.minMax(min, max, isFinite(wall.bottomZ)
        ? wall.bottomZ : min, isFinite(wall.topZ) ? wall.topZ : max));
    });
    canvas.tiles.placeables.forEach(tile => {
      ({ min, max } = Math.minMax(min, max, tile.elevationZ));
    });
    canvas.regions.placeables.forEach(region => {
      ({ min, max } = Math.minMax(min, max, isFinite(region.bottomZ)
        ? region.bottomZ : min, isFinite(region.topZ) ? region.topZ : max));
    });
    canvas.tokens.placeables.forEach(token => {
      ({ min, max } = Math.minMax(min, max, token.topZ, token.bottomZ));
    });
    return { min, max };
  }

  drawNode(node, opts = {}) { Draw.point(node, opts); }
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

  _cameFrom = new Map();

  _frontier = new Frontier();

  debug = false;

  debugDelay = 0;

  constructor(world) { this.world = world; }

  /**
   * Initialize the pathfinding run.
   */
  _initializePathfindingRun(start) {
    this._initializeFrontier(start);
    this._initializeCameFrom(start);
  }

  /**
   * Clear and initialize the frontier for pathfinding run.
   * Frontier tracks next neighbors to be visited.
   * @param {Point} start
   */
  _initializeFrontier(start) {
    this._frontier.clear();
    this._frontier.enqueue(start, 0); // Priority is ignored in base version.
  }

  /**
   * Clear and initialize the frontier for pathfinding run.
   * The cameFrom map tracks visited nodes.
   * @param {Point} start
   */
  _initializeCameFrom(start) {
    this._cameFrom.clear();
    this._cameFrom.set(start.key, null);
  }

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} start       Start point for the graph
   * @param {Point} goal        End point for the graph
   */
  async findPath(start, goal, _signal = {}) {
    start = this.world.buildNode(start);
    goal = this.world.buildNode(goal);
    if ( this.world.nodeIsUnreachable(goal, start) ) {
      console.error(`${this.constructor.name}|Node unreachable.`, { start, goal });
      return null;
    }

    // Frontier tracks next neighbors to be visited.
    this._initializePathfindingRun(start);

    let iter = 0;
    let MAX_ITER = 1e03; // this.world.maxIterations(start, goal) || 1e03;
    let reachedGoal = false;
    if ( this.debug ) {
      this.world.drawNode(start, { color: Draw.COLORS.yellow });
      this.world.drawNode(goal, { color: Draw.COLORS.green });
    }
    while ( this._frontier.length > 0 && iter < MAX_ITER ) {
      // if ( signal.aborted ) return null;
      iter += 1;
      const current = this._frontier.dequeue();
      if ( this.debug ) {
        if ( this.debugDelay ) await sleep(this.debugDelay);
        this.world.drawNode(current, { color: Draw.COLORS.blue, alpha: 0.2, radius: 3 });
      }
      // console.debug(`${this.constructor.name}|Processing frontier ${current.x},${current.y}`)
      if ( (reachedGoal = this.world.reachedGoal(current, goal)) ) {
        if ( !this._cameFrom.has(goal.key) ) this._cameFrom.set(goal.key, current); // CWSweep, for example, does not use current.key === goal.key.
        break;
      }
      await this._processFrontierNeighbors(current, goal);
    }

    if ( iter >= MAX_ITER ) {
      console.error(`${this.constructor.name}|findPath stuck in loop.`, { start, goal });
    }
    const path = reachedGoal ? this.constructor.reconstructPath(this._cameFrom, goal) : null;
    return path;
  }

  /**
   * Asynchronously process all the neighbors for the current node of the frontier.
   * Async so it can be stopped.
   * @param {Point} current
   */
  async _processFrontierNeighbors(current, goal) {
    const neighbors = this.world.getNeighbors(current);
    const numNeighbors = neighbors.length;
    const promises = Array(numNeighbors);
    for ( let i = 0; i < numNeighbors; i += 1 ) {
      promises.push(this._processFrontierNeighbor(current, neighbors[i], goal));
    }
    return Promise.allSettled(promises);
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  async _processFrontierNeighbor(_current, _next) { console.error("_processFrontierNeighbor must be defined by child class."); }

  /**
   * For a given goal, reconstruct the path to the beginning.
   * @param {Map<number, GridCoordinate|null>} cameFrom
   * @param {GridCoordinate} goal
   * @returns {GridCoordinate[]}
   */
  static reconstructPath(cameFrom, goal) {
    let current = goal;
    const path = [];
    while ( current !== null ) {
      path.push(current); // Push + reverse likely faster then unshift.
      current = cameFrom.get(current.key);
    }
    return path.reverse();
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    opts.fill ??= Draw.COLORS.blue;
    opts.fillAlpha ??= 0.10;
    opts.alpha ??= 0;
    for ( const node of this._cameFrom.values() ) {
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
   */
  async _processFrontierNeighbor(current, next) {
    if ( !this._cameFrom.has(next.key) ) {
      this._frontier.enqueue(next);
      this._cameFrom.set(next.key, current);
    }
  }
}

/**
 * UCS is essentially Dijkstra’s Algorithm.
 * It expands the node with the lowest cumulative cost g(n) from the start.
 */
export class UniformCostGraph extends BFSGraph {

  _costSoFar = new Map();

  _frontier = new PriorityQueue("low");

  /**
   * Initialize the pathfinding run.
   */
  _initializePathfindingRun(start) {
    super._initializePathfindingRun(start);
    this._initializeCostSoFar(start);
  }

  /**
   * Clear and initialize the cost map for pathfinding run.
   * The costSoFar map tracks costs to reach different nodes.
   * @param {Point} start
   */
  _initializeCostSoFar(start) {
    this._costSoFar.clear();
    this._costSoFar.set(start.key, 0);
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  async _processFrontierNeighbor(current, next) {
    const costSoFar = this._costSoFar;
    const newCost = costSoFar.get(current.key) + this.world.cost(current, next, this.token);
    if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
      costSoFar.set(next.key, newCost);
      this._frontier.enqueue(next, newCost);
      this._cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    const costMinMax = Math.minMax(...this._costSoFar.values());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    for ( const node of this._cameFrom.values() ) {
      if ( !node ) continue;
      const nodeCost = this._costSoFar.get(node.key);
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

  _frontier = new PriorityQueue("low");

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  async _processFrontierNeighbor(current, next, goal) {
    if ( !this._cameFrom.has(next.key) ) {
      const priority = this.world.heuristic(next, goal);
      this._frontier.enqueue(next, priority);
      this._cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    const nodesSeen = new Set();
    const costMax = this.world.heuristic(start, goal);
    for ( const node of this._cameFrom.values() ) {
      if ( !node || nodesSeen.has(node.key) ) continue;
      nodesSeen.add(node.key);
      const nodeCost = this.world.heuristic(node, goal);
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
   */
  async _processFrontierNeighbor(current, next, goal) {
    const costSoFar = this._costSoFar;
    const newCost = costSoFar.get(current.key) + this.world.cost(current, next, this.token);
    if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
      costSoFar.set(next.key, newCost);

      // Priority = g(n) + h(n).
      const priority = newCost + this.world.heuristic(next, goal);
      this._frontier.enqueue(next, priority);
      this._cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    const costMinMax = Math.minMax(...this._costSoFar.values());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    const nodesSeen = new Set();
    for ( const node of this._cameFrom.values() ) {
      if ( !node || nodesSeen.has(node) ) continue;
      nodesSeen.add(node);
      const nodeCost = this._costSoFar.get(node.key) + this.world.heuristic(node, goal);
      opts.fillAlpha = (nodeCost - costMinMax.min) / (costMinMax.max - costMinMax.min);
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}

/* Testing
Draw = CONFIG.GeometryLib.lib.Draw;
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
api = game.modules.get("elevationruler").api
let { GraphingPathfinder } = api.pathfinding;

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

pf = new GraphingPathfinder(randal)
start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)

pf.debug = true
pf.debugDelay = 1000;

pf.startPathfinding(start);
path = await pf._findPath(start, end) // Skip caching
pf.constructor.drawPath(path)
Draw.clearDrawings()


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
CONFIG.elevationruler.simplePathfinding.cost = "terrain"
CONFIG.elevationruler.simplePathfinding.neighborFilter = "occlusion"


geom = randal.GeometryLib.geometry
geom.rayIntersection(start, end.subtract(start))

waypoints = randal.createTerrainMovementPath([start, end])
randal.measureMovementPath(waypoints)
// end.y += 25


pathfindingCfg = CONFIG.elevationruler.simplePathfinding;

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
