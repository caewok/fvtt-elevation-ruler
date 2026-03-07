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
  return edge0.a.key === edge1.a.key || edge0.a.key === edge1.b.key ? edge0.a : edge0.b;
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
 * Test if group of segments form a "V".
 * Reject if they form a line or otherwise create a reflex/circular shape (>180º).
 * @param {Set<Segment>|Segment[]} segments
 * @param {PIXI.Point} vertex            Shared vertex
 * @returns {object|null} Null if less than two edges or if circular.
 *   - @prop {PIXI.Point} ccw
 *   - @prop {PIXI.Point} cw
 */
function formsV(segments, vertex) {
  if ( (segments.size || segments.length) < 2 ) return null;
  const { ccw, cw } = findOutermostVEdges(segments, vertex);

  // If ccw and cw are the same, it is a thin V.
  if ( ccw.equals(cw) ) return null;

  // Check orientation of the outer boundaries relative to the vertex.
  // > 0: CCW is left of the line (vertex -> CW). Is < 180º.
  // <= 0: Straight line (0) or reflect/wrap-around shape.
  if ( foundry.utils.orient2dFast(vertex, cw, ccw) <= 0 ) return null;
  return { ccw, cw };
}

/**
 * Find the facing clockwise edge from a fan of edges that share a vertex,
 * in relation to a viewing point.
 * All edges must be the same relative orientation (clockwise or counterclockwise) from origin
 * based on vertex.
 * @param {PIXI.Point} origin
 * @param {PIXI.Point} vertex            Shared vertex
 * @param {Set<Segment>|Segment[]} segments
 * @returns {PIXI.Point}
 */
function facingEdgePoint(origin, vertex, segments) {
  // Similar logic to findOutermostVEdges except looking for the edge next to vertex --> origin.
  const { ccw, cw } = findOutermostVEdges(segments, vertex);

  // Determine which of the two boundary points is "further" from the origin
  // by checking orientation relative to the line (vertex -> origin).
  // If ccw is more counter-clockwise than the origin, then cw is the "facing" point.
  return foundry.utils.orient2dFast(vertex, origin, ccw) > 0 ? cw : ccw;
}

/**
 * For a set of edges, get the point at the "V" of each acute corner.
 * The point extends out from the V by a set number of pixels.
 * If a single wall, the point extends in line with the wall:  ––– •
 * If walls inside the V that connect at the same point, only the outside edges control:
 *  \ | /
 *   \|/
 *
 *    •
 * Note how the point aligns with the bisector of the outer-most edges for the corner.
 *
 * @param {Edge[]} edges                        Edges to test
 * @param {number}[offset=2]                    How far away from the corner to set the offset.
 * @returns {Set<number>} The offset corner points, stored as keys in the set.
 */
function offsetVCornersForEdges(edges, offset = 2 ) {
  edges ??= canvas.walls.placeables.map(w => w.edge);
  const offset2 = offset ** 2;

  // Create a map of all edge endpoints to their edges.
  const cornerMap = new Map();
  for ( const edge of edges ) {
    _processEndpoint(edge.a, edge, cornerMap);
    _processEndpoint(edge.b, edge, cornerMap);
  }

  // Identify corners
  // Single edge: extend from endpoints.
  // Two edges: use the bisector
  // 3+ edges: use the bisector from the outermost edges.
  for ( const [cornerKey, value] of cornerMap.entries() ) {
    if ( !value.edges.size ) console.error("Every corner should have at least one edge.");
    let offsetCorner;
    const vertex = PIXI.Point.invertKey(cornerKey);
    if ( value.edges.size === 1 ) {
      const edge = value.edges.first();
      const a = edge.b.key === cornerKey ? edge.a : edge.b;
      offsetCorner = _vOffsetSingleEdge(a, vertex, offset);
    } else {
      const res = formsV(value.edges, vertex);
      if ( !res ) continue;
      offsetCorner = _vOffsetTwoEdges(res.ccw, res.cw, vertex, offset)
    }
    value.offsetCornerKey = offsetCorner.key
  }
  return cornerMap;
}

/*
console.time("offsetVCorners")
cornerMap = offsetVCornersForEdges(undefined, 20)
console.timeEnd("offsetVCorners")
cornerMap.keys().forEach(key => Draw.point(PIXI.Point.invertKey(key)))
cornerMap.values().forEach(v => Draw.point(PIXI.Point.invertKey(v.offsetCornerKey), { color: Draw.COLORS.blue }))

*/

function _processEndpoint(a, edge, cornerMap) {
  const key = a.key;
  const value = cornerMap.get(key) ?? { edges: new Set(), offsetCornerKey: -1 };
  if ( !cornerMap.has(key) ) cornerMap.set(key, value);
  value.edges.add(edge);
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
export function offsetVCorners(sweep, offset = 2) {
  const cornerResults = sweep.cornerGapsEncountered;
  const offset2 = offset ** 2;
  using vertex = PIXI.Point.tmp;
  const nCorners = cornerResults.length;
  const offsetCorners = new Set(); // Possible but unlikely that multiple corners would be present.
  for ( let i = 0; i < nCorners; i += 1 ) {
    const corner = cornerResults[i];
    vertex.set(corner.x, corner.y);
    const offsetCorner = _vOffsetForCornerEdges(vertex, corner.edges, offset);
    offsetCorners.add(offsetCorner.key);
  }
  return offsetCorners;
}



/**
 * Helper for offsetVCorners.
 * For given set of edges that form a "V", returns the offset from the "V".
 * @param {PIXI.Point} vertex
 * @param {Set<Edge>} cornerEdges
 * @param {number} [offset=20]
 * @returns {PIXI.Point}
 */
function _vOffsetForCornerEdges(vertex, cornerEdges, offset = 2) {
  const vertexKey = vertex.key;
  switch ( cornerEdges.size ) {
    case 0: console.warn("offsetVCorners should have at least one edge."); break;
    case 1: {
      // Single edge; move out from the endpoint that is at this result away from the other endpoint.
      const edge = cornerEdges.first();
      const a = edge.b.key === vertexKey ? edge.a : edge.b;
      return _vOffsetSingleEdge(a, vertex, offset);
    }
    case 2: {
      // Locate bisector between the two edges and extend from there.
      const [edge0, edge1] = [...cornerEdges];
      const a = edge0.a.key === vertexKey ? edge0.b : edge0.a;
      const c = edge1.a.key === vertexKey ? edge1.b : edge1.a;
      return _vOffsetTwoEdges(a, c, vertex, offset)
    }
    default: {
      // Multiple edges; locate the outer edges then treat like case 2.
      const res = findOutermostVEdges(cornerEdges, vertex); // Faster to use result.target b/c it stores its key.
      return _vOffsetTwoEdges(res.ccw, res.cw, vertex, offset)
    }
  }
}

function _vOffsetSingleEdge(a, vertex, offset = 2) {
  return vertex.towardsPointSquared(a, -(offset ** 2));
}

function _vOffsetTwoEdges(a, c, vertex, offset = 2) {
  const biV = bisectingVector(a, vertex, c);
  biV.multiplyScalar(-offset, biV);
  return vertex.add(biV);
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
export function offsetEdgeCorners(sweep, offset = 2) {
  const cornerResults = sweep.cornerGapsEncountered;
  const origin = sweep.origin;
  const offset2 = offset ** 2;
  using vertex = PIXI.Point.tmp;
  const nCorners = cornerResults.length;
  const offsetCorners = new Set(); // Possible but unlikely that multiple corners would be present.
  for ( let i = 0; i < nCorners; i += 1 ) {
    const corner = cornerResults[i];
    vertex.set(corner.x, corner.y);

    // Find the closest clockwise edge.
    if ( corner.cwEdges.size && corner.ccwEdges.size ) console.warn("offsetEdgeCorners|corner should have either cwEdges or ccwEdge but not both.");
    const edges = corner.cwEdges.size ? corner.cwEdges : corner.ccwEdges;
    const closest = facingEdgePoint(origin, corner, edges);

    // Move along the closest edge away from the vertex and the other endpoint, into the gap.
    const offsetCorner = vertex.towardsPointSquared(closest, -offset2);
    offsetCorners.add(offsetCorner.key);
  }
  return offsetCorners;
}

/**
 * From a clockwise sweep, locate points along the gap as it jumps from a corner to
 * next edge.
 *
 * ----- • •  •|
 *
 * To be valid, the points must be rounded such that they are within the sweep.
 * @param {PolygonVertex[]} cornerResults       Corner vertex data from the sweep
 * @param {PIXI.Point} origin                   Sweep origin
 * @param {number}[offset=2]                    How far away from the corner to set the offset.
 * @returns {Set<number>} The offset corner points, stored as keys in the set.
 */
export function offsetGapCorners(sweep, offset = 2) {
  const cornersEncountered = new Set(sweep.cornerGapsEncountered.map(v => v.key));
  const offset2 = offset ** 2;
  const iter = sweep.iteratePoints({ close: true });
  let prev = iter.next().value;
  let curr = iter.next().value;
  using nearPoint = PIXI.Point.tmp;
  using midPoint = PIXI.Point.tmp;
  using farPoint = PIXI.Point.tmp;
  using dir = PIXI.Point.tmp;
  const gapPoints = new Set();
  // Debug: const gapEdges = [];
  for ( const next of iter ) {
    if ( typeof curr.key === "undefined" ) console.error("Gap curr key undefined", { curr });
    if ( cornersEncountered.has(curr.key) ) {
      // Identify the far gap edge point and the correct normal.

      // Origin --> curr -> prev; or
      // Origin --> curr -> next
      const b = foundry.utils.orient2dFast(sweep.origin, curr, prev).almostEqual(0) ? prev : next;

      // Near point: step slightly along view line from current.
      // Far point: step slightly along view line from prev/next.
      // Mid point: midway between curr, prev/next.
      curr.towardsPointSquared(b, offset2, nearPoint);
      b.towardsPointSquared(curr, offset2, farPoint);
      PIXI.Point.midPoint(curr, b, midPoint);

      // Round the points so they remain within the sweep.
      b.subtract(curr, dir);
      if ( b === prev ) dir.set(dir.y, -dir.x);
      else dir.set(-dir.y, dir.x);
      const quadrant = (dir.x > 0) + ((dir.y > 0) * 2);
      let xFn;
      let yFn;
      switch ( quadrant ) {
        case 0:   // Dir: -x, -y
          xFn = "floor";
          yFn = "floor";
          break;
        case 1: // Dir: x, -y
          xFn = "ceil";
          yFn = "floor";
          break;
        case 2: // Dir: -x, y
          xFn = "floor";
          yFn = "ceil";
          break;
        case 3: // Dir: x, y
          xFn = "ceil";
          yFn = "ceil";
      }
      nearPoint.x = Math[xFn](nearPoint.x);
      nearPoint.y = Math[yFn](nearPoint.y);
      midPoint.x = Math[xFn](midPoint.x);
      midPoint.y = Math[yFn](midPoint.y);
      farPoint.x = Math[xFn](farPoint.x);
      farPoint.y = Math[yFn](farPoint.y);

      gapPoints.add(nearPoint.key);
      gapPoints.add(midPoint.key);
      gapPoints.add(farPoint.key);
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
