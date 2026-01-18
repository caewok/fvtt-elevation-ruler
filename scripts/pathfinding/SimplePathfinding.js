/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { AABB2d } from "../geometry/AABB.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { PriorityQueue } from "./PriorityQueue.js";
import { ObstacleOcclusionTest } from "../geometry/ObstacleOcclusionTest.js";
import { GridCoordinates } from "../geometry/GridCoordinates.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { mix, Mixin } from "../geometry/mixwith.js";

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


class AbstractGridPathfindingWorld {

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
  cost;

  /**
   * Estimated cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  heuristic;

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
   * @returns {boolean}
   */
  nodeIsUnreachable(node) {
    return !canvas.scene.dimensions.sceneRect.contains(node.x, node.y);
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
}


// ----- NOTE: Base cost/heuristic methods ----- //

// Cost parameters: current, next, token.
export const Euclidean2d = superclass => class extends superclass {
  static euclidean(a, b) { return PIXI.Point.distanceBetween(a, b); }
};

export const Euclidean3d = superclass => class extends superclass {
  static euclidean3d(a, b) { return Point3d.distanceBetween(a, b); }
};

export const Manhattan2d = superclass => class extends superclass {
  static manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
};

export const Manhattan3d = superclass => class extends superclass {
  static manhattan3d(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z); }
};

export const FoundryMeasure = superclass => class extends superclass {
  static foundryMeasure(a, b) { return canvas.grid.measurePath([a, b]).cost; }
};

export const TokenTerrain = superclass => class extends superclass {
  static tokenTerrainCost(a, b, token) {
    const terrainWaypoints = token.createTerrainMovementPath([a, b]);
    return token.measureMovementPath(terrainWaypoints).cost;
  }
};

// ----- NOTE: Cost ----- //
export const Euclidean2dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = this.constructor.euclidean;
};

export const Euclidean3dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = this.constructor.euclidean3d;
};

export const Manhattan2dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = this.constructor.manhattan;
};

export const Manhattan3dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = this.constructor.manhattan3d;
};

export const FoundryMeasureCost = superclass => class extends superclass {
  cost = this.constructor.foundryMeasure;
};

export const TokenTerrainCost = superclass => class extends superclass {
  cost = this.constructor.tokenTerrainCost;
};

// ----- NOTE: Heuristic ----- //
export const Euclidean2dHeuristic = superclass => class extends superclass {
  /** @type {function} */
  heuristic = this.constructor.euclidean;
};

export const Euclidean3dHeuristic = superclass => class extends superclass {
  /** @type {function} */
  heuristic = this.constructor.euclidean3d;
};

export const Manhattan2dHeuristic = superclass => class extends superclass {
  heuristic = this.constructor.manhattan;
};

export const Manhattan3dHeuristic = superclass => class extends superclass {
  heuristic = this.constructor.manhattan3d;
};

export const TokenTerrainHeuristic = superclass => class extends superclass {
  heuristic = this.constructor.tokenTerrainCost;
};

export const FoundryMeasureHeuristic = superclass => class extends superclass {
  heuristic = this.constructor.foundryMeasure;
};

// ----- NOTE: Node construction ----- //
export const Node2d = superclass => class extends superclass {
  buildNode(pt) {
    pt = GridCoordinates.fromObject(pt);
    const tmp = GridCoordinates.tmp.set(pt.x, pt.y);
    tmp.setOffset(tmp.offset);

    // Don't walk through blocking obstacles.
    const validNeighbors = this.filterNeighbors([tmp], pt);
    pt.release();
    if ( !validNeighbors.length ) {
      tmp.release();
      return null;
    }
    return tmp;
  }
};

export const Node3d = superclass => class extends superclass {
  buildNode(pt) {
    pt = GridCoordinates3d.fromObject(pt);
    const tmp = GridCoordinates3d.tmp.set(pt.x, pt.y, pt.z || 0);
    tmp.setOffset(tmp.offset);

    // Don't walk through blocking obstacles.
    const validNeighbors = this.filterNeighbors([tmp], pt);
    pt.release();
    if ( !validNeighbors.length ) {
      tmp.release();
      return null;
    }
    return tmp;
  }
};


// ----- NOTE: Filter Neighbors ----- //

class ObstacleSweep extends foundry.canvas.geometry.ClockwiseSweepPolygon {

  _identifyEdges() {
    super._identifyEdges();
    const aabb = AABB2d.fromRectangle(this.config.boundingBox);
    for ( const edge of this.config.addedEdges ) {
      if ( !aabb.overlapsEdge(edge) ) continue;
      this.edges.add(edge);
    }

    // Add token edges. Must be temporary wall edges.
    const blockingCfg = {
      dead: false,
      live: true,
      prone: false,
      enemies: true,
      allies: false,
    };
    const occlusionCfg = { blockingCfg, subjectToken: this.config.source.object };
    const Edge = foundry.canvas.geometry.edges.Edge;
    for ( const token of canvas.tokens.placeables ) {
      if ( !ObstacleOcclusionTest.includeToken(token, occlusionCfg) ) continue;
      for ( const edge of token.constrainedTokenBorder.iterateEdges({ closed: false }) ) {
        this.edges.add(new Edge(edge.A, edge.B, {
          object: { flags: {
            "wall-height": {
              top: token.topZ,
              bottom: token.bottomZ,
            }
          }},
          type: `${MODULE_ID}.ObstacleSweep`,
          id: token.id,
          move: CONST.WALL_SENSE_TYPES.NORMAL,
        }));
      }
    }
    // Edge.identifyEdgeIntersections([...this.edges]);
  }

}


export const ClockwiseSweepFilter = superclass => class extends superclass {
  /** @type {PointSourcePolygon} */
  // #poly = new foundry.canvas.geometry.ClockwiseSweepPolygon();
  #sweep = new ObstacleSweep();

  #addedEdges = [];

  source;

  initialize(token) {
    super.initialize(token);
    this.source = new foundry.canvas.sources.PointMovementSource({ object: token });
    this.#addedEdges = this._identifyBlockingTokenEdges();
    if ( this.#addedEdges.length ) foundry.canvas.geometry.edges.Edge.identifyEdgeIntersections(
      [...this.#addedEdges, ...canvas.edges.getEdges(canvas.scene.dimensions.rect)]);

  }

  _identifyBlockingTokenEdges() {
    // Add token edges. Must be temporary wall edges.
    const blockingCfg = {
      dead: false,
      live: true,
      prone: false,
      enemies: true,
      allies: false,
    };
    const occlusionCfg = { blockingCfg, subjectToken: this.token };
    const Edge = foundry.canvas.geometry.edges.Edge;
    const edges = [];
    for ( const token of canvas.tokens.placeables ) {
      if ( !ObstacleOcclusionTest.includeToken(token, occlusionCfg) ) continue;
      for ( const edge of token.constrainedTokenBorder.iterateEdges({ closed: false }) ) {
        edges.push(new Edge(edge.A, edge.B, {
          object: { flags: {
            "wall-height": {
              top: token.topZ,
              bottom: token.bottomZ,
            }
          }},
          type: `${MODULE_ID}.ObstacleSweep`,
          id: token.id,
          move: CONST.WALL_SENSE_TYPES.NORMAL,
        }));
      }
    }
    return edges;
  }

  /**
   * Filter the neighbors
   * @param {GridCoordinates} node
   * @returns {GridCoordinates[]}
   */
  filterNeighbors(neighbors, node) {
    const aabb = AABB2d.fromPoints(neighbors);
    this.#sweep.initialize(node, {
      type: "move",
      source: this.source,
      addedEdges: this.#addedEdges,
      boundaryShapes: [aabb.toRectangle()]
    });
    return neighbors.filter(n => {
      const ray = new foundry.canvas.geometry.Ray(node, n);
      return !this.#sweep._testCollision(ray, "any", n);
    });
  }

  nodeIsUnreachable(node) {
    if ( super.nodeIsUnreachable(node) ) return true;

    const blockingCfg = {
      dead: false,
      live: true,
      prone: false,
      enemies: true,
      allies: false,
    };
    const occlusionCfg = { blockingCfg, subjectToken: this.source.object };
    for ( const token of canvas.tokens.placeables ) {
      if ( !ObstacleOcclusionTest.includeToken(token, occlusionCfg) ) continue;
      return token.constrainedTokenBorder.contains(node.x, node.y);
    }
  }
};

export const OcclusionFilter2d = superclass => class extends superclass {
  #occlusionTester = new ObstacleOcclusionTest();

  config = {
    ...super.config,
    zOffset: 5,
    elevationZ: null,
  };

  initialize(token) {
    this.config.elevationZ = token.bottomZ;
    this.#occlusionTester._config.blocking.tokens.live = true;
    super.initialize(token);
  }


  filterNeighbors(neighbors, node2d) {
    const node3d = GridCoordinates3d.tmp.set(node2d.x, node2d.y, this.config.elevationZ + this.config.zOffset);
    const ot = this.#occlusionTester;
    ot.frustum = AABB2d.fromPoints(neighbors);
    ot._initialize({ rayOrigin: node3d });

    // Test whether each neighbor is occluded w/r/t this node.
    const tmpPt = Point3d.tmp;
    const out = neighbors.filter(n => {
      tmpPt.set(n.x, n.y, this.config.elevationZ + this.config.zOffset);
      tmpPt.subtract(node3d, tmpPt);
      return !ot._rayIsOccluded(tmpPt);
    });
    tmpPt.release();
    node3d.release();
    return out;
  }

  nodeIsUnreachable(node, start) {
    if ( super.nodeIsUnreachable(node) ) return true;

    // Is node within a blocking token?
    for ( const token of canvas.tokens.placeables ) {
      if ( !this.#occlusionTester.includeToken(token) ) continue;
      return token.constrainedTokenBorder.contains(node.x, node.y);
    }

    // Is node within a blocking region and not currently in that region?
    if ( this.#occlusionTester._config.blocking.region ) {
      for ( const region of canvas.regions.placeables ) {
        region.GeometryLib.geometry.update();
        for ( const shape of region.document.shapes ) {
          if ( shape.hole ) continue;
          const geom = region.document.shapes[0].GeometryLib.geometry;
          if ( !geom.aabb.containsPoint(node, ["x", "y"]) ) continue;
          if ( !geom.shapePIXI.contains(start.x, start.y) && geom.shapePIXI.contains(node.x, node.y) ) return true;
        }
      }
    }

    // Possible to be within a confined wall shape but not worth checking. Avoid elsewhere.

    return false;
  }
};

export const OcclusionFilter3d = superclass => class extends superclass {
  #occlusionTester = new ObstacleOcclusionTest();

  config = {
    ...super.config,
    zOffset: 0,
  };

  initialize(token) {
    this.#occlusionTester._config.blocking.tokens.live = true;
    super.initialize(token);
  }


  filterNeighbors(neighbors, node) {
    node = node.clone();
    node.z += this.zOffset;
    const ot = this.#occlusionTester;
    ot.frustum = AABB2d.fromPoints(neighbors);
    ot._initialize({ rayOrigin: node });

    // Test whether each neighbor is occluded w/r/t this node.
    const tmpPt = Point3d.tmp;
    const out = neighbors.filter(n => {
      tmpPt.set(n.x, n.y, n.z + this.config.zOffset);
      tmpPt.subtract(node, tmpPt);
      return !ot._rayIsOccluded(tmpPt);
    });
    tmpPt.release();
    node.release();
    return out;
  }
};


// ----- NOTE: Neighbors ----- //

export const Neighbors2d = superclass => class extends superclass {
  adjacentOffsets(node) {
    const node2d = GridCoordinates.tmp.set(node.x, node.y);
    const out = canvas.grid.getAdjacentOffsets(node2d) // Offsets are at the center of the grid square.
      .map(offset => node.constructor.fromOffset(offset, node.z));
    node2d.release();
    return out;
  }
};

export const Neighbors3d = superclass => class extends superclass {

  config = {
    ...super.config,
    maxZ: 0,
    minZ: 0,
  };

  initialize(token) {
    const res = this.constructor.zMaxMin();
    this.config.maxZ = res.max;
    this.config.minZ = res.min;
    super.initialize(token);
  }

  adjacentOffsets(node) {
    return canvas.grid.getAdjacentOffsets(node)
      .map(offset => node.constructor.fromOffset(offset))
      .filter(offset => offset.z.between(this.config.minZ ?? node.z, this.config.maxZ ?? node.z));
  }
};

// ---- NOTE: World builder ----- //

// TODO: Eventually tie this to Settings or CONFIG and rebuild the class only when settings/CONFIG change.

/**
 * For the current configuration settings, build a pathfinding world class for the path
 * algorithm to use.
 * @returns {AbstractGridPathfindingWorld}
 */
function worldBuilder() {
  const pathCfg = CONFIG[MODULE_ID].simplePathfinding;
  let base = new Set();
  let cost;
  let heuristic;
  let node;
  let neighborFilter = ClockwiseSweepFilter;
  let neighbors;
  if ( pathCfg.use3d ) {
    neighbors = Neighbors3d;
    switch ( pathCfg.cost ) {
      case "manhattan": base.add(Manhattan3d); cost = Manhattan3dCost; break;
      case "euclidean": base.add(Euclidean3d); cost = Euclidean3dCost; break;
      case "foundry": base.add(FoundryMeasure); cost = FoundryMeasureCost; break;
      case "terrain": base.add(TokenTerrain); cost = TokenTerrainCost; break;
    }
    switch ( pathCfg.heuristic ) {
      case "manhattan": base.add(Manhattan3d); heuristic = Manhattan3dHeuristic; break;
      case "euclidean": base.add(Euclidean3d); heuristic = Euclidean3dHeuristic; break;
      case "foundry": base.add(FoundryMeasure); heuristic = FoundryMeasureHeuristic; break;
      case "terrain": base.add(TokenTerrain); heuristic = TokenTerrainHeuristic; break;
    }
    if ( pathCfg.neighborFilter === "occlusion" ) neighborFilter = OcclusionFilter3d;

  } else { // 2d
    neighbors = Neighbors2d;
    switch ( pathCfg.cost ) {
      case "manhattan": base.add(Manhattan2d); cost = Manhattan2dCost; break;
      case "euclidean": base.add(Euclidean2d); cost = Euclidean2dCost; break;
      case "foundry": base.add(FoundryMeasure); cost = FoundryMeasureCost; break;
      case "terrain": base.add(TokenTerrain); cost = TokenTerrainCost; break;
    }
    switch ( pathCfg.heuristic ) {
      case "manhattan": base.add(Manhattan2d); heuristic = Manhattan2dHeuristic; break;
      case "euclidean": base.add(Euclidean2d); heuristic = Euclidean2dHeuristic; break;
      case "foundry": base.add(FoundryMeasure); heuristic = FoundryMeasureHeuristic; break;
      case "terrain": base.add(TokenTerrain); heuristic = TokenTerrainHeuristic; break;
    }
    if ( pathCfg.pt3d ) {
      node = Node3d;
      if ( pathCfg.neighborFilter === "occlusion" ) neighborFilter = OcclusionFilter3d;
    } else {
      node = Node2d;
      if ( pathCfg.neighborFilter === "occlusion" ) neighborFilter = OcclusionFilter2d;
    }
  }
  const classes = [...base, node, cost, heuristic, neighbors, neighborFilter];
  // return mix(AbstractGridPathfindingWorld).with(...classes, Mixin); // Mixin caches the classes.
  return mix(AbstractGridPathfindingWorld).with(...classes);
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

/**
 * BFS explores neighbors layer by layer.
 * It is optimal for unweighted graphs (where every step costs exactly 1).
 */
export class BFSPathfinder extends AbstractPathfinder {

  /** @type {AbstractPathfindingWorld} */
  // world = new FoundryPathfindingWorld();
  world;

  _cameFrom = new Map();

  _frontier = new Frontier();

  initializeWorld() {
    const cl = worldBuilder();
    this.world = new cl();
    this.world.initialize(this.token);

  }

  initialize() {
    this.initializeWorld();
  }

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} start       Start point for the graph
   * @param {Point} goal        End point for the graph
   */
  async findPath(start, goal, signal = {}) {
    start = this.world.buildNode(start);
    goal = this.world.buildNode(goal);
    if ( !(start || goal) || start.almostEqual(goal) ) return null;

    // Frontier tracks next neighbors to be visited.
    this._initializePathfindingRun(start);

    let iter = 0;
    let MAX_ITER = 1e04;
    let reachedGoal = false;
    while ( this._frontier.length > 0 && iter < MAX_ITER ) {
      if ( signal.aborted ) return null;
      iter += 1;
      const current = this._frontier.dequeue();
      // console.debug(`${this.constructor.name}|Processing frontier ${current.x},${current.y}`)
      if ( (reachedGoal = current.almostEqual(goal)) ) break;
      await this._processFrontierNeighbors(current, goal);
    }

    if ( iter >= MAX_ITER ) console.error(`${this.constructor.name}|findPath stuck in loop.`);
    start.release();
    return reachedGoal ? this.constructor.reconstructPath(this._cameFrom, goal) : null;
  }

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
   * Asynchronously process all the neighbors for the current node of the frontier.
   * Async so it can be stopped.
   * @param {Point} current
   */
  async _processFrontierNeighbors(current, goal) {
    for ( let next of this.world.getNeighbors(current) ) this._processFrontierNeighbor(current, next, goal);
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbor(current, next) {
    if ( !this._cameFrom.has(next.key) ) {
      this._frontier.enqueue(next);
      this._cameFrom.set(next.key, current);
    }
  }

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

/**
 * UCS is essentially Dijkstra’s Algorithm.
 * It expands the node with the lowest cumulative cost g(n) from the start.
 */
export class UniformCostPathfinder extends BFSPathfinder {

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
  _processFrontierNeighbor(current, next) {
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
export class GreedyBestFirstPathfinder extends BFSPathfinder {

  _frontier = new PriorityQueue("low");

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbor(current, next, goal) {
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
export class AStarPathfinder extends UniformCostPathfinder {
  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbor(current, next, goal) {
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
let { BFSPathfinder,
      UniformCostPathfinder,
      GreedyBestFirstPathfinder,
      AStarPathfinder } = api.pathfinding;

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)

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
