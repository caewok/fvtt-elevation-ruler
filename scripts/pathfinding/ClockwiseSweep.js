/* globals
canvas,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";
import { ObstacleOcclusionTest } from "../geometry/ObstacleOcclusionTest.js";

// Extensions to Clockwise Sweep

/**
 * Extend Clockwise Sweep to add additional edges (e.g., token borders) via config.
 */
export class ObstacleSweep extends foundry.canvas.geometry.ClockwiseSweepPolygon {
  /**
   * Add to the edge set any added edges from the config that are within bounds for this sweep.
   */
  _identifyEdges() {
    super._identifyEdges();
    if ( !this.config.addedEdges ) return;

    // Include only edges that intersect the bounding box.
    const bbox = this.config.boundingBox;
    for ( const edge of this.config.addedEdges ) {
      if ( bbox.lineSegmentIntersects(edge.a, edge.b, { inside: true }) ) this.edges.add(edge);
    }
  }

  static identifyBlockingTokenEdges(subjectToken) {
    // Add token edges. Must be temporary wall edges.
    const PATHFINDING = Settings.KEYS.PATHFINDING;
    const blocking = Settings.get(PATHFINDING.TOKENS_BLOCK);
    const blockingCfg = {
      dead: false,
      live: blocking !== PATHFINDING.TOKENS_BLOCK_CHOICES.NO,
      prone: false,
      enemies: blocking !== PATHFINDING.TOKENS_BLOCK_CHOICES.NO,
      allies: blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.ALL,
    };
    const occlusionCfg = { blockingCfg, subjectToken };
    const Edge = foundry.canvas.geometry.edges.Edge;
    const edges = [];
    for ( const token of canvas.tokens.placeables ) {
      if ( !ObstacleOcclusionTest.includeToken(token, occlusionCfg) ) continue;
      for ( const edge of token.constrainedTokenBorder.iterateEdges({ closed: false }) ) {
        edges.push(new Edge(edge.a, edge.b, {
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
}

/**
 * Extend Clockwise Sweep to track when the sweep hits wall corners.
 */
export class ClockwiseCornerSweep extends ObstacleSweep {
  /**
   * Corners are when the sweep hits a non-limited wall
   * and must extend the sweep beyond that point.
   * In addition, corners where the walls simply continue are ignored
   * @type {Point[]}
   */
  cornersEncountered = new Set();

  /**
   * "Edges" or walls encountered. Added if the wall forms part of the polygon.
   * @type {Set<Wall>}
   */
  edgesEncountered = new Set();

  /** @type {object} */
  sweepOpts = {};

  /** @inheritdoc */
  _compute() {
    this.cornersEncountered.clear();
    super._compute();
  }

  _switchEdge(result, activeEdges) {
    this.cornersEncountered.add(result.target.key);
    super._switchEdge(result, activeEdges);
  }

  addPoint(point) {
    super.addPoint(point);
    if ( !Object.hasOwn(point, "cwEdges") ) return; // If calling simply "addPoint", ignore the rest.

    // Super will skip repeated points, which really should not happen in sweep.
    // const l = this.points.length;
    // if ( (x === this.points[l-2]) && (y === this.points[l-1]) ) return this;
    point.cwEdges.forEach(edge => this.edgesEncountered.add(edge));
  }
}

/**
 * Extend Clockwise Sweep to track when the sweep hits wall corners.
 */
export class ClockwiseCornerGapSweep extends ObstacleSweep {

  /**
   * Vertex encountered at the gap
   * @type {PolygonVertex[]}
   */
  cornerGapsEncountered = [];

  /** @type {object} */
  sweepOpts = {};

  /** @inheritdoc */
  _compute() {
    this.cornerGapsEncountered.length = 0;
    super._compute();
  }

  _switchEdge(result, activeEdges) {
    this.cornerGapsEncountered.push(result.target);
    super._switchEdge(result, activeEdges);
  }
}

/**
 * Extend Clockwise Sweep to identify corners and then get the point at the "V" of each corner.
 * The point extends out from the V by a set number of pixels.
 * If a single wall, the point extends in line with the wall:  ––– •
 * If walls inside the V that connect at the same point, only the outside edges control:
 *  \ | /
 *   \|/
 *
 *    •
 * Note how the point aligns with the bisector of the outer-most edges for the corner.
 */
export class ClockwiseCornerVSweep extends ObstacleSweep {

  /** @type {number} */
  static CORNER_OFFSET = 20; // Number of pixels

  offsetCorners = new Set();

  /**
   * Corners are when the sweep hits a non-limited wall
   * and must extend the sweep beyond that point.
   * In addition, corners where the walls simply continue are ignored
   * @type {Point[]}
   */
  cornersEncountered = new Set();

  /**
   * "Edges" or walls encountered. Added if the wall forms part of the polygon.
   * @type {Set<Wall>}
   */
  edgesEncountered = new Set();

  /** @type {object} */
  sweepOpts = {};

  /** @inheritdoc */
  _compute() {
    this.cornersEncountered.clear();
    super._compute();
  }

  _switchEdge(result, activeEdges) {
    const CORNER_OFFSET = this.constructor.CORNER_OFFSET;
    const CORNER_OFFSET2 = CORNER_OFFSET ** 2;
    using vertex = PIXI.Point.tmp.set(result.target.x, result.target.y);
    const vertexKey = result.target.key;

    // TODO: Use cwEdges and ccwEdges along with nw and se to identify endpoints without key comparison?
    switch ( result.target.edges.size ) {
      case 0: break;

      case 1: {
        // Single edge; move out from the endpoint that is at this result away from the other endpoint.
        const edge = result.target.edges.first();
        const a = edge.b.key === vertexKey ? edge.a : edge.b;
        const offsetCorner = vertex.towardsPointSquared(a, -CORNER_OFFSET2);
        this.offsetCorners.add(offsetCorner.key);
        break;
      }

      case 2: {
        // Locate bisector between the two edges and extend from there.
        const [edge0, edge1] = [...result.target.edges];
        const a = edge0.a.key === vertexKey ? edge0.b : edge0.a;
        const c = edge1.a.key === vertexKey ? edge1.b : edge1.b;
        const biV = bisectingVector(a, vertex, c);
        biV.multiplyScalar(-CORNER_OFFSET, biV);
        const offsetCorner = vertex.add(biV);
        this.offsetCorners.add(offsetCorner.key);
      }

      default: {
        // Multiple edges; locate the outer edges.
        const res = findOutermostVEdges(result.target.edges, result.target); // Faster to use result.target b/c it stores its key.
        const biV = bisectingVector(res.ccw, vertex, res.cw);
        biV.multiplyScalar(-CORNER_OFFSET, biV);
        const offsetCorner = vertex.add(biV);
        this.offsetCorners.add(offsetCorner.key);
      }
    }

    this.cornersEncountered.add(result.target.key);
    super._switchEdge(result, activeEdges);
  }

  addPoint(point) {
    super.addPoint(point);
    if ( !Object.hasOwn(point, "cwEdges") ) return; // If calling simply "addPoint", ignore the rest.

    // Super will skip repeated points, which really should not happen in sweep.
    // const l = this.points.length;
    // if ( (x === this.points[l-2]) && (y === this.points[l-1]) ) return this;
    point.cwEdges.forEach(edge => this.edgesEncountered.add(edge));
  }
}

/**
 * For angle formed by a|v|c, calculate the vector that bisects the two segments at v.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} v
 * @param {PIXI.Point} c
 * @returns {PIXI.Point} The directional vector, normalized.
 */
function bisectingVector(a, v, c) {
  // Normalized vectors relative to v.
  using deltaAV = a.subtract(v);
  using deltaCV = c.subtract(v);
  deltaAV.normalize(deltaAV);
  deltaCV.normalize(deltaCV);

  // Determine the bisecting direction.
  const out = deltaAV.add(deltaCV);

  // If collinear, point back to a.
  if ( out.x.almostEqual(0) && out.y.almostEqual(0) ) return deltaAV;
  out.normalize(out);
  return out;
}

/**
 * Given array or set of segments, find the shared vertex between the first two.
 * Assumes without testing that there is one; otherwise returns the second endpoint of the first segment.
 * @param {Set<Segment>|Segment[]} segments
 * @returns {PIXI.Point}
 */
export function _sharedVertex(segments) {
  const iter = segments.values();
  const edge0 = iter.next().value;
  const edge1 = iter.next().value;
  return edge0.a.key === edge1.a.key ? edge0.a
    : edge0.a.key === edge1.b.key ? edge0.a : edge0.b;
}

/**
 * Identifies the two outermost segments from a collection sharing vertex v.
 * @param {Set<Segment>|Segment[]} segments
 * @param {PIXI.Point} vertex            Shared vertex
 * @returns {object}
 *   - @prop {PIXI.Point} ccw
 *   - @prop {PIXI.Point} cw
 */
function findOutermostVEdges(segments, vertex) {
  const vertexKey = vertex.key;
  const iter = segments.values();
  const first = iter.next().value;

  // If no segments, return the vertex.
  if ( !first ) return { ccw: vertex, cw: vertex };

  // Test each subsequent segment in turn.
  // Positive orientation: a -> b -> c is ccw. Negative is cw.
  // If only 1 segment, ccw and cw will both be a.
  const a = first.a.key === vertexKey ? first.b : first.a;
  const orient2d = foundry.utils.orient2dFast;
  let ccw = a;
  let cw = a;
  for ( const next of iter ) {
    const b = next.a.key === vertexKey ? next.b : next.a;
    if ( orient2d(vertex, ccw, b) > 0 ) ccw = b;
    else if ( orient2d(vertex, cw, b) < 0 ) cw = b;
  }
  return { ccw, cw };
}

/**
 * Find the closest clockwise edge from a fan of edges that share a vertex,
 * in relation to a viewing point.
 * All edges must be the same relative orientation (clockwise or counterclockwise) from origin
 * based on vertex.
 * @param {PIXI.Point} origin
 * @param {PIXI.Point} vertex            Shared vertex
 * @param {Set<Segment>|Segment[]} segments
 * @returns {PIXI.Point}
 */
function closestEdgePoint(origin, vertex, segments) {
  const iter = segments.values();
  const vertexKey = vertex.key;
  let closest = iter.next().value;
  if ( !closest ) return null;

  // Compare each segment in turn
  const orient2d = foundry.utils.orient2dFast;
  closest = closest.a.key === vertexKey ? closest.b : closest.a;
  let oClosest = Math.abs(orient2d(vertex, closest, origin));
  for ( const next of iter ) {
    const b = next.a.key === vertexKey ? next.b : next.a;
    const oNext = Math.abs(orient2d(vertex, b, origin));
    if ( oNext < oClosest ) {
      closest = b;
      oClosest = oNext;
    }
  }
  return closest;
}

/**
 * Extend Clockwise Sweep to identify corners and then get the point that extends the line
 * at each corner.
 * Unlike the above version, this one does not rely on knowledge beyond that of viewable
 * walls, but ends up creating multiple points.
 *  \ | /
 *   \|/
 *
 *   • •
 * Note how the points align with the outer edges.
 */
export class ClockwiseCornerVisibleEdgeSweep extends ObstacleSweep {

  /** @type {number} */
  static CORNER_OFFSET = 20; // Number of pixels

  offsetCorners = new Set();

  /**
   * Corners are when the sweep hits a non-limited wall
   * and must extend the sweep beyond that point.
   * In addition, corners where the walls simply continue are ignored
   * @type {Point[]}
   */
  cornersEncountered = new Set();

  /**
   * "Edges" or walls encountered. Added if the wall forms part of the polygon.
   * @type {Set<Wall>}
   */
  edgesEncountered = new Set();

  /** @type {object} */
  sweepOpts = {};

  /** @inheritdoc */
  _compute() {
    this.cornersEncountered.clear();
    super._compute();
  }

  _switchEdge(result, activeEdges) {
    const CORNER_OFFSET2 = this.constructor.CORNER_OFFSET ** 2;
    using vertex = PIXI.Point.tmp.set(result.target.x, result.target.y);

    // Find the closest clockwise edge.
    if ( result.target.cwEdges.size && result.target.ccwEdges.size ) console.error("_switchEdge should have either cwEdges or ccwEdge but not both.");


    const edges = result.target.cwEdges.size ? result.target.cwEdges : result.target.ccwEdges;
    const closest = closestEdgePoint(this.origin, result.target, edges);

    // Move along the closest edge away from the vertex and the other endpoint, into the gap.
    const offsetCorner = vertex.towardsPointSquared(closest, -CORNER_OFFSET2);
    this.offsetCorners.add(offsetCorner.key);

    this.cornersEncountered.add(result.target.key);
    super._switchEdge(result, activeEdges);
  }

  addPoint(point) {
    super.addPoint(point);
    if ( !Object.hasOwn(point, "cwEdges") ) return; // If calling simply "addPoint", ignore the rest.

    // Super will skip repeated points, which really should not happen in sweep.
    // const l = this.points.length;
    // if ( (x === this.points[l-2]) && (y === this.points[l-1]) ) return this;
    point.cwEdges.forEach(edge => this.edgesEncountered.add(edge));
  }
}

/**
 * From a Clockwise sweep, for each corner, get the point at the "V" of each corner.
 * The point extends out from the V by a set number of pixels.
 * If a single wall, the point extends in line with the wall:  ––– •
 * If walls inside the V that connect at the same point, only the outside edges control:
 *  \ | /
 *   \|/
 *
 *    •
 * Note how the point aligns with the bisector of the outer-most edges for the corner.
 *
 * @param {PolygonVertex[]} cornerResults       Corner vertex data from the sweep
 * @param {number}[offset=2]                    How far away from the corner to set the offset.
 * @returns {Set<number>} The offset corner points, stored as keys in the set.
 */
export function offsetVCorners(cornerResults, offset = 2) {
  const offset2 = offset ** 2;
  const vertexKey = corner.key
  using vertex = PIXI.Point.tmp.set(cornerResults.x, cornerResults.y);
  const nCorners = cornerResults.length;
  const offsetCorners = new Set(); // Possible but unlikely that multiple corners would be present.
  for ( let i = 0; i < nCorner; i += 1 ) {
    const corner = cornerResults[i];
    vertex.set(corner.x, corner.y);
    switch ( corner.edges.size ) {
      case 0: console.warn("offsetVCorners should have at least one edge."); break;
      case 1: {
        // Single edge; move out from the endpoint that is at this result away from the other endpoint.
        const edge = corner.edges.first();
        const a = edge.b.key === vertexKey ? edge.a : edge.b;
        const offsetCorner = vertex.towardsPointSquared(a, -offset2);
        offsetCorners.add(offsetCorner.key);
        break;
      }
      case 2: {
        // Locate bisector between the two edges and extend from there.
        const [edge0, edge1] = [...corner.edges];
        const a = edge0.a.key === vertexKey ? edge0.b : edge0.a;
        const c = edge1.a.key === vertexKey ? edge1.b : edge1.b;
        const biV = bisectingVector(a, vertex, c);
        biV.multiplyScalar(-offset, biV);
        const offsetCorner = vertex.add(biV);
        offsetCorners.add(offsetCorner.key);
      }
      default: {
        // Multiple edges; locate the outer edges.
        const res = findOutermostVEdges(corner.edges, corner); // Faster to use result.target b/c it stores its key.
        const biV = bisectingVector(res.ccw, vertex, res.cw);
        biV.multiplyScalar(-offset, biV);
        const offsetCorner = vertex.add(biV);
        offsetCorners.add(offsetCorner.key);
      }
    }
  }
  return offsetCorners;
}

/**
 * From a Clockwise sweep, for each corner, get the point that extends the line at each corner.
 * Unlike the above version, this one does not rely on knowledge beyond that of viewable
 * walls, but ends up creating multiple points.
 *  \ | /
 *   \|/
 *
 *   • •
 * Note how the points align with the outer edges.
 * @param {PolygonVertex[]} cornerResults       Corner vertex data from the sweep
 * @param {PIXI.Point} origin                   Sweep origin
 * @param {number}[offset=2]                    How far away from the corner to set the offset.
 * @returns {Set<number>} The offset corner points, stored as keys in the set.
 */
export function offsetEdgeCorners(cornerResults, origin, offset = 2) {
  const cornerResults = sweep.cornersEnc

  const offset2 = offset ** 2;
  const vertexKey = corner.key
  using vertex = PIXI.Point.tmp.set(cornerResults.x, cornerResults.y);
  const nCorners = cornerResults.length;
  const offsetCorners = new Set(); // Possible but unlikely that multiple corners would be present.
  for ( let i = 0; i < nCorner; i += 1 ) {
    const corner = cornerResults[i];
    vertex.set(corner.x, corner.y);

    // Find the closest clockwise edge.
    if ( corner.cwEdges.size && corner.ccwEdges.size ) console.warn("offsetEdgeCorners|corner should have either cwEdges or ccwEdge but not both.");
    const edges = corner.cwEdges.size ? corner.cwEdges : corner.ccwEdges;
    const closest = closestEdgePoint(origin, corner, edges);

    // Move along the closest edge away from the vertex and the other endpoint, into the gap.
    const offsetCorner = vertex.towardsPointSquared(closest, -offset2);
    this.offsetCorners.add(offsetCorner.key);
  }
  return offsetCorners;
}

/**
 * From a clockwise sweep, locate points along the gap as it jumps from a corner to
 * next edge.
 *
 * ----- • •  •|
 *
 * @param {PolygonVertex[]} cornerResults       Corner vertex data from the sweep
 * @param {PIXI.Point} origin                   Sweep origin
 * @param {number}[offset=2]                    How far away from the corner to set the offset.
 * @returns {Set<number>} The offset corner points, stored as keys in the set.
 */
export function offsetGapCorners(sweep, offset = 2) {
  const offset2 = offset ** 2;
  const iter = sweep.iteratePoints({ close: true });
  let prev = iter.next().value;
  let curr = iter.next().value;
  using nearPoint = PIXI.Point.tmp;
  using midPoint = PIXI.Point.tmp;
  const gapPoints = new Set();
  // Debug: const gapEdges = [];
  for ( const next of iter ) {
    if ( typeof curr.key === "undefined" ) console.error("Gap curr key undefined", { curr });
    if ( sweep.cornersEncountered.has(curr.key) ) {
      // Identify the far gap edge point and the correct normal.

      // Origin --> curr -> prev; or
      // Origin --> curr -> next
      const b = foundry.utils.orient2dFast(sweep.origin, curr, prev).almostEqual(0) ? prev : next;
      if ( foundry.utils.orient2dFast(sweep.origin, curr, prev).almostEqual(0) ) b = prev;

      // Near point: step slightly along view line from current.
      // Far point: step slightly along view line from prev/next.
      // Mid point: midway between curr, prev/next.
      curr.towardsPointSquared(b, offset2, nearPoint);
      b.towardsPointSquared(curr, offset2, farPoint);
      PIXI.Point.midPoint(curr, b, midPoint);
      gapPoints.add(nearPoint.key, midPoint.key, farPoint.key);
      // Debug: gapEdges.push({ a: curr, b });

    }
    prev.release();
    prev = curr;
    curr = next;
  }
  prev.release();
  curr.release();
  return gapPoints;
}
