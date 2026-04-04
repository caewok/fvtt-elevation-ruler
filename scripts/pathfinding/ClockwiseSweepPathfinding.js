/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../geometry/const.js";
import { NULL_SET } from "../geometry/util.js";
import { AABB2d } from "../geometry/AABB.js";
import { ElevatedPoint } from "../geometry/3d/ElevatedPoint.js";
import { Draw } from "../geometry/Draw.js";
import { GraphPathfinder } from "./GraphPathfinding.js";
import { GraphPathfindingWorld } from "./GraphPathfindingWorld.js";
import { ClockwiseCornerSweep, offsetVCornersForEdges, offsetEdgeCornersForEdges } from "./ClockwiseSweep.js";
import { UniformPointGrid } from "./UniformPointGrid.js";
import { mix } from "../geometry/mixwith.js";
import { tokenTerrainValue, regionTerrainValue, TERRAIN_FEATURES } from "./terrain_utils.js";
import { snapPathToGrid } from "./snap_to_grid.js";
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

/* Clockwise sweep pathfinding

From start point, conduct cw sweep.
Identify edges that jump between walls.
Mark the middle point and the near point (to the sweep origin) of each such edge.
Conduct sweep from those points.
Stop when the point is within the end sweep.
*/

export class ClockwiseSweepPathfinder extends GraphPathfinder {

  static get worldClass() { return worldBuilderClockwise(); }

  /**
   * Snap the path to the grid.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  async snapPathToGrid(path) {
    const snappedPath = await snapPathToGrid(path, this.token);
    if ( !snappedPath ) return path;
    return optimizeGridPath(snappedPath, this.token);
    // TODO: Could use specialized version that limits collision tests between a and b
    //       to edges encountered in a's sweep.

    // TODO: Could run collision pathfinding within a's sweep to find best grid path to b.
  }

}

/**
 * Nodes for the ClockwiseSweep store the sweep polygon.
 */
export class ClockwiseSweepPathfindingNode extends ElevatedPoint {
  /** @param {ClockwiseSweepPolygon.config} */
  sweepOpts = {};

  drawn = false;

  cornerMap;

  terrainPointGrid;

  static create(pt, cornerMap, terrainPointGrid, sweepOpts = {}) {
    const node = this.fromObject(pt);
    node.roundDecimals();
    node.sweepOpts = sweepOpts; // Here we want to link the same sweep opts object.
    node.cornerMap = cornerMap;
    node.terrainPointGrid = terrainPointGrid;
    return node;
  }

  /** @type {PointSourcePolygon} */
  #sweep;

  /** @type {ClockwiseSweepPathfindingNode[]} */
  #neighborKeys = new Set();

  #computedSweep = false;

  #computedNeighbors = false;

  get sweep() {
    if ( !this.#computedSweep ) this.computeSweep();
    return this.#sweep;
  }

  computeSweep() {
    this.#sweep = new ClockwiseCornerSweep();
    this.#sweep.initialize(this, this.sweepOpts);
    this.#sweep.compute();
    this.#computedSweep = true;

    // Debugging.
    // const color = randomColor();
    // this.drawShape({ fill: color, });
  }

  /** @type {number<pixels>} */
  static CORNER_OFFSET = 2;

  /**
   * Calculate the neighbors for this node.
   * Neighbors are offset corner points or terrain points
   * contained within the sweep.
   * @returns {ClockwiseSweepPathfindingNode[]}
   */
  getNeighbors() {
    if ( !this.#computedNeighbors ) {
      this.#neighborKeys.clear();
      for ( const cornerNeighbor of this._calculateCornerNeighbors() ) {
        this.#neighborKeys.add(cornerNeighbor);
      }
      if ( this.terrainPointGrid ) {
        for ( const terrainNeighbor of this._calculateTerrainNeighbors() ) {
          this.#neighborKeys.add(terrainNeighbor);
        }
      }
      this.#computedNeighbors = true;

      // Remove the sweep b/c not needed anymore unless it is the starting point.
      this.#sweep = null;
      this.#computedSweep = false;
    }
    return this.#neighborKeys;
  }

  _calculateCornerNeighbors() {
    if ( !this.cornerMap.size ) return NULL_SET;
    const neighbors = new Set();
    const sweep = this.sweep;

    // Corner offsets can be found by getting the offsets for the
    // corners in the sweep.
    // TODO: Can these offset corners ever be outside the sweep? If yes, contains test is required.
    using cornerOffset = PIXI.Point.tmp;
    using corner = PIXI.Point.tmp;

    // Ray has cached values that would have to be reset, except that _testCollision only uses ray.B.
    // const ray = { B: cornerOffset };
    for ( const cornerKey of sweep.cornersEncountered ) {
      if ( !this.cornerMap.has(cornerKey) ) continue;
      PIXI.Point.invertKey(cornerKey, corner);
      this.cornerMap.get(cornerKey).offsetCornerKeys.forEach(key => {
        PIXI.Point.invertKey(key, cornerOffset);

        // sweep._envelopsPoint fails if the orient2d test for lineSegmentIntersects is
        // extremely close. In other words, if the point is near a diagonal (sweep) edge,
        // then it might be seen as on the other side thanks to floating point errors.
        // See https://github.com/mourner/robust-predicates/tree/main.
        // What we really care about is whether origin --> offsetCorner is deemed a collision, so test that.
        // if ( sweep._envelopsPoint(pt) ) neighbors.add(key);

        // Collision test is necessary b/c while each corner is in the sweep, the corner offset
        // is not guaranteed to be. Example: One wall from the left and another behind it from the
        // right: the left wall cuts the sweep, meaning the corner offset from the right might be
        // too far left. Not obvious how to catch this without testing all collisions.
        // if ( !sweep._testCollision(ray, "any") ) neighbors.add(key);

        // Instead of collision test, check for whether the sweep contains the offset point:
        // We know the sweep contains the corner. Need to know if the ray from the corner
        // to the offset corner hits an edge of the sweep before it hits the offset corner.

        let hasIx = false;
        for ( const edge of sweep.iterateEdges({ close: true }) ) {
          if ( edge.a.key === cornerKey || edge.b.key === cornerKey ) continue;
          if ( !foundry.utils.lineSegmentIntersects(edge.a, edge.b, corner, cornerOffset) ) continue;
          hasIx = true;
          break;
        }
        if ( !hasIx ) neighbors.add(key);

      });
    }
    return neighbors;
  }

  _calculateTerrainNeighbors() {
    if ( !this.terrainPointGrid.grid.size ) return NULL_SET;

    // Terrain offsets are neighbors if they are within the sweep, requiring a contains test.
    const neighbors = new Set();
    const sweep = this.sweep;
    const aabb = AABB2d.fromPolygon(sweep);
    const potentialPoints = this.terrainPointGrid.query(aabb);
    const ray = { B: null };
    for ( const pt of potentialPoints ) {
      // if ( sweep._envelopsPoint(pt) ) neighbors.add(pt.key);
      ray.B = pt;
      if ( !sweep._testCollision(ray, "any") ) neighbors.add(pt.key);
    }
    return neighbors;
  }

  _neighborIsValid(key) {
    using gapPoint = PIXI.Point.invertKey(key);
    if ( !this.#sweep ) this.computeSweep();
    if ( !this.sweep._envelopsPoint(gapPoint) ) {
      console.warn(`Sweep does not envelop gap point${gapPoint}`);
      return false;
    }

    // No collision between the origin and the gap points.
    const ray = new foundry.canvas.geometry.Ray(this, gapPoint);
    if ( this.sweep._testCollision(ray, "any") ) {
      console.warn(`Origin ${this} --> ${gapPoint} has collision.`);
      return false;
    }
    return true;
  }

  drawShape(opts = {}) {
    opts.fill ??= opts.color;
    opts.fill ??= Draw.COLORS.blue;
    opts.fillAlpha ??= 0.2;
    opts.width ??= 0;
    Draw.shape(this.sweep, opts);
  }

  drawNeighbors(opts = {}) {
    if ( !this.#computedNeighbors ) return;
    opts.alpha ??= 0.5;
    opts.radius ??= 1;
    this.getNeighbors().forEach(key => Draw.point(PIXI.Point.invertKey(key), opts));
  }
}

export class ClockwiseSweepPathfindingWorld extends GraphPathfindingWorld {

  /** @type {number} */
  static get idleYield() { return CONFIG[MODULE_ID].clockwiseSweepPathfinding.idleYield || 0; }

  /** @type {number<pixels>} */
  static CORNER_OFFSET = 5;

  /** @type {number[]} */
  static TERRAIN_T_VALUES = [1/8, 0.5, 7/8];

  /**
   * Cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  cost(a, b) { return PIXI.Point.distanceBetween(a, b); }

  /**
   * Estimated cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  heuristic(a, b) { return PIXI.Point.distanceBetween(a, b); }

  /**
   * From a location on the canvas, construct the corresponding node.
   * @param {Point3d} pt
   * @returns {ClockwiseSweepPathfindingNode}
   */
  buildNode(pt3d) {
    const key = pt3d.key;
    if ( this.existingNodes.has(key) ) return this.existingNodes.get(key);
    const node = ClockwiseSweepPathfindingNode.create(pt3d, this.cornerMap, this.terrainPointGrid, this._sweepOpts);
    this.existingNodes.set(key, node);
    return node;
  }

  nodeIsUnreachable(node, fromPoint) {
    if ( !node.sweep.points.length ) return true;
    return !(node.sweep.contains(fromPoint.x, fromPoint.y)
      || node.getNeighbors(this.cornerMap, this.terrainPointGrid).size);
  }

  goalNode;

  /**
   * Did we reach the goal node?
   * Calculated from the current node perspective, in case one-way walls prevent moving from goal --> curr.
   * @param {Node} curr
   * @param {Node} goal
   */
  reachedGoal(curr, goalNode) {
    this.goalNode = goalNode;
    return curr.key === goalNode.key;
  }

  _sweepOpts = {
    type: "move",     /** @type {CONST.WALL_RESTRICTION_TYPES} */
    source: null,     /** @type {PointMovementSource} */
    addedEdges: [],   /** @type {Edge[]} */
  };

  /** @type {number} */
  get elevationZ() { return Math.round(this.token.bottomZ + ((this.token.topZ - this.token.bottomZ) * 0.5)); }

  /**
   * Initialize this world for a given path construction.
   * @param {Token} token     Token doing the movement
   */
  initialize(token) {
    super.initialize(token);
    const blockingTokens = ClockwiseCornerSweep.blockingTokens(token);
    this._sweepOpts.addedEdges = ClockwiseCornerSweep.tokenEdges(blockingTokens);
    this._sweepOpts.source = new foundry.canvas.sources.PointMovementSource({ object: token }); // See Token##getMovementSource
    this.existingNodes.clear();
  }

  startPathfinding(start) {
    this._sweepOpts.source.initialize(start); // See Token##getMovementSource
    super.startPathfinding(start);

    // Wipe previous node cache.
    this.existingNodes.clear();

    // For performance, precalculate the potential neighbors.
    this.cornerMap.clear();
    this._terrainPointKeys.clear();
    this.calculateCornerMap(start.z); // Token and edge corners.
    this.calculateTokenTerrainPoints(start.z);
    this.calculateRegionTerrainPoints(start.z);

    // Confirm that no terrain points are also blocking points.
    const cornerOffsetKeys = new Set(this.cornerMap.values().flatMap(obj => obj.offsetCornerKeys));
    for ( const key of this._terrainPointKeys ) {
      if ( cornerOffsetKeys.has(key) ) this._terrainPointKeys.delete(key);
    }

    // Store the terrain points in a grid for fast lookup.
    this.terrainPointGrid.clear();
    this._terrainPointKeys.forEach(key => this.terrainPointGrid.insertPoint(PIXI.Point.invertKey(key)));

    // Setup the starting node.
    start = this.buildNode(start);
    this.existingNodes.set(start.key, start); // 3d key.
  }

  cornerMap = new Map();

  _terrainPointKeys = new Set(); // TODO: Do we need to store this? Can terrainPointGrid suffice?

  terrainPointGrid = new UniformPointGrid();

  /**
   * Create a corner map for all edges on the canvas.
   * Used to identify neighboring positions for the sweep more quickly.
   * Maps corners identified by CWSweep to the offset corner points.
   * @returns {Map<PIXI.Point.key, CornerMapEntry>}       Corner keys mapped to offset corner points and edges.
   */
  calculateCornerMap(elevationZ) {
    let cornerFn;
    switch ( CONFIG[MODULE_ID].clockwiseSweepPathfinding.cornerGapType ) {
      case "v": cornerFn = offsetVCornersForEdges; break;
      case "edge": cornerFn = offsetEdgeCornersForEdges; break;
      default: cornerFn = offsetVCornersForEdges;
    }
    const edges = [...canvas.walls.placeables.map(w => w.edge), ...this._sweepOpts.addedEdges];
    return cornerFn(edges, elevationZ, this.constructor.CORNER_OFFSET, this.cornerMap);
  }

  /**
   * For each non-blocking token, determine its terrain points.
   * @returns {Set<PIXI.Point.key>}
   */
  calculateTokenTerrainPoints(elevationZ) {
    const blockingTokens = new Set(ClockwiseCornerSweep.blockingTokens(this.token));
    for ( const token of canvas.tokens.placeables ) {
      if ( token === this.token ) continue;
      if ( blockingTokens.has(token) ) continue;

      // Skip if not within the target elevation.
      if ( !elevationZ.between(token.bottomZ, token.topZ) ) continue;

      // Determine if the token is difficult terrain.
      const value = tokenTerrainValue(token, this.token);
      if ( value <= TERRAIN_FEATURES.NORMAL ) continue;

      // Use the constrained token border, expanded so the points are not on the token.
      this._addTerrainPointsForPolygon(token.constrainedTokenBorder);
    }
  }

  /**
   * For each terrain region, determine its terrain points.
   * @returns {Set<PIXI.Point.key>}
   */
  calculateRegionTerrainPoints(elevationZ) {
    for ( const region of canvas.regions.placeables ) {
      if ( !region.document.shapes.length ) continue;

      // Skip if not within the target elevation.
      if ( !elevationZ.between(region.bottomZ, region.topZ) ) continue;

      // Determine if the region is difficult terrain.
      const value = regionTerrainValue(region, this.token);
      if ( value <= TERRAIN_FEATURES.NORMAL ) continue;

      // Get the region border, padded so the points are not in the region.
      const geom = region[GEOMETRY_LIB_ID]?.[GEOMETRY_ID];
      if ( !geom || !geom.faces.top.length ) continue;
      const top2d = geom.faces.top.toPolygon2d(); // For region, could be a Polygon3d or a Polygons3d.
      if ( Array.isArray(top2d) ) {
        for ( const poly of top2d ) this._addTerrainPointsForPolygon(poly, top.isHole);
      } else this._addTerrainPointsForPolygon(top2d, top.isHole);
    }
  }

  _addTerrainPointsForPolygon(poly, isHole = false) {
    const terrainPointKeys = this._terrainPointKeys;
    poly = poly.clone().pad(this.constructor.CORNER_OFFSET * (isHole ? -1 : 1));
    using polyCenter = PIXI.Point.fromObject(poly.center);
    using pt = PIXI.Point.tmp;
    for ( const edge of poly.iterateEdges({ close: true }) ) {
      for ( const t of this.constructor.TERRAIN_T_VALUES ) {
        edge.a.projectToward(edge.b, t, pt);

        // Don't add if there is a collision between the point and the polygon center.
        // Usually due to token against wall.
        if ( CONFIG[MODULE_ID].sceneGraph.hasCollision(pt, polyCenter, this.token) ) continue;
        terrainPointKeys.add(pt.key);
      }
    }
  }

  /**
   * Track existing sweep polygons.
   * Don't draw a new gap point if another sweep already contains it.
   * @type {Map<node.key, node>}
   */
  existingNodes = new Map();

  /**
   * Determine where we can move to from this node.
   * Any pixel within the node sweep is potentially available.
   * Trim to existing nodes within the sweep or gap points that are not covered elsewhere.
   * @param {Node} node
   * @returns {Node[]}  BigInt key for 3d point.
   */
  adjacentOffsets(node) {
    const nodeKey = node.key;
    if ( typeof nodeKey === "undefined" ) console.error("Node key must be defined.");
    if ( !(node instanceof ClockwiseSweepPathfindingNode) ) console.error("Node must be ClockwiseSweepPathfindingNode.");

    // Retrieve all 2d neighbor keys for this node.
    const neighborKeys = node.getNeighbors(this.cornerMap, this.terrainPointGrid);

    // Convert each to a node.
    using pt2d = PIXI.Point.tmp;
    using pt3d = ElevatedPoint.tmp;
    pt3d.z = node.z;
    const neighbors = [...neighborKeys].map(key2d => {
      PIXI.Point.invertKey(key2d, pt2d);
      pt3d.x = pt2d.x;
      pt3d.y = pt2d.y;
      return this.buildNode(pt3d);
    });

    // If the end point is contained within the sweep, it is a neighbor.
    // Important so the end is prioritized but not placed ahead of nodes that have a
    // better score, such as avoiding difficult terrain (where going straight to goal would
    // just punch through the terrain).
    if ( node.sweep.contains(this.goalNode.x, this.goalNode.y) ) neighbors.push(this.goalNode);
    return neighbors;
  }

  /**
   * Filter the neighbors for this node, keeping only valid neighbors.
   * @param {Set<number>} neighbors    Neighbors to the originating node, by 3d key
   * @param {Node} node           The originating node
   * @returns {Node[]}
   */
  /*
  filterNeighbors(neighborKeys, node) {
    // TODO: Need to test containment within this node sweep? Move test from adjacentOffsets?
    // Other checks for the neighbors such as collision (which we would prefer to avoid)?
  }
  */

  drawNode(node, opts = {}) {
    super.drawNode(node, opts);

    if ( !node.drawn ) {
      const color = randomColor();
      node.drawShape({ fill: color, });
      node.drawNeighbors({ color });
      node.drawn = true;
    }
  }

  _clearNodeDrawnState() { this.world.existingNodes.values().forEach(node => node.drawn = false); }

  /**
   * Maximum number of iterations given a start and end coordinate.
   * Used to stop if no path.
   * @param {Node} start
   * @param {Node} goal
   * @returns {number}
   */
  static maxIterations(_start, _goal) {
    // Challenging to estimate. Maximum would be the total number of pixels.
    // The reality is much less, but highly dependent on number of walls.
    // Each wall has max 1 or 2 per endpoint for clockwiseSweepCornerGapType "v"|"edge".
    const numPerEndpoint = CONFIG[MODULE_ID].clockwiseSweepPathfinding.cornerGapType === "v" ? 1 : 2;
    const maxOffsetWalls = canvas.walls.placeables.length * numPerEndpoint * 2;

    // More would be added per token and per region.
    // Estimate 12 per token.
    const maxOffsetTokens = canvas.tokens.placeables.length * 12;

    // Regions are harder, but at least as many as tokens.
    // (Would need to consider circumference/perimeter to estimate better.)
    const maxOffsetRegions = canvas.regions.placeables.length * 24;

    // Number of iterations dependent on number of backsteps, but each node should only
    // be visited once at most.
    const maxOffsetCorners = maxOffsetWalls + maxOffsetTokens + maxOffsetRegions;
    return Math.min(Math.max(maxOffsetCorners, 100), 10000);
  }

}

function randomColor() {
  const colors = Object.values(Draw.COLORS);
  return colors[Math.floor(Math.random() * colors.length)];
}

// ---- NOTE: World builder ----- //

// TODO: Eventually tie this to Settings or CONFIG and rebuild the class only when settings/CONFIG change.

/**
 * For the current configuration settings, build a pathfinding world class for the path
 * algorithm to use.
 * @returns {AbstractGridPathfindingWorld}
 */
// Simple cache of the collision world classes, to facilitate instanceof for the world class.
const worldClassCache = new Map();

export function worldBuilderClockwise({ cost, use3d, heuristic } = {}) {
  const pathCfg = CONFIG[MODULE_ID].clockwiseSweepPathfinding;
  use3d ??= pathCfg.use3d;
  cost ??= pathCfg.cost;
  heuristic ??= pathCfg.heuristic;

  const key = [cost, use3d, heuristic].join(".");
  if ( worldClassCache.has(key) ) return worldClassCache.get(key);

  let costCl;
  let heuristicCl;
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

  const classes = [costCl, heuristicCl];
  const out = mix(ClockwiseSweepPathfindingWorld).with(...classes);
  worldClassCache.set(key, out);
  return out;
}


/** Testing
  Draw.point(sweep.origin, { color: Draw.COLORS.blue })
  Draw.shape(sweep)
  sweep.cornersEncountered.forEach(key => Draw.point(PIXI.Point.invertKey(key)))

  gapEdges.forEach(edge => Draw.segment(edge, { color: Draw.COLORS.yellow }))
  gapPoints.forEach(pt => Draw.point(pt, { color: Draw.COLORS.blue, radius: 2 }))

  Draw = CONFIG.GeometryLib.lib.Draw;
  GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
  api = game.modules.get("elevationruler").api
  let { ClockwiseSweepPathfindingNode,
        ClockwiseSweepPathfindingWorld } = api.pathfinding;

  let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
  let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

  start = GridCoordinates3d.fromObject(randal.center)
  end = GridCoordinates3d.fromObject(zanna.center)

  node = ClockwiseSweepPathfindingNode.fromObject(start);
  node.computeSweep()
  node.calculateGapPoints()
  node.drawShape({ fillAlpha: 0.2, fill: Draw.COLORS.blue })
  node.drawGapEdges({ color: Draw.COLORS.blue })
  node.drawGapPoints({ color: Draw.COLORS.blue })

|1750,2750 --> 1150,2450

AbstractPathfinder.js:111 Pathfinder s5xBDtwYrZk09IvV|{x: 1650, y: 2750, z: 0} --> {x: 1950, y: 2650, z: 0} path has collision at 1:
	{x: 1650, y: 2750, z: 0}
	{x: 2001.1313708498985, y: 2700.8485281374237, z: 0}
	{x: 1950, y: 2650, z: 0}

*/
