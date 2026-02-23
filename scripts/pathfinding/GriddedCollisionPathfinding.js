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
import { dropIntermediatePoints } from "./path_cleaning.js";
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
   * Path cleaning.
   *
   * GriddedCollisionPathfinder will return gridded paths if on gridded scene; linear otherwise.
   */
  // cleanPath(path); // Handled by super.cleanPath.

  /**
   * Snap the path to the grid.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  snapPathToGrid(path) {
    // The Foundry offsets already snap-to-grid. Drop intermediate points.
    return dropIntermediatePoints(path);
  }

}

/**
 * Settings specific to the algorithm used with the graph to define nodes.
 * This is ostensibly stateless. Only saved values should be objects that can be
 * cached over multiple find paths for a single start point (e.g., single token drag).
 */


// ----- NOTE: Node construction ----- //

export const Node = superclass => class extends superclass {
  buildNode(pt) {
    const gridPt = GridCoordinates3d.fromObject(pt);
    gridPt.centerTo2dGrid();
    if ( gridPt.almostEqualXY(pt) ) return gridPt;

    // Don't walk through blocking obstacles.
    const validNeighbors = this.filterNeighbors([gridPt], pt);
    if ( !validNeighbors.length ) return pt;
    return gridPt;
  }

  /**
   * @param {Node} current
   * @param {Node} goalNode
   * @param {Point3d} goal
   * @returns {boolean}
   */
  // The buildNode method provides an appropriate goalNode that can connect to goal.
  reachedGoal(current, goalNode) { return current.offsetsEqual(goalNode); }
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
    return neighbors.filter(n => !sceneGraph.pathBlocked(node, n, this.token));
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
      if ( !node.z.between(token.bottomZ, token.topZ) ) continue;
      return token.constrainedTokenBorder.contains(node.x, node.y);
    }
  }
};

export const OcclusionFilter = superclass => class extends superclass {
  #occlusionTester = new ObstacleOcclusionTest();

  initialize(token) {
    this.#occlusionTester._config.blocking.tokens.live = true;
    super.initialize(token);
  }

  filterNeighbors(neighbors, node) {
    using rayOrigin = node.clone();
    const ot = this.#occlusionTester;
    ot.frustum = AABB2d.fromPoints(neighbors);
    ot._initialize({ rayOrigin });

    // Test whether each neighbor is occluded w/r/t this node.
    using tmpPt = Point3d.tmp;
    return neighbors.filter(n => {
      tmpPt.set(n.x, n.y, n.z || node.z);
      tmpPt.subtract(rayOrigin, tmpPt);
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


// ----- NOTE: Neighbors ----- //

export const Neighbors2d = superclass => class extends superclass {
  adjacentOffsets(node) {
    using node2d = GridCoordinates.tmp.set(node.x, node.y);
    return canvas.grid.getAdjacentOffsets(node2d) // Offsets are at the center of the grid square.
      .map(offset => node.constructor.fromOffset(offset, node.elevation));
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
export function worldBuilderGriddedCollision({ cost, use3d, heuristic, neighborFilter } = {}) {
  const pathCfg = CONFIG[MODULE_ID].graphPathfinding;
  use3d ??= pathCfg.use3d ?? false;
  cost ||= pathCfg.cost || "euclidean";
  heuristic ||= pathCfg.heuristic || "euclidean";
  neighborFilter ||= pathCfg.neighborFilter || "occlusion";

  let costCl;
  let heuristicCl;
  let nodeCl;
  let neighborFilterCl;
  let neighborsCl;

  nodeCl = Node;
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
    case "occlusion": neighborFilterCl = OcclusionFilter; break;
    case "clockwiseSweep": neighborFilterCl = ClockwiseSweepFilter; break;
    case "sceneGraph": neighborFilterCl = SceneGraphFilter; break;
  }

  const classes = [nodeCl, costCl, heuristicCl, neighborsCl, neighborFilterCl];
  // return mix(AbstractGridPathfindingWorld).with(...classes, Mixin); // Mixin caches the classes.
  return mix(GraphPathfindingWorld).with(...classes);
}
