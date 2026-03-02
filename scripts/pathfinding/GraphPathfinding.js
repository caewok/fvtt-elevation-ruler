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

  #world;

  get world() {
    if ( !this.#world ) this.world = new this.constructor.worldClass();
    return this.#world;
  }

  set world(value) {
    this.#world = value;
    this.#world.initialize(this.token);
  }

  static get worldClass() { return Settings.pathfindingWorldClass; }

  #graphClass;

  get graphClass() {
    if ( this.#graphClass ) return this.#graphClass;

    // If none set, go with current CONFIG.
    switch ( CONFIG[MODULE_ID].graphPathfinding.algorithm ) {
      case "astar": return AStarGraph;
      case "breadth": return BFSGraph;
      case "uniform": return UniformCostGraph;
      case "greedy": return GreedyBestFirstGraph;
      case "test": return TestGraph;
      default: return AStarGraph;
    }
  }

  // Allow override of the graph class.
  set graphClass(value) { this.#graphClass = value; }


  /**
   * Start pathfinding.
   * From this point, assume the scene and starting point will not change.
   * @param {Point3d} start
   */
  startPathfinding(start) {
    // Reset the world if necessary.
    if ( !(this.world instanceof this.constructor.worldClass) ) this.#world = null;
    super.startPathfinding(start);

    // Set up world
    this.world.startPathfinding(start);
  }

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point3d} start      Start point for the graph
   * @param {Point3d} goal       End point for the graph
   * @param {AbortSignal} signal    Signal to end pathfinding early
   * @returns {Point3d[]}
   */
  async _findPath(start, goal, signal) {
    const graph = this.lastGraph = new this.graphClass(this.world);
    graph.debug = this.debug;
    graph.debugDelay = this.debugDelay;
    return graph.findPath(start, goal, signal);
  }

  destroy() {
    this.world = null;
    this.lastGraph = null;
    super.destroy();
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
  token;

  initialize(token) { this.token = token; }

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
  nodeIsUnreachable(node, start) {
    if ( !canvas.scene.dimensions.sceneRect.contains(node.x, node.y) ) return true;

    // Is the node in a different enclosed room than start?
    const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
    const nodeFace = sceneGraph.pointIsInFace(node);
    const startFace = sceneGraph.pointIsInFace(start);
    if ( !(nodeFace || startFace) || nodeFace === startFace ) return false;

    // Possible that we just got unlucky and there are multiple faces for this point.
    const nodeFaces = sceneGraph.enclosedFacesForPoint(node);
    const startFaces = sceneGraph.enclosedFacesForPoint(start);
    return !nodeFaces.intersects(startFaces);
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
  static maxIterations(start, _goal) {
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

  // Use a Set to track "Closed" nodes (already fully processed)
  closedSet = new Set();

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} start       Start point for the graph
   * @param {Point} goal        End point for the graph
   */
  async findPath(start, goal, _signal = {}) {
    const startNode = this.world.buildNode(start);
    const goalNode = this.world.buildNode(goal);
    if ( this.world.nodeIsUnreachable(goalNode, startNode) ) {
      console.warn(`${this.constructor.name}|Node unreachable.`, { startNode, goalNode });
      return null;
    }

    // Frontier tracks next neighbors to be visited.
    this._initializePathfindingRun(startNode);

    let iter = 0;
    let MAX_ITER = this.world.constructor.maxIterations(start, goal) || 1e03;
    let reachedGoal = false;
    if ( this.debug ) {
      this.world.drawNode(startNode, { color: Draw.COLORS.yellow });
      this.world.drawNode(goalNode, { color: Draw.COLORS.green });
    }

    const closedSet = this.closedSet;
    closedSet.clear();
    while ( this._frontier.length > 0 && iter < MAX_ITER ) {
      // if ( signal.aborted ) return null;
      iter += 1;
      const current = this._frontier.dequeue();

      // If already processed, skip.
      if ( closedSet.has(current.key) ) continue;
      closedSet.add(current.key);

      if ( this.debug ) {
        if ( this.debugDelay ) await sleep(this.debugDelay);
        this.world.drawNode(current, { color: Draw.COLORS.blue, alpha: 0.2, radius: 3 });
      }
      // console.debug(`${this.constructor.name}|Processing frontier ${current.x},${current.y}`)
      if ( (reachedGoal = this.world.reachedGoal(current, goalNode, goal)) ) {
        if ( !this._cameFrom.has(goalNode.key) ) this._cameFrom.set(goalNode.key, current); // CWSweep, for example, does not use current.key === goalNode.key.
        break;
      }
      for ( const n of this.world.getNeighbors(current) ) this.processFrontierNeighbor(current, n, goal);
    }

    if ( !reachedGoal ) {
      if ( iter >= MAX_ITER ) console.warn(`${this.constructor.name}|findPath stuck in loop.`, { startNode, goalNode });
      if ( this.debug ) console.debug(`${startNode} -> ${goalNode}: No path after examining ${closedSet.size} nodes over ${iter} iterations.`);
      return null;
    }

    const path = this.constructor.reconstructPath(this._cameFrom, goalNode);
    if ( this.debug ) console.debug(`${startNode} -> ${goalNode}: Found ${path?.length} path by examining ${closedSet.size} nodes over ${iter} iterations.`);

    if ( !path.at(0).almostEqual(start) ) path.unshift(start); // World must handle checks between start and startNode.
    if ( !path.at(-1).almostEqual(goal) ) path.push(goal);  // World must handle checks between goal and goalNode.
    return path;
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   * The child class should set the frontier and cameFrom map accoridngly.
   * @param {Node} current          The current position
   * @param {Node} next             The neighbor to consider
   * @
   */
  processFrontierNeighbor(_current, _next) { console.error("_processFrontierNeighbor must be defined by child class."); }

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
  processFrontierNeighbor(current, next) {
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
   * Prioritize the neighbor based on cost and add to the
   * @param {Node} current          The current position
   * @param {Node} next             The neighbor to consider
   */
  processFrontierNeighbor(current, next) {
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
  processFrontierNeighbor(current, next, goal) {
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
  processFrontierNeighbor(current, next, goal) {
    const costSoFar = this._costSoFar;
    const newCost = costSoFar.get(current.key) + this.world.cost(current, next, this.token);
    if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
      costSoFar.set(next.key, newCost);
      this._cameFrom.set(next.key, current);

      // Priority = g(n) + h(n).
      const priority = newCost + this.world.heuristic(next, goal);
      this._frontier.enqueue(next, priority);
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
MODULE_ID = "elevationruler"
Draw = CONFIG.GeometryLib.lib.Draw;
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
GridCoordinates = CONFIG.GeometryLib.lib.GridCoordinates
api = game.modules.get("elevationruler").api
let { ClockwiseSweepPathfinder, GriddedCollisionPathfinder, WebGPUPathfinder, worldBuilderGriddedCollision } = api.pathfinding;
let { solveSegment,
      pathIsValid,
      optimizeGridPath,
      dropIntermediatePoints,
      snapPathToGrid,
      straightenPath,
      removeDuplicatePoints,
      fogIsExplored,
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
algorithm = "webGPU"
graphPathfinding = {
  cost: "terrain",      // "manhattan"|"euclidean"|"foundry"|"terrain"
  heuristic: "terrain", //"manhattan"|"euclidean"|"foundry"|"terrain"
  neighborFilter: "occlusion" // "clockwiseSweep"|"occlusion"|"sceneGraph"
}
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)
pf = new GriddedCollisionPathfinder(randal)


start = GridCoordinates3d.fromObject(beiro.center)
end = GridCoordinates3d.fromObject(riswynn.center)
pf = new GriddedCollisionPathfinder(beiro)

start = GridCoordinates3d.fromObject(akra.center)
end = GridCoordinates3d.fromObject(perrin.center)
pf = new GriddedCollisionPathfinder(akra)

midE = (pf.token.topE - pf.token.bottomE) * 0.5;
start.elevation += midE;
end.elevation += midE;



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

pf.debug = true
pf.debugDelay = 50;

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
gridPath = snapPathToGrid(path, pf.token);
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


gridPath = dropIntermediatePoints(path)
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

gridPath = snapPathToGrid(path, pf.token)
pf.constructor.drawPath(gridPath, { color: Draw.COLORS.lightgreen, alpha: 0.5 })
pf.constructor.drawPath(gridPath, { color: Draw.COLORS.green })

gridPath.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.yellow }))

ObstacleSweep = api.pathfinding.ObstacleSweep
geom = ogre.GeometryLib.geometry
dir = end.subtract(start)
ix = start.projectToward(end, geom.rayIntersectionConstrained(start, dir))
ixNode = pf.world.buildNode(ix)
Draw.star(ixNode)
neighbors = pf.world.getNeighbors(ixNode)

sweep = new ObstacleSweep();
addedEdges = ObstacleSweep.identifyBlockingTokenEdges(pf.token);
addedEdges.forEach(edge => Draw.segment(edge))


token = randal
a = GridCoordinates3d.fromObject(path[0]);
b = GridCoordinates3d.fromObject(path[1]);



gridPath = snapPathToGrid(path, randal)
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
