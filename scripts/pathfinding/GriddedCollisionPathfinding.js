/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";
import { AABB2d } from "../geometry/AABB.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { ObstacleOcclusionTest } from "../geometry/ObstacleOcclusionTest.js";
import { GridCoordinates } from "../geometry/GridCoordinates.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { mix } from "../geometry/mixwith.js";
import { GraphPathfinder } from "./GraphPathfinding.js";
import { GraphPathfindingWorld } from "./GraphPathfindingWorld.js";
import { ObstacleSweep } from "./ClockwiseSweep.js";
import { straightenPath, dropIntermediatePoints } from "./path_cleaning.js";
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

export class GriddedCollisionPathfinder extends GraphPathfinder {

  static get worldClass() { return worldBuilderGriddedCollision(); }

  /**
   * Remove unnecessary path points and straighten the path.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  cleanPath(path) {
    path = dropIntermediatePoints(path);
    return straightenPath(path, this.token);
  }

  /**
   * Snap the path to the grid.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  async snapPathToGrid(path) {
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

export const NodeGridless = superclass => class extends superclass {
  resolution = canvas.grid.size >= 128 ? 4 : (canvas.grid.size >= 64 ? 2 : 1); // Originally 8|4|2 but too slow.

  neighborOffset = canvas.grid.size / this.resolution;

  // See SquareGrid##snapToCenter
  snapTo2dCenter(pt) {
    const s = canvas.grid.size / this.resolution;
    const t = canvas.grid.size / 2;
    pt.x = (Math.round((pt.x - t) / s) * s) + t;
    pt.y = (Math.round((pt.y - t) / s) * s) + t;
    return pt;
  }

  buildNode(pt) {
    const gridPt = GridCoordinates3d.fromObject(pt);
    this.snapTo2dCenter(gridPt);
    if ( gridPt.almostEqualXY(pt) ) return gridPt;

    // Don't walk through blocking obstacles.
    const validNeighbors = this.filterNeighbors([gridPt], pt);
    if ( !validNeighbors.length ) return pt;
    return gridPt;
  }

  // Do not need reachedGoal b/c just matching key.s
};

export const NodeGridless3d = superclass => class extends superclass {
  resolution = canvas.grid.size >= 128 ? 4 : (canvas.grid.size >= 64 ? 2 : 1); // Originally 8|4|2 but too slow.

  neighborOffset = canvas.grid.size / this.resolution;

  // See SquareGrid##snapToCenter
  snapTo3dCenter(pt) {
    const s = canvas.grid.size / this.resolution;
    const t = canvas.grid.size / 2;
    pt.x = (Math.round((pt.x - t) / s) * s) + t;
    pt.y = (Math.round((pt.y - t) / s) * s) + t;
    pt.z = (Math.round((pt.z - t) / s) * s) + t;
    return pt;
  }

  buildNode(pt) {
    const gridPt = GridCoordinates3d.fromObject(pt);
    this.snapTo3dCenter(gridPt);
    if ( gridPt.almostEqual(pt) ) return gridPt;

    // Don't walk through blocking obstacles.
    const validNeighbors = this.filterNeighbors([gridPt], pt);
    if ( !validNeighbors.length ) return pt;
    return gridPt;
  }

  // Note: reachedGoal is just matching keys.
};

// ----- NOTE: Filter Neighbors ----- //

export const SceneGraphFilter = superclass => class extends superclass {

  /**
   * Filter the neighbors
   * @param {GridCoordinates} node
   * @returns {GridCoordinates[]}
   */
  filterNeighbors(neighbors, node) {
    const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
    return neighbors.filter(n => !sceneGraph.pathBlocked(node, n, this.token));
  }

  testCollision(start, end, moveToken) {
    return CONFIG[MODULE_ID].sceneGraph.pathBlocked(start, end, moveToken);
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
    const blockingTokens = ObstacleSweep.blockingTokens(token)
    this.#addedEdges = ObstacleSweep.tokenEdges(blockingTokens);
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

  // Must initialize and start pathfinding first.
  testCollision(start, end, _moveToken) {
    const aabb = AABB2d.fromPoints([start, end]);
    this.#sweep.initialize(start, {
      type: "move",
      source: this.source,
      addedEdges: this.#addedEdges,
      boundaryShapes: [aabb.toRectangle()]
    });
    const ray = new foundry.canvas.geometry.Ray(start, end);
    return this.#sweep._testCollision(ray, "any");
  }

  testCollision2(start, end, _moveToken) {
    const type = "move";
    return CONFIG.Canvas.polygonBackends[type].testCollision(start, end, { type, mode: "any", source: this.source });
  }

  nodeIsUnreachable(node, start) {
    if ( super.nodeIsUnreachable(node, start) ) return true;

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
    // Occlusion tester frustum defaults to the scene rect.
    // We need the entire scene rect b/c cannot know for certain where the path will go.
    this.#occlusionTester.initialize({ subjectToken: token });
    super.initialize(token);
  }

  startPathfinding(_start) {
    // Set up blocking.
    const excludedStatuses = CONFIG[MODULE_ID].pathfindingIgnoreStatuses;
    const { dead, live, prone } = CONFIG[MODULE_ID].tokensBlock;
    const PF = Settings.KEYS.PATHFINDING;
    const tokensBlock = Settings.get(PF.TOKENS_BLOCK);
    const someTokensBlock = tokensBlock !== PF.TOKENS_BLOCK_CHOICES.NO;
    const allTokensBlock = tokensBlock === PF.TOKENS_BLOCK_CHOICES.ALL;
    const blockingCfg = {
      senseType: "move",
      walls: true,
      tiles: false,
      regions: false,
      tokens: {
        dead: dead && someTokensBlock,
        live: live && someTokensBlock,
        prone: prone && someTokensBlock,
        enemies: someTokensBlock,
        allies: allTokensBlock,
        excludedStatuses,
      },
    };
    this.#occlusionTester.config = blockingCfg;
  }

  filterNeighbors(neighbors, node) {
    const ot = this.#occlusionTester;

    // Test whether each neighbor is occluded w/r/t this node.
    using dir = Point3d.tmp;
    return neighbors.filter(n => {
      dir.set(n.x, n.y, n.z || node.z);
      dir.subtract(node, dir);
      return !ot.rayIsOccluded(node, dir);
    });
  }

  // Must initialize and start pathfinding first.
  testCollision(start, end, _moveToken) {
    using dir = end.subtract(start);
    return this.#occlusionTester.rayIsOccluded(start, dir);
  }

  nodeIsUnreachable(node, start) {
    if ( super.nodeIsUnreachable(node, start) ) return true;

    // Is node within a blocking token?
    for ( const token of canvas.tokens.placeables ) {
      if ( !this.#occlusionTester.includeToken(token) ) continue;
      return token.constrainedTokenBorder.contains(node.x, node.y);
    }

    // Is node within a blocking region and not currently in that region?
    if ( this.#occlusionTester._config.region ) {
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

/**
 * Gridless neighbor selection.
 * canvas.grid.getAdjacentOffsets returns [] on gridless maps.
 */
export const Neighbors2dGridless = superclass => class extends superclass {

  /* https://foundryvtt.com/article/walls/
  50px grids have 1/4 precision (5 snap points per grid unit).
  100px grids have 1/8 precision (9 snap points per grid unit)
  200px grids have 1/16 precision (17 snap points per grid unit)

  See canvas.walls.getSnappedPoint
  size = canvas.dimensions.size
  size >= 128 ? 8 : (size >= 64 ? 4 : 2)

  If canvas size is 100, resolution of 2 / 100 divides a grid square into two portions.
  Approximately:
  |ww••••ww|ww••••ww| <-- Forces path to be in middle of grid or get blocked.

  As wall positions increase, resolution must be incremented by 2. E.g., 4 /100:
  |w••ww••w|w••ww••w|

  See WebGPUPathfinding.
  < 64: 2
  >= 64: 4
  >= 128: 8
  */

  static neighborsDelta = [
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },

    { dx: 1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
  ];

  adjacentOffsets(node) {
    const out = Array(8);
    let i = 0;
    for ( const { dx, dy } of this.constructor.neighborsDelta ) {
      const offsetPt = node.constructor.tmp.set(
        node.x + (dx * this.neighborOffset),
        node.y + (dy * this.neighborOffset),
        node.z
      );
      this.snapTo2dCenter(offsetPt);
      out[i++] = offsetPt;
    }
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

export const Neighbors3dGridless = superclass => class extends superclass {

  config = {
    ...super.config,
    maxZ: 0,
    minZ: 0,
  };

  static neighborsDelta = [
    { dx: 0, dy: 1, dz: 0 },
    { dx: 0, dy: -1, dz: 0 },
    { dx: 1, dy: 0, dz: 0 },
    { dx: -1, dy: 0, dz: 0 },

    { dx: 1, dy: 1, dz: 0 },
    { dx: 1, dy: -1, dz: 0 },
    { dx: -1, dy: 1, dz: 0 },
    { dx: -1, dy: -1, dz: 0 },

    { dx: 0, dy: 1, dz: 1 },
    { dx: 0, dy: -1, dz: 1 },
    { dx: 1, dy: 0, dz: 1 },
    { dx: -1, dy: 0, dz: 1 },

    { dx: 1, dy: 1, dz: 1 },
    { dx: 1, dy: -1, dz: 1 },
    { dx: -1, dy: 1, dz: 1 },
    { dx: -1, dy: -1, dz: 1 },

    { dx: 0, dy: 1, dz: -1 },
    { dx: 0, dy: -1, dz: -1 },
    { dx: 1, dy: 0, dz: -1 },
    { dx: -1, dy: 0, dz: -1 },

    { dx: 1, dy: 1, dz: -1 },
    { dx: 1, dy: -1, dz: -1 },
    { dx: -1, dy: 1, dz: -1 },
    { dx: -1, dy: -1, dz: -1 },
  ];

  initialize(token) {
    const res = this.constructor.zMaxMin();
    this.config.maxZ = res.max;
    this.config.minZ = res.min;
    super.initialize(token);
  }

  adjacentOffsets(node) {
    const out = Array(8);
    let i = 0;
    for ( const { dx, dy, dz } of this.constructor.neighborsDelta ) {
      const offsetPt = node.constructor.tmp.set(
        node.x + (dx * this.neighborOffset),
        node.y + (dy * this.neighborOffset),
        node.z + (dz * this.neighborOffset),
      );
      offsetPt.z = Math.max(Math.min(offsetPt.z, this.config.maxZ), this.config.minZ);
      this.snapTo3dCenter(offsetPt);
      out[i++] = offsetPt;
    }
    return out;
  }
};

// ---- NOTE: World builder ----- //

// TODO: Eventually tie this to Settings or CONFIG and rebuild the class only when settings/CONFIG change.


/**
 * For the current configuration settings, build a pathfinding world class for the path
 * algorithm to use.
 * @returns {AbstractGridPathfindingWorld}
 */

// Simple cache of the collision world classes, to facilitate instanceof for the world class.
const worldClassCache = new Map();

export function worldBuilderGriddedCollision({ cost, use3d, heuristic, neighborFilter } = {}) {
  const pathCfg = CONFIG[MODULE_ID].graphPathfinding;
  use3d ??= pathCfg.use3d ?? false;
  cost ||= pathCfg.cost || "euclidean";
  heuristic ||= pathCfg.heuristic || "euclidean";
  neighborFilter ||= pathCfg.neighborFilter || "occlusion";

  const key = [cost, use3d, heuristic, neighborFilter].join(".");
  if ( worldClassCache.has(key) ) return worldClassCache.get(key);

  let costCl;
  let heuristicCl;
  let nodeCl;
  let neighborFilterCl;
  let neighborsCl;

  if ( canvas.grid.isGridless ) {
    nodeCl = use3d ? NodeGridless3d : NodeGridless;
    neighborsCl = use3d ? Neighbors3dGridless : Neighbors2dGridless;
  } else {
    nodeCl = Node;
    neighborsCl = use3d ? Neighbors3d : Neighbors2d;
  }

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
  const out = mix(GraphPathfindingWorld).with(...classes);
  worldClassCache.set(key, out);
  return out;
}
