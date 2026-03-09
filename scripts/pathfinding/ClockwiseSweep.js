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

  static tokenEdges(tokens) {
    tokens ??= canvas.tokens.placeables;
    const Edge = foundry.canvas.geometry.edges.Edge;
    const edges = [];
    for ( const token of tokens ) {
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

  static blockingTokens(subjectToken, tokens) {
    tokens ??= canvas.tokens.placeables;
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
    return tokens.filter(token => ObstacleOcclusionTest.includeToken(token, occlusionCfg));
  }
}

/**
 * Extend Clockwise Sweep to track when the sweep hits wall corners; get the edges.
 */
export class ClockwiseCornerEdgeSweep extends ObstacleSweep {
  /**
   * "Edges" or walls encountered. Added if the wall forms part of the polygon.
   * @type {Set<Wall>}
   */
  edgesEncountered = new Set();

  /** @type {object} */
  sweepOpts = {};

  /** @inheritdoc */
  _compute() {
    this.edgesEncountered.clear();
    super._compute();
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
export class ClockwiseCornerSweep extends ObstacleSweep {

  /**
   * Corners are when the sweep hits a non-limited wall
   * and must extend the sweep beyond that point.
   * In addition, corners where the walls simply continue are ignored
   * @type {Point[]}
   */
  cornersEncountered = new Set();

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
}

/**
 * @typedef CornerMapEntry
 * @prop {Set<Edge>} edges                      Every edge that shares this corner vertex as an endpoint
 * @prop {PIXI.Point.key[]} offsetCornerKeys    The offset points.
 *   offsetVCorners generates 1; offsetCornerEdges generates 2.
 */

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
 * @returns {Map<number, CornerMapEntry>}       Corner keys mapped to offset corner points and edges.
 */
export function offsetVCornersForEdges(edges, elevationZ = 0, offset = 2, cornerMap = new Map()) {
  edges ??= canvas.walls.placeables.map(w => w.edge);

  // Create a map of all edge endpoints to their edges.
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
      offsetCorner = _vOffsetTwoEdges(res.ccw, res.cw, vertex, offset);
    }
    if ( !offsetCorner ) console.error("offsetVCornersForEdges failed", { edge: [...edges], elevationZ, offset })

    value.offsetCornerKeys[0] = offsetCorner.key;
  }
  return cornerMap;
}

/* Debug
console.time("offsetVCorners")
cornerMap = offsetVCornersForEdges(undefined, 20)
console.timeEnd("offsetVCorners")
cornerMap.keys().forEach(key => Draw.point(PIXI.Point.invertKey(key)))
cornerMap.values().forEach(v => Draw.point(PIXI.Point.invertKey(v.offsetCornerKeys), { color: Draw.COLORS.blue }))

*/

/**
 * For a set of edges, for each corner, get the point that extends the line at each corner.
 *  \ | /
 *   \|/
 *
 *   • •
 * Note how the points align with the outer edges.
 *
 * @param {Edge[]} edges                        Edges to test
 * @param {number}[offset=2]                    How far away from the corner to set the offset.
 * @returns {Set<number>} The offset corner points, stored as keys in the set.
 */
export function offsetEdgeCornersForEdges(edges, elevationZ = 0, offset = 2, cornerMap = new Map()) {
  edges ??= canvas.walls.placeables.map(w => w.edge);

  // Create a map of all edge endpoints to their edges.
  for ( const edge of edges ) {
    if ( !edge.move ) continue;
    if ( edge.object instanceof foundry.canvas.placeables.Wall
      && !elevationZ.between(edge.object.bottomZ, edge.object.topZ) ) continue;
    _processEndpoint(edge.a, edge, cornerMap);
    _processEndpoint(edge.b, edge, cornerMap);
  }

  // Identify corners
  // Single edge: extend from endpoints.
  // Two edges: use the bisector
  // 3+ edges: use the bisector from the outermost edges.
  const offset2 = offset ** 2;
  for ( const [cornerKey, value] of cornerMap.entries() ) {
    if ( !value.edges.size ) console.error("Every corner should have at least one edge.");
    const vertex = PIXI.Point.invertKey(cornerKey);
    value.offsetCornerKeys.length = 0;
    if ( value.edges.size === 1 ) {
      value.offsetCornerKeys.length = 1;
      const edge = value.edges.first();
      const a = edge.b.key === cornerKey ? edge.a : edge.b;
      value.offsetCornerKeys[0] = _vOffsetSingleEdge(a, vertex, offset).key;
    } else {
      const res = formsV(value.edges, vertex);
      if ( !res ) continue;

      // From each outer edge point, set a point cw|ccw --> v -...offset-•
      value.offsetCornerKeys.length = 2;
      value.offsetCornerKeys[0] = vertex.towardsPointSquared(res.cw, -offset2).key;
      value.offsetCornerKeys[1] = vertex.towardsPointSquared(res.ccw, -offset2).key;
    }
  }
  return cornerMap;
}

/* Debug
console.time("offsetVCorners")
cornerMap = offsetVCornersForEdges(undefined, 20)
console.timeEnd("offsetVCorners")
cornerMap.keys().forEach(key => Draw.point(PIXI.Point.invertKey(key)))
cornerMap.values().forEach(v => Draw.point(PIXI.Point.invertKey(v.offsetCornerKeys), { color: Draw.COLORS.blue }))

*/

/**
 * Helper to define the corner map entry for a single edge endpoint.
 * If the entry already exists, this adds the new edge.
 * @param {PIXI.Point} a      Edge endpoint
 * @param {Edge} edge         Edge to store
 * @param {Map<number,CornerMapEntry>} cornerMap      Map of corner keys and information for each, to be updated
 */
function _processEndpoint(a, edge, cornerMap) {
  const key = a.key;
  const value = cornerMap.get(key) ?? { edges: new Set(), offsetCornerKeys: [] };
  if ( !cornerMap.has(key) ) cornerMap.set(key, value);

  // If this overlaps another edge, skip.
  // If another edge overlaps this, skip.
  // Recall the edges here share vertex a. Need to just make sure b is between edge.a and edge.b.
  const e1 = edge.a.key === key ? edge.b : edge.a;
  for ( const other of value.edges ) {
    const e2 = other.a.key === key ? other.b : other.a;
    if ( segmentsOverlap(a, e1, e2) ) return;
  }
  value.edges.add(edge);
}

/**
 * Helper to determine if two segments that share a vertex overlap.
 * Overlap means they are collinear and point the same direction.
 * @param {PIXI.Point} v      Shared vertex
 * @param {PIXI.Point} e1     Endpoint of the first segment
 * @param {PIXI.Point} e2     End point of the second segment
 * @returns {boolean} True if they overlap.
 */
function segmentsOverlap(v, e1, e2) {
  // Collinearity check.
  if ( !foundry.utils.orient2dFast(v, e1, e1).almostEqual(0) ) return false;

  // Directionality check. Dot product of the vectors v|a1 and v|a2.
  using delta1 = e1.subtract(v);
  using delta2 = e2.subtract(v);
  return delta1.dot(delta2) > 0;
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
/*
function offsetVCorners(sweep, offset = 2) {
  const cornerResults = sweep.cornerGapsEncountered;
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
*/


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
/*
function offsetEdgeCorners(sweep, offset = 2) {
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
    if ( corner.cwEdges.size && corner.ccwEdges.size ) {
      console.warn("offsetEdgeCorners|corner should have either cwEdges or ccwEdge but not both.");
    }
    const edges = corner.cwEdges.size ? corner.cwEdges : corner.ccwEdges;
    const closest = facingEdgePoint(origin, corner, edges);

    // Move along the closest edge away from the vertex and the other endpoint, into the gap.
    const offsetCorner = vertex.towardsPointSquared(closest, -offset2);
    offsetCorners.add(offsetCorner.key);
  }
  return offsetCorners;
}
*/

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
/*
function facingEdgePoint(origin, vertex, segments) {
  // Similar logic to findOutermostVEdges except looking for the edge next to vertex --> origin.
  const { ccw, cw } = findOutermostVEdges(segments, vertex);

  // Determine which of the two boundary points is "further" from the origin
  // by checking orientation relative to the line (vertex -> origin).
  // If ccw is more counter-clockwise than the origin, then cw is the "facing" point.
  return foundry.utils.orient2dFast(vertex, origin, ccw) > 0 ? cw : ccw;
}
*/

/**
 * Helper for offsetVCorners.
 * For given set of edges that form a "V", returns the offset from the "V".
 * @param {PIXI.Point} vertex
 * @param {Set<Edge>} cornerEdges
 * @param {number} [offset=20]
 * @returns {PIXI.Point}
 */
/*
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
      return _vOffsetTwoEdges(a, c, vertex, offset);
    }
    default: {
      // Multiple edges; locate the outer edges then treat like case 2.
      const res = findOutermostVEdges(cornerEdges, vertex); // Faster to use result.target b/c it stores its key.
      return _vOffsetTwoEdges(res.ccw, res.cw, vertex, offset);
    }
  }
}
*/

function _vOffsetSingleEdge(a, vertex, offset = 2) {
  return vertex.towardsPointSquared(a, -(offset ** 2));
}

function _vOffsetTwoEdges(a, c, vertex, offset = 2) {
  using biV = bisectingVector(a, vertex, c);
  biV.multiplyScalar(-offset, biV);
  return vertex.add(biV);
}

/**
 * Given array or set of segments, find the shared vertex between the first two.
 * Assumes without testing that there is one; otherwise returns the second endpoint of the first segment.
 * @param {Set<Segment>|Segment[]} segments
 * @returns {PIXI.Point}
 */
function _sharedVertex(segments) { /* eslint-disable-line no-unused-vars */
  const iter = segments.values();
  const edge0 = iter.next().value;
  const edge1 = iter.next().value;
  return edge0.a.key === edge1.a.key || edge0.a.key === edge1.b.key ? edge0.a : edge0.b;
}
