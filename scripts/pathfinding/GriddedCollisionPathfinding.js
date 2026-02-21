/* globals
canvas,
CONFIG,
foundry,
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
import { GraphingPathfinder, GraphPathfindingWorld } from "./GraphPathfinding.js";
import { ObstacleSweep } from "./ClockwiseSweep.js";
import { optimizeGridPath } from "./path_cleaning.js";
import {
  Manhattan2dCost,
  Manhattan3dCost,

  Euclidean2dCost,
  Euclidean3dCost,

  FoundryMeasureCost,
  TokenTerrainCost,

  Manhattan2dHeuristic,
  Manhattan3dHeuristic,

  Euclidean2dHeuristic,
  Euclidean3dHeuristic,

  FoundryMeasureHeuristic,
  TokenTerrainHeuristic,
} from "./cost_measurement.js";

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

export class GriddedCollisionPathfinder extends GraphingPathfinder {

  static get worldClass() { return worldBuilderGriddedCollision(); }

  /**
   * Snap the path to the grid.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  snapPathToGrid(path) {
    return optimizeGridPath(path, { token: this.token });
  }

}

/**
 * Settings specific to the algorithm used with the graph to define nodes.
 * This is ostensibly stateless. Only saved values should be objects that can be
 * cached over multiple find paths for a single start point (e.g., single token drag).
 */


// ----- NOTE: Node construction ----- //

// NOTE: Node2d
export const Node2d = superclass => class extends superclass {
  buildNode(pt) {
    const gridPt = GridCoordinates.fromObject(pt);
    gridPt.centerToOffset();
    if ( gridPt.almostEqual(pt) ) return gridPt;

    // Don't walk through blocking obstacles.
    const validNeighbors = this.filterNeighbors([gridPt], pt);
    if ( !validNeighbors.length ) return pt;
    return gridPt;
  }

  reachedGoal(current, goal) { return current.offsetsEqual(goal); }
};

// NOTE: Node3d
export const Node3d = superclass => class extends superclass {
  buildNode(pt) {
    const gridPt = GridCoordinates3d.fromObject(pt);
    gridPt.centerToOffset();
    if ( gridPt.almostEqual(pt) ) return gridPt;

    // Don't walk through blocking obstacles.
    const validNeighbors = this.filterNeighbors([gridPt], pt);
    if ( !validNeighbors.length ) return pt;
    return gridPt;
  }

  reachedGoal(current, goal) { return current.offsetsEqual2d(goal); }
};


// ----- NOTE: Filter Neighbors ----- //

export const SceneGraphFilter = superclass => class extends superclass {

  token;

  initialize(token) {
    super.initialize(token);
    this.token = token;
  }

  /**
   * Filter the neighbors
   * @param {GridCoordinates} node
   * @returns {GridCoordinates[]}
   */
  filterNeighbors(neighbors, node) {
    const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
    return neighbors.filter(n => !sceneGraph.hasCollision(node, n, this.token));
  }
};


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
    using node3d = GridCoordinates3d.tmp.set(node2d.x, node2d.y, elev);
    const ot = this.#occlusionTester;
    ot.frustum = AABB2d.fromPoints(neighbors);
    ot._initialize({ rayOrigin: node3d });

    // Test whether each neighbor is occluded w/r/t this node.
    using tmpPt = Point3d.tmp;
    return neighbors.filter(n => {
      tmpPt.set(n.x, n.y, elev);
      tmpPt.subtract(node3d, tmpPt);
      return !ot._rayIsOccluded(tmpPt);
    });
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
    using rayOrigin = node.clone();
    rayOrigin.z += this.zOffset;
    const ot = this.#occlusionTester;
    ot.frustum = AABB2d.fromPoints(neighbors);
    ot._initialize({ rayOrigin });

    // Test whether each neighbor is occluded w/r/t this node.
    using tmpPt = Point3d.tmp;
    return neighbors.filter(n => {
      tmpPt.set(n.x, n.y, n.z + this.config.zOffset);
      tmpPt.subtract(rayOrigin, tmpPt);
      return !ot._rayIsOccluded(tmpPt);
    });
  }
};


// ----- NOTE: Neighbors ----- //

export const Neighbors2d = superclass => class extends superclass {
  adjacentOffsets(node) {
    using node2d = GridCoordinates.tmp.set(node.x, node.y);
    return canvas.grid.getAdjacentOffsets(node2d) // Offsets are at the center of the grid square.
      .map(offset => node.constructor.fromOffset(offset, node.z));
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
export function worldBuilderGriddedCollision({ cost, use3d, heuristic, pt3d, neighborFilter } = {}) {
  const pathCfg = CONFIG[MODULE_ID].graphPathfinding;
  use3d ??= pathCfg.use3d ?? false;
  pt3d ??= pathCfg.pt3d ?? false;
  cost ||= pathCfg.cost || "euclidean";
  heuristic ||= pathCfg.heuristic || "euclidean";
  neighborFilter ||= pathCfg.neighborFilter || "occlusion";

  let costCl;
  let heuristicCl;
  let nodeCl;
  let neighborFilterCl;
  let neighborsCl;

  nodeCl = (use3d || pt3d) ? Node3d : Node2d;
  neighborsCl = use3d ? Neighbors3d : Neighbors2d;
  switch ( cost ) {
    case "manhattan": costCl = use3d ? Manhattan3dCost : Manhattan2dCost; break;
    case "euclidean": costCl = use3d ? Euclidean3dCost : Euclidean2dCost; break;
    case "foundry": costCl = FoundryMeasureCost; break;
    case "terrain": costCl = TokenTerrainCost; break;
  }
  switch ( heuristic ) {
    case "manhattan": heuristicCl = use3d ? Manhattan3dHeuristic : Manhattan2dHeuristic; break;
    case "euclidean": heuristicCl = use3d ? Euclidean3dHeuristic : Euclidean2dHeuristic; break;
    case "foundry": heuristicCl = FoundryMeasureHeuristic; break;
    case "terrain": heuristicCl = TokenTerrainHeuristic; break;
  }
  switch ( neighborFilter ) {
    case "occlusion": neighborFilterCl = (use3d || pt3d) ? OcclusionFilter3d : OcclusionFilter2d; break;
    case "clockwiseSweep": neighborFilterCl = ClockwiseSweepFilter; break;
    case "sceneGraph": neighborFilterCl = SceneGraphFilter; break;
  }

  const classes = [nodeCl, costCl, heuristicCl, neighborsCl, neighborFilterCl];
  // return mix(AbstractGridPathfindingWorld).with(...classes, Mixin); // Mixin caches the classes.
  return mix(GraphPathfindingWorld).with(...classes);
}
