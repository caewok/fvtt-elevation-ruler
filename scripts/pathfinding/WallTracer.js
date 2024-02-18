/* globals
CanvasQuadtree,
CONFIG,
CONST,
foundry,
PIXI,
Token,
Wall
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// WallTracer3

import { groupBy, segmentBounds, perpendicularPoints } from "../util.js";
import { Draw } from "../geometry/Draw.js";
import { Graph, GraphVertex, GraphEdge } from "../geometry/Graph.js";
import { Settings } from "../settings.js";

/* WallTracerVertex

Represents the endpoint of a WallTracerEdge.
Like with Walls, these vertices use integer values and keys.

The vertex provides links to connected WallTracerEdges.

*/

/* WallTracerEdge

Represents a portion of a Wall between two collisions:
- endpoint -- endpoint
- endpoint -- intersection
- intersection -- intersection

Properties include:
- wall
- A and B, where each store the t ratio corresponding to a point on the wall
- Array? of WallTracerEdge that share an endpoint, organized from cw --> ccw angle

If the wall overlaps a collinear wall?
- single edge should represent both

Wall type: currently ignored

*/

/* Connected WallTracerEdge identification

A closed polygon formed from WallTracerEdge can only be formed from edges that have
connecting edges at both A and B endpoints.

Store the set of connected WallTracerEdges. For a given set of edges, one can find the
set of connected edges by repeatedly removing edges with zero or 1 connected endpoints,
then updating the remainder and repeating until no more edges are removed.

The connected edges remaining must form 1+ closed polygons. All dangling lines will have
been removed.

*/

/* Wall updating

1. Wall creation
- Locate collision walls (edges) using QuadTree.
- Split wall into edges.
- Split colliding edges.
- Update the set of connected edges.

2. Wall update
- A changed: redo as in wall creation (1)
- B changed: change B endpoint. Possibly drop edges if shrinking (use t values).

3. Wall deletion
- remove from set of edges
- remove from set of connected edges
- remove from shared endpoint edges
- redo set of connected edges

*/

/* Angles
Foundry canvas angles using Ray:
--> e: 0
--> se: π / 4
--> s: π / 2
--> sw: π * 3/4
--> w: π
--> nw: -π * 3/4
--> n: -π / 2
--> ne: -π / 4

So northern hemisphere is negative, southern is positive.
0 --> π moves from east to west clockwise.
0 --> -π moves from east to west counterclockwise.
*/

// NOTE: Testing
/*
api = game.modules.get("elevatedvision").api
SCENE_GRAPH = api.SCENE_GRAPH
WallTracer = api.WallTracer
WallTracerEdge = api.WallTracerEdge
WallTracerVertex = api.WallTracerVertex

origin = _token.center
*/


// Wall Tracer tracks all edges and vertices that make up walls/wall intersections.

/**
 * Represents either a wall endpoint or the intersection between two walls.
 * Collinear walls are considered to "intersect" at each overlapping endpoint.
 * Cached, so that vertices may not repeat. Because of this, the object is used as its own key.
 */
export class WallTracerVertex extends GraphVertex {

  /** @type {PIXI.Point} */
  #vertex = new PIXI.Point(); // Stored separately so vertices can be added, etc.

  /** @type {number} */
  key = -1;

  /** @type {string} */
  keyString = "-1";

  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    const point = new PIXI.Point(x, y);
    point.roundDecimals();
    const key = point.key;
    super(key);
    this.#vertex = point;
    this.key = key;
    this.keyString = key.toString();
  }

  /** @type {*} */
  // get key() { return this; } // TODO: Faster using key or using a cache?

  /** @type {number} */
  get x() { return this.#vertex.x; }

  /** @type {number} */
  get y() { return this.#vertex.y; }

  /** @type {PIXI.Point} */
  get point() { return this.#vertex.clone(); } // Clone to avoid internal modification.

  /**
   * Test for equality against another vertex
   */
  equals(other) {
    return this.#vertex.equals(other);
  }

  /**
   * Test for near equality against another vertex
   */
  almostEqual(other, epsilon = 1e-08) {
    return this.#vertex.almostEqual(other, epsilon);
  }

  /**
   * Convert the vertex to a string. String should be unique such that it can be an id or key.
   * @param {function} [callback]
   * @returns {string}
   */
  toString() { return this.keyString; }

  draw(drawingOptions = {}) {
    Draw.point(this, drawingOptions);
  }
}

/**
 * Represent a segment or edge of a placeable object in the graph.
 * For example, a token border edge or a wall edge.
 * Each edge may be a portion or an entire edge of the object.
 * Edges may represent a portion of multiple objects. For example, where a token border
 * overlaps a wall. Or where two walls overlap, or two token borders overlap.
 */
export class WallTracerEdge extends GraphEdge {
  /**
   * Number of places to round the ratio for segment collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /**
   * Placeable objects represented by this edge.
   * @type {Set<PlaceableObject>}
   */
  objects = new Set();

  /**
   * Filter set for walls.
   */
  get walls() { return this.objects.filter(o => o instanceof Wall); }

  /**
   * Filter set for tokens.
   */
  get tokens() { return this.objects.filter(o => o instanceof Token); }

  /**
   * Construct an edge.
   * To be used instead of constructor in most cases.
   * @param {Point} edgeA                 First object edge endpoint
   * @param {Point} edgeB                 Other object edge endpoint
   * @param {PlaceableObject} [object[]]    Object(s) that contains this edge
   * @param {number} [tA=0]               Where the A endpoint of this edge falls on the object
   * @param {number} [tB=1]               Where the B endpoint of this edge falls on the object
   * @returns {SegmentTracerEdge}
   */
  static fromObjects(edgeA, edgeB, objects, tA = 0, tB = 1) {
    tA = Math.clamped(tA, 0, 1);
    tB = Math.clamped(tB, 0, 1);
    edgeA = PIXI.Point.fromObject(edgeA);
    edgeB = PIXI.Point.fromObject(edgeB);
    const eA = this.pointAtEdgeRatio(edgeA, edgeB, tA);
    const eB = this.pointAtEdgeRatio(edgeA, edgeB, tB);
    const A = new WallTracerVertex(eA.x, eA.y);
    const B = new WallTracerVertex(eB.x, eB.y);
    const dist = PIXI.Point.distanceSquaredBetween(A.point, B.point);
    const edge = new this(A, B, dist);
    if ( objects ) objects.forEach(obj => edge.objects.add(obj));
    return edge;
  }

  /**
   * Construct an edge from a wall.
   * To be used instead of constructor in most cases.
   * @param {Wall} wall       Wall represented by this edge
   * @returns {WallTracerEdge}
   */
  static fromWall(wall) { return this.fromObject(wall.A, wall.B, [wall]); }

  /**
   * Construct an array of edges form the constrained token border.
   * To be used instead of constructor in most cases.
   * @param {Point} A                       First edge endpoint
   * @param {Point} b                       Other edge endpoint
   * @param {PlaceableObject} object       Object that contains this edge
   * @param {number} [tA=0]   Where the A endpoint of this edge falls on the object
   * @param {number} [tB=1]   Where the B endpoint of this edge falls on the object
   * @returns {WallTracerEdge[]}
   */
  static fromToken(token) {
    const edgeIter = token.constrainedTokenBorder.iterateEdges();
    const edges = [];
    for ( const edge of edgeIter ) edges.push(this.fromObject(edge.A, edge.B, [token]));
    return edges;
  }

  /**
   * Determine the point along the line of an edge given a ratio.
   * @param {PIXI.Point} edgeA      First edge endpoint
   * @param {PIXI.Point} edgeB      Other edge endpoint
   * @param {number} edgeT          The percentage from the edge endpoint A to use.
   * @returns {PIXI.Point} The point along the wall line. Ratio 0: endpoint A; 1: endpoint B.
   */
  static pointAtEdgeRatio(edgeA, edgeB, edgeT) {
    edgeT = Math.roundDecimals(edgeT, WallTracerEdge.PLACES);
    if ( edgeT.almostEqual(0) ) return edgeA;
    if ( edgeT.almostEqual(1) ) return edgeB;
    return edgeA.projectToward(edgeB, edgeT);
  }

  /**
   * Boundary rectangle that encompasses this edge.
   * @type {PIXI.Rectangle}
   */
  get bounds() { return segmentBounds(this.A, this.B); }

  /**
   * Find the collision, if any, between this edge and another object's edge.
   * @param {PIXI.Point} A              First edge endpoint for the object
   * @param {PIXI.Point} B              Second edge endpoint for the object
   * @returns {SegmentIntersection[]}
   *  Also rounds the t0 and t1 collision percentages to WallTracerEdge.PLACES.
   *  t0 is the collision point for the A, B object edge.
   *  t1 is the collision point for this edge.
   */
  findEdgeCollisions(A, B) {
    const C = this.A.point;
    const D = this.B.point;
    const collisions = endpointIntersection(A, B, C, D)
      ?? segmentIntersection(A, B, C, D)
      ?? segmentOverlap(A, B, C, D);
    if ( !collisions ) return [];
    if ( !(collisions instanceof Array) ) return [collisions];
    return collisions;
  }

  /**
   * Split this edge at some t value.
   * @param {number} edgeT  The portion on this *edge* that designates a point.
   * @returns {WallTracerEdge[]|null} Array of two edge tracer edges that share t endpoint.
   */
  splitAtT(edgeT) {
    edgeT = Math.clamped(edgeT, 0, 1);
    if ( edgeT.almostEqual(0) || edgeT.almostEqual(1) ) return null;

    // Construct two new edges, divided at the edgeT location.
    const { A, B } = this;
    const objects = [...this.objects];
    const edge1 = this.constructor.fromObjects(A, B, objects, 0, edgeT);
    const edge2 = this.constructor.fromObjects(A, B, objects, edgeT, 1);
    return [edge1, edge2];
  }

  /**
   * Draw this edge on the canvas.
   * Primarily for debugging.
   */
  draw(drawingOptions = {}) {
    Draw.segment(this, drawingOptions);
    this.A.draw(drawingOptions);
    this.B.draw(drawingOptions);
  }

  /**
   * Compilation of tests based on edge type for whether this wall blocks.
   * @param {Point} origin          Measure wall blocking from perspective of this origin point.
   * @param {Token} [moveToken]     Optional token doing the move if token edges should be checked.
   * @returns {boolean}
   */
  edgeBlocks(origin, moveToken, tokenBlockType, elevation = 0) {
    return this.objects.some(obj =>
      (obj instanceof Wall) ? this.constructor.wallBlocks(obj, origin, elevation)
        : (obj instanceof Token) ? this.constructor.tokenEdgeBlocks(obj, moveToken, tokenBlockType, elevation)
          : false);
  }

  /**
   * Does this edge wall block from an origin somewhere?
   * Tested "live" and not cached so door or wall orientation changes need not be tracked.
   * @param {Wall} wall         Wall to test
   * @param {Point} origin      Measure wall blocking from perspective of this origin point.
   * @param {number} [elevation=0]  Elevation of the point or origin to test.
   * @returns {boolean}
   */
  static wallBlocks(wall, origin, elevation = 0) {
    if ( !wall.document.move || wall.isOpen ) return false;

    // Ignore one-directional walls which are facing away from the center
    const side = wall.orientPoint(origin);

    /* Unneeded?
    const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
    if ( wall.document.dir
      && (wallDirectionMode === wdm.NORMAL) === (side === wall.document.dir) ) return false;
    */

    if ( wall.document.dir
      && side === wall.document.dir ) return false;

    // Test for wall height.
    if ( !elevation.between(wall.bottomZ, wall.topZ) ) return false;

    return true;
  }

  /**
   * Could edges of this token block the moving token?
   * @param {Token} token             Token whose edges will be tested
   * @param {Token} moveToken         Token doing the move
   * @param {string} tokenBlockType   What test to use for comparing token dispositions for blocking
   * @param {number} [elevation=0]  Elevation of the point or origin to test.
   * @returns {boolean}
   */
  static tokenEdgeBlocks(token, moveToken, tokenBlockType, elevation = 0) {
    if ( !moveToken || moveToken === token ) return false;

    if ( !elevation.between(token.topZ, token.bottomZ) ) return false;

    tokenBlockType ??= Settings._tokenBlockType();
    const D = CONST.TOKEN_DISPOSITIONS;
    const moveTokenD = moveToken.document.disposition;
    const edgeTokenD = token.document.disposition;
    switch ( tokenBlockType ) {
      case D.NEUTRAL: return false;
      case D.SECRET: return true;

      // Hostile: Block if dispositions are different
      case D.HOSTILE: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD !== moveTokenD );

      // Friendly: Block if dispositions are the same
      case D.FRIENDLY: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD === moveTokenD );

      default: return true;
    }
  }
}

export class WallTracer extends Graph {
  /**
   * Number of places to round the ratio for wall collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /**
   * Helper function used to group collisions into the collision map.
   * @param {WallTracerCollision} c   Collision to group
   * @returns {number} The t0 property, rounded.
   */
  static _keyGetter(c) { return Math.roundDecimals(c.t0, WallTracer.PLACES); }

  /**
   * Map of a set of edges, keyed to the placeable's id.
   * Must be id because deleted placeables may still need to be accessed here.
   * @type {Map<string, Set<WallTracerEdge>>}
   */
  objectEdges = new Map();

  /**
   * Set of wall ids represented in this graph.
   * @type {Set<string>}
   */
  wallIds = new Set();

  /**
   * Set of token ids represented in this graph.
   * @type {Set<string>}
   */
  tokenIds = new Set();

  /** @type {CanvasQuadtree} */
  edgesQuadtree = new CanvasQuadtree();

  /**
   * Clear all cached edges, etc. used in the graph.
   */
  clear() {
    this.edgesQuadtree.clear();
    this.objectEdges.clear();
    this.wallIds.clear();
    this.tokenIds.clear();
    super.clear();
  }

  /**
   * When adding an edge, make sure to add to quadtree.
   * @param {GraphEdge} edge
   * @returns {GraphEdge}
   * @inherited
   */
  addEdge(edge) {
    edge = super.addEdge(edge);
    this.edgesQuadtree.insert({ r: edge.bounds, t: edge });

    // Track the edge objects.
    edge.objects.forEach(obj => this._addEdgeToObjectSet(obj.id, edge));
    return edge;
  }

  /**
   * When deleting an edge, make sure to remove from quadtree.
   * @param {GraphEdge} edge
   */
  deleteEdge(edge) {
    this.edgesQuadtree.remove(edge);

    // Track the edge objects.
    edge.objects.forEach(obj => this._removeEdgeFromObjectSet(obj.id, edge));
    super.deleteEdge(edge);
  }

  /**
   * Add an edge to the object's edge set.
   * @param {string} id             Id of the object
   * @param {WallTracerEdge} edge   Edge to add
   */
  _addEdgeToObjectSet(id, edge) {
    if ( !this.objectEdges.get(id) ) this.objectEdges.set(id, new Set());
    const edgeSet = this.objectEdges.get(id);
    edgeSet.add(edge);
  }

  /**
   * Remove an edge from the object's set.
   * @param {string} id               Id of the object
   * @param {WallTracerEdge} edge     Edge to remove
   */
  _removeEdgeFromObjectSet(id, edge) {
    const edgeSet = this.objectEdges.get(id);
    if ( edgeSet ) edgeSet.delete(edge);
  }

  /**
   * Add an edge for an object, splitting based on edges already present in the graph.
   * If the edge already exists and is exactly the same, simply add the object
   * to the object set for the edge.
   * @param {PIXI.Point} edgeA                  First edge endpoint
   * @param {PIXI.Point} edgeB                  Other edge endpoint
   * @param {PlaceableObject} object            Object to convert to edge(s)
   * @param {Set<SegmentTracerEdge>} [edgeSet]  Existing edge set to use
   * @param {class} [cl]                        Class to use for the object.
   */
  addObjectEdge(edgeA, edgeB, object) {
    // Locate collision points for any edges that collide with this edge object.
    // If no collisions, then a single edge can represent this edge object.
    const collisions = this.findEdgeCollisions(edgeA, edgeB);
    if ( !collisions.size ) {
      const edge = WallTracerEdge.fromObjects(edgeA, edgeB, [object]);
      this.addEdge(edge);
    }

    // Sort the keys so we can progress from A --> B along the edge.
    const tArr = [...collisions.keys()];
    tArr.sort((a, b) => a - b);

    // For each collision, ordered along the wall from A --> B
    // - construct a new edge for this wall portion
    // - update the collision links for the colliding edge and this new edge
    if ( !collisions.has(1) ) tArr.push(1);
    let priorT = 0;
    const overlaps = new Set();
    for ( const t of tArr ) {
      // Check each collision point.
      // For endpoint collisions, nothing will be added.
      // For normal intersections, split the other edge.
      // If overlapping, split the other edge if not at endpoint.
      // One or more edges may be split at this collision point.
      // Track when we start or end overlapping on an edge.
      const cObjs = collisions.get(t) ?? [];
      let addEdge = Boolean(t); // Don't add an edge for 0 --> 0.
      for ( const cObj of cObjs ) {
        const splitEdges = cObj.edge.splitAtT(cObj.t1); // If the split is at the endpoint, will be null.
        if ( cObj.overlap ) {
          if ( overlaps.has(cObj.edge) ) { // Ending an overlap.
            overlaps.delete(cObj.edge);
            if ( splitEdges ) splitEdges[0].objects.add(object); // Share the edge with this object.
            else {
              cObj.edge.objects.add(object);

              // Make sure the object's edges include this cObj.edge.
              this._addEdgeToObjectSet(object.id, cObj.edge);
            }
            addEdge = false; // Only want one edge here: the existing.
          } else {  // Starting a new overlap.
            overlaps.add(cObj.edge);
            if ( splitEdges ) splitEdges[1].objects.add(object); // Share the edge with this object.
          }
        }
        if ( splitEdges ) {
          // Remove the existing edge and add the new edges.
          // With overlaps, it is possible the edge was already removed.
          if ( this.edges.has(cObj.edge.key) ) this.deleteEdge(cObj.edge);
          splitEdges.forEach(e => this.addEdge(e));
        }
      }

      // Build edge for portion of wall between priorT and t, skipping when t === 0
      if ( addEdge ) {
        const edge = WallTracerEdge.fromObjects(edgeA, edgeB, [object], priorT, t);
        this.addEdge(edge);
      }

      // Cycle to next.
      priorT = t;
    }
  }

  /**
   * Split the token edges by edges already in this graph.
   * @param {Token} token   Token to convert to edge(s)
   */
  addToken(token) {
    const tokenId = token.id;
    if ( this.edges.has(tokenId) ) return;

    // Construct a new token edge set.
    const edgeIter = token.constrainedTokenBorder.iterateEdges();
    for ( const edge of edgeIter ) this.addObjectEdge(edge.A, edge.B, token);
    this.tokenIds.add(tokenId);
  }

  /**
   * Split the wall by edges already in this graph.
   * @param {Wall} wall   Wall to convert to edge(s)
   */
  addWall(wall) {
    const wallId = wall.id;
    if ( this.edges.has(wallId) ) return;

    // Construct a new wall edge set.
    this.wallIds.add(wallId);
    this.addObjectEdge(PIXI.Point.fromObject(wall.A), PIXI.Point.fromObject(wall.B), wall);
  }

  /**
   * Remove all associated edges with this edge set and object id.
   * @param {string} id             Id of the edge object to remove
   * @param {Map<string, Set<TokenTracerEdge>>} Map of edges to remove from
   */
  removeObject(id) {
    const edges = this.objectEdges.get(id);
    if ( !edges || !edges.size ) return;

    // Shallow copy the edges b/c they will be removed from the set with destroy.
    const edgesArr = [...edges];
    for ( const edge of edgesArr ) {
      // Remove any object with this id; if no objects left for the edge, remove the edge.
      edge.objects
        .filter(obj => obj.id === id)
        .forEach(obj => {
          edge.objects.delete(obj);
          this._removeEdgeFromObjectSet(id, edge);
        });
      // Works but not clear why edges sometimes exist but are not in the edge set.
      // Removing the test for if the edge is in the edges set results in occasional warnings.
      if ( !edge.objects.size && this.edges.has(edge.key) ) this.deleteEdge(edge);
    }
    this.objectEdges.delete(id);
  }

  /**
   * Remove all associated edges with this wall.
   * @param {string|Wall} wallId    Id of the wall to remove, or the wall itself.
   */
  removeWall(wallId) {
    if ( wallId instanceof Wall ) wallId = wallId.id;
    this.wallIds.delete(wallId);
    return this.removeObject(wallId);
  }

  /**
   * Remove all associated edges with this token.
   * @param {string|Token} tokenId    Id of the token to remove, or the token itself.
   */
  removeToken(tokenId) {
    if ( tokenId instanceof Token ) tokenId = tokenId.id;
    this.tokenIds.delete(tokenId);
    return this.removeObject(tokenId);
  }

  /**
   * Locate collision points for any edges that collide with this edge.
   * @param {PIXI.Point} edgeA                      Edge endpoint
   * @param {PIXI.Point} edgeB                      Other edge endpoint
   * @returns {Map<number, EdgeTracerCollision[]>}  Map of locations of the collisions
   */
  findEdgeCollisions(edgeA, edgeB) {
    const edgeCollisions = [];
    const bounds = segmentBounds(edgeA, edgeB);
    const collisionTest = (o, _rect) => segmentsOverlap(edgeA, edgeB, o.t.A, o.t.B);
    const collidingEdges = this.edgesQuadtree.getObjects(bounds, { collisionTest });
    for ( const edge of collidingEdges ) {
      const collisions = edge.findEdgeCollisions(edgeA, edgeB);
      if ( !collisions.length ) continue;
      collisions.forEach(c => c.edge = edge);

      // If two collisions, there is overlap.
      // Identify the overlapping objects.
      if ( collisions.length === 2 ) {
        collisions[0].overlap = true;
        collisions[1].overlap = true;
      }
      edgeCollisions.push(...collisions);
    }
    return groupBy(edgeCollisions, this.constructor._keyGetter);
  }

  /**
   * For debugging.
   * Draw edges in the graph.
   */
  drawEdges() {
    for ( const edge of this.edges.values() ) {
      const color = (edge.tokens.size && edge.walls.size) ? Draw.COLORS.white
        : edge.tokens.size ? Draw.COLORS.orange
          : edge.walls.size ? Draw.COLORS.red
            : Draw.COLORS.blue;
      edge.draw({ color });
    }
  }
}

/**
 * Do two segments overlap?
 * Overlap means they intersect or they are collinear and overlap
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {boolean}
 */
function segmentsOverlap(a, b, c, d) {
  if ( foundry.utils.lineSegmentIntersects(a, b, c, d) ) return true;

  // If collinear, B is within A|B or D is within A|B
  const pts = findOverlappingPoints(a, b, c, d);
  return pts.length;
}

/**
 * Find the points of overlap between two segments A|B and C|D.
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {PIXI.Point[]} Array with 0, 1, or 2 points.
 *   The points returned will be a, b, c, and/or d, whichever are contained by the others.
 *   No points are returned if A|B and C|D are not collinear, or if they do not overlap.
 *   A single point is returned if a single endpoint is shared.
 */
function findOverlappingPoints(a, b, c, d) {
  if ( !foundry.utils.orient2dFast(a, b, c).almostEqual(0)
    || !foundry.utils.orient2dFast(a, b, d).almostEqual(0) ) return [];

  // B is within A|B or D is within A|B
  const abx = Math.minMax(a.x, b.x);
  const aby = Math.minMax(a.y, b.y);
  const cdx = Math.minMax(c.x, d.x);
  const cdy = Math.minMax(c.y, d.y);

  const p0 = new PIXI.Point(
    Math.max(abx.min, cdx.min),
    Math.max(aby.min, cdy.min)
  );

  const p1 = new PIXI.Point(
    Math.min(abx.max, cdx.max),
    Math.min(aby.max, cdy.max)
  );

  const xEqual = p0.x.almostEqual(p1.x);
  const yEqual = p1.y.almostEqual(p1.y);
  if ( xEqual && yEqual ) return [p0];
  if ( xEqual ^ yEqual
  || (p0.x < p1.x && p0.y < p1.y)) return [p0, p1];

  return [];
}

// Must declare this variable after defining WallTracer.
export const SCENE_GRAPH = new WallTracer();

/* Debugging
api = game.modules.get("elevationruler").api
Draw = CONFIG.GeometryLib.Draw
let { Graph, GraphVertex, GraphEdge } = CONFIG.GeometryLib.Graph

SCENE_GRAPH = api.pathfinding.SCENE_GRAPH

// Do we have all the tokens?
canvas.tokens.placeables.filter(t => !SCENE_GRAPH.tokenIds.has(t.id))

// do we have all the walls?
canvas.walls.placeables.filter(w => !SCENE_GRAPH.wallIds.has(w.id))

// Draw all edges
SCENE_GRAPH.drawEdges()


// Construct a test graph and add all tokens
wt = new api.WallTracer()

canvas.walls.placeables.forEach(w => wt.addWall(w))
canvas.tokens.placeables.forEach(t => wt.addToken(t))
wt.tokenEdges.forEach(s => s.forEach(e => e.draw({color: Draw.COLORS.orange})))

*/

// NOTE: Helper functions

/**
 * @typedef {object} SegmentIntersection
 * Represents intersection between two segments, a|b and c|d
 * @property {PIXI.Point} pt        Point of intersection
 * @property {number} t0            Intersection location on the a --> b segment
 * @property {number} t1            Intersection location on the c --> d segment
 */

/**
 * Determine if two segments intersect at an endpoint and return t0, t1 based on that intersection.
 * @param {PIXI.Point} a        Endpoint on a|b segment
 * @param {PIXI.Point} b        Endpoint on a|b segment
 * @param {PIXI.Point} c        Endpoint on c|d segment
 * @param {PIXI.Point} d        Endpoint on c|d segment
 * @returns {SegmentIntersection|null}
 */
function endpointIntersection(a, b, c, d) {
  // Avoid overlaps
  // Distinguish a---b|c---d from a---c---b|d. Latter is an overlap.
  // Okay:
  // a---b|c---d
  // b---a|c---d
  // b---a|d---c
  // a---b|d---c
  // Overlap:
  // a---c---b|d
  // a---d---b|c
  // b---c---a|d
  // b---d---a|c
  const orient2d = foundry.utils.orient2dFast;
  if ( orient2d(a, b, c).almostEqual(0) && orient2d(a, b, d).almostEqual(0) ) {
    const dSquared = PIXI.Point.distanceSquaredBetween;
    const dAB = dSquared(a, b);
    if ( dAB > dSquared(a, c) || dAB > dSquared(a, d) ) return null;
  }

  if ( a.key === c.key || c.almostEqual(a) ) return { t0: 0, t1: 0, pt: a };
  if ( a.key === d.key || d.almostEqual(a) ) return { t0: 0, t1: 1, pt: a };
  if ( b.key === c.key || c.almostEqual(b) ) return { t0: 1, t1: 0, pt: b };
  if ( b.key === d.key || d.almostEqual(b) ) return { t0: 1, t1: 1, pt: b };
  return null;
}

/**
 * Determine if two segments intersect and return t0, t1 based on that intersection.
 * Generally will detect endpoint intersections but no special handling.
 * To ensure near-endpoint-intersections are captured, use endpointIntersection.
 * Will not detect overlap. See segmentOverlap
 * @param {PIXI.Point} a        Endpoint on a|b segment
 * @param {PIXI.Point} b        Endpoint on a|b segment
 * @param {PIXI.Point} c        Endpoint on c|d segment
 * @param {PIXI.Point} d        Endpoint on c|d segment
 * @returns {SegmentIntersection|null}
 */
function segmentIntersection(a, b, c, d) {
  if ( !foundry.utils.lineSegmentIntersects(a, b, c, d) ) return null;
  const ix = CONFIG.GeometryLib.utils.lineLineIntersection(a, b, c, d, { t1: true });
  ix.pt = PIXI.Point.fromObject(ix);
  return ix;
}

/**
 * Determine if two segments overlap and return the two points at which the segments
 * begin their overlap.
 * @param {PIXI.Point} a        Endpoint on a|b segment
 * @param {PIXI.Point} b        Endpoint on a|b segment
 * @param {PIXI.Point} c        Endpoint on c|d segment
 * @param {PIXI.Point} d        Endpoint on c|d segment
 * @returns {SegmentIntersection[2]|null}
 *  The 2 intersections will be sorted so that [0] --> [1] is the overlap.
 */
function segmentOverlap(a, b, c, d) {
  // First, ensure the segments are overlapping.
  const orient2d = foundry.utils.orient2dFast;
  if ( !orient2d(a, b, c).almostEqual(0) || !orient2d(a, b, d).almostEqual(0) ) return null;

  // To detect overlap, construct small perpendicular lines to the endpoints.
  const aP = perpendicularPoints(a, b); // Line perpendicular to a|b that intersects a
  const bP = perpendicularPoints(b, a);
  const cP = perpendicularPoints(c, d);
  const dP = perpendicularPoints(d, c);

  // Intersect each segment with the perpendicular lines.
  const lli = CONFIG.GeometryLib.utils.lineLineIntersection;
  const ix0 = lli(c, d, aP[0], aP[1]);
  const ix1 = lli(c, d, bP[0], bP[1]);
  const ix2 = lli(a, b, cP[0], cP[1]);
  const ix3 = lli(a, b, dP[0], dP[1]);

  // Shouldn't happen unless a,b,c, or d are not distinct points.
  if ( !(ix0 && ix1 && ix2 && ix3) ) return null;

  const aIx = ix0.t0.between(0, 1) ? ix0 : null;
  const bIx = ix1.t0.between(0, 1) ? ix1 : null;


  // Overlap: c|d --- aIx|bIx --- aIx|bIx --- c|d
  if ( aIx && bIx ) return [
    { t0: 0, t1: aIx.t0, pt: PIXI.Point.fromObject(aIx) },
    { t0: 1, t1: bIx.t0, pt: PIXI.Point.fromObject(bIx) }
  ];

  // Overlap: a|b --- cIx|dIx --- cIx|dIx --- a|b
  const cIx = ix2.t0.between(0, 1) ? ix2 : null;
  const dIx = ix3.t0.between(0, 1) ? ix3 : null;
  if ( cIx && dIx ) return [
    { t0: cIx.t0, t1: 0, pt: PIXI.Point.fromObject(cIx) },
    { t0: dIx.t0, t1: 1, pt: PIXI.Point.fromObject(dIx) }
  ];

  // Overlap: a|b --- cIx|dIx --- aIx|bIx --- c|d
  const abIx = aIx ?? bIx;
  const cdIx = cIx ?? dIx;
  if ( abIx && cdIx ) {
    return [
      { t0: cdIx.t0, t1: cIx ? 0 : 1, pt: PIXI.Point.fromObject(cdIx) },
      { t0: aIx ? 0 : 1, t1: abIx.t0, pt: PIXI.Point.fromObject(abIx) }
    ];
  }

  // No overlap.
  return null;
}
