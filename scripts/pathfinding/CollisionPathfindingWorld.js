/* globals
canvas,
CONFIG,
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
import { Draw } from "../geometry/Draw.js";
import { GraphPathfindingWorld } from "./GraphPathfinding.js";
import { ObstacleSweep } from "./ClockwiseSweep.js";

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


/**
 * Settings specific to the algorithm used with the graph to define nodes.
 * This is ostensibly stateless. Only saved values should be objects that can be
 * cached over multiple find paths for a single start point (e.g., single token drag).
 */

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




export const ClockwiseSweepFilter = superclass => class extends superclass {
  /** @type {PointSourcePolygon} */
  #sweep = new ObstacleSweep();

  /** @type {Edge[]} */
  #addedEdges = [];

  /** @type {PointMovementSource} */
  source;

  initialize(token) {
    super.initialize(token);
    this.source = new foundry.canvas.sources.PointMovementSource({ object: token });
    this.#addedEdges = ObstacleSweep.identifyBlockingTokenEdges(token);
    if ( this.#addedEdges.length ) foundry.canvas.geometry.edges.Edge.identifyEdgeIntersections(
      [...this.#addedEdges, ...canvas.edges.getEdges(canvas.scene.dimensions.rect)]);
  }

  startPathfinding(start) {
    this.source.initialize(start);
    super.startPathfinding(start);
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
      return !this.#sweep._testCollision(ray, "any");
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
export function worldBuilderCollision({ cost, use3d, heuristic, pt3d, neighborFilter } = {}) {
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
  return mix(GraphPathfindingWorld).with(...classes);
}
