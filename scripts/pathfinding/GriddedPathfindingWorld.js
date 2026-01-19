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
   * @param {Node} start
   * @returns {boolean}
   */
  nodeIsUnreachable(node, _start) {
    return !canvas.scene.dimensions.sceneRect.contains(node.x, node.y);
  }

  /**
   * Maximum number of iterations given a start and end coordinate.
   * Used to stop if no path.
   * @param {Node} start
   * @param {Node} goal
   * @returns {number}
   */
  maxIterations(start, goal) {
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

// NOTE: Node2d
export const Node2d = superclass => class extends superclass {
  buildNode(pt) {
    pt = GridCoordinates.fromObject(pt);
    const tmp = GridCoordinates.tmp.set(pt.x, pt.y);
    tmp.setOffset(tmp.offset);
    if ( tmp.almostEqual(pt) ) return tmp;

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

// NOTE: Node3d
export const Node3d = superclass => class extends superclass {
  buildNode(pt) {
    pt = GridCoordinates3d.fromObject(pt);
    const tmp = GridCoordinates3d.tmp.set(pt.x, pt.y, pt.z || 0);
    tmp.setOffset(tmp.offset);
    if ( tmp.almostEqual(pt) ) return tmp;

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
    this.#addedEdges = this._identifyBlockingTokenEdges(token);
    if ( this.#addedEdges.length ) foundry.canvas.geometry.edges.Edge.identifyEdgeIntersections(
      [...this.#addedEdges, ...canvas.edges.getEdges(canvas.scene.dimensions.rect)]);

  }

  _identifyBlockingTokenEdges(subjectToken) {
    // Add token edges. Must be temporary wall edges.
    const blockingCfg = {
      dead: false,
      live: true,
      prone: false,
      enemies: true,
      allies: false,
    };
    const occlusionCfg = { blockingCfg, subjectToken };
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
    this.#occlusionTester.subjectToken = token;
    super.initialize(token);
  }


  filterNeighbors(neighbors, node2d) {
    const elev = this.config.elevationZ + this.config.zOffset;
    const node3d = GridCoordinates3d.tmp.set(node2d.x, node2d.y, elev);
    const ot = this.#occlusionTester;
    ot.frustum = AABB2d.fromPoints(neighbors);
    ot._initialize({ rayOrigin: node3d });

    // Test whether each neighbor is occluded w/r/t this node.
    const tmpPt = Point3d.tmp;
    const out = neighbors.filter(n => {
      tmpPt.set(n.x, n.y, elev);
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
export function worldBuilder({ cost, use3d, heuristic, pt3d, neighborFilter } = {}) {
  const pathCfg = CONFIG[MODULE_ID].simplePathfinding;
  use3d ??= pathCfg.use3d;
  pt3d ??= pathCfg.pt3d;
  cost ??= pathCfg.cost;
  heuristic ??= pathCfg.heuristic;
  neighborFilter ??= pathCfg.neighborFilter;

  let base = new Set();
  let costCl;
  let heuristicCl;
  let nodeCl;
  let neighborFilterCl = ClockwiseSweepFilter;
  let neighborsCl;
  if ( use3d ) {
    nodeCl = Node3d;
    neighborsCl = Neighbors3d;
    switch ( cost ) {
      case "manhattan": base.add(Manhattan3d); costCl = Manhattan3dCost; break;
      case "euclidean": base.add(Euclidean3d); costCl = Euclidean3dCost; break;
      case "foundry": base.add(FoundryMeasure); costCl = FoundryMeasureCost; break;
      case "terrain": base.add(TokenTerrain); costCl = TokenTerrainCost; break;
    }
    switch ( heuristic ) {
      case "manhattan": base.add(Manhattan3d); heuristicCl = Manhattan3dHeuristic; break;
      case "euclidean": base.add(Euclidean3d); heuristicCl = Euclidean3dHeuristic; break;
      case "foundry": base.add(FoundryMeasure); heuristicCl = FoundryMeasureHeuristic; break;
      case "terrain": base.add(TokenTerrain); heuristicCl = TokenTerrainHeuristic; break;
    }
    if ( neighborFilter === "occlusion" ) neighborFilterCl = OcclusionFilter3d;

  } else { // 2d
    neighborsCl = Neighbors2d;
    switch ( cost ) {
      case "manhattan": base.add(Manhattan2d); costCl = Manhattan2dCost; break;
      case "euclidean": base.add(Euclidean2d); costCl = Euclidean2dCost; break;
      case "foundry": base.add(FoundryMeasure); costCl = FoundryMeasureCost; break;
      case "terrain": base.add(TokenTerrain); costCl = TokenTerrainCost; break;
    }
    switch ( heuristic ) {
      case "manhattan": base.add(Manhattan2d); heuristicCl = Manhattan2dHeuristic; break;
      case "euclidean": base.add(Euclidean2d); heuristicCl = Euclidean2dHeuristic; break;
      case "foundry": base.add(FoundryMeasure); heuristicCl = FoundryMeasureHeuristic; break;
      case "terrain": base.add(TokenTerrain); heuristicCl = TokenTerrainHeuristic; break;
    }
    if ( pt3d ) {
      nodeCl = Node3d;
      if ( neighborFilter === "occlusion" ) neighborFilterCl = OcclusionFilter3d;
    } else {
      nodeCl = Node2d;
      if ( neighborFilter === "occlusion" ) neighborFilterCl = OcclusionFilter2d;
    }
  }
  const classes = [...base, nodeCl, costCl, heuristicCl, neighborsCl, neighborFilterCl];
  // return mix(AbstractGridPathfindingWorld).with(...classes, Mixin); // Mixin caches the classes.
  return mix(AbstractGridPathfindingWorld).with(...classes);
}
