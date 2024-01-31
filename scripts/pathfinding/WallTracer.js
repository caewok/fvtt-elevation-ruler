/* globals
CONST,
CanvasQuadtree,
CONFIG,
foundry,
PIXI,
Wall
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// WallTracer3

import { groupBy, segmentBounds } from "../util.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { Draw } from "../geometry/Draw.js";
import { Graph, GraphVertex, GraphEdge } from "../geometry/Graph.js";

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
 * Represent a segment. For example, a token border edge.
 */
export class SegmentTracerEdge extends GraphEdge {
   /**
   * Number of places to round the ratio for segment collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /**
   * Placeable object represented by this edge.
   * The edge may represent the entire object edge or just a portion (see tA and tB).
   * @type {PlaceableObject}
   */
  object;

  /**
   * The full edge endpoint, before accounting for any ratios/splits.
   * @type {PIXI.Point}
   */
  edgeA;

  /** @type {PIXI.Point} */
  edgeB;

  // Location on the edge, as a ratio, where the endpoint of the edge is located.
  /** @type {number} */
  tA = 0;

  /** @type {number} */
  tB = 1;

  /** @type {PIXI.Point} */
  delta = new PIXI.Point();

  /**
   * Construct an edge.
   * To be used instead of constructor in most cases.
   * @param {Point} A                       First edge endpoint
   * @param {Point} b                       Other edge endpoint
   * @param {PlaceableObject} object       Object that contains this edge
   * @param {number} [tA=0]   Where the A endpoint of this edge falls on the object
   * @param {number} [tB=1]   Where the B endpoint of this edge falls on the object
   * @returns {SegmentTracerEdge}
   */
  static fromObject(edgeA, edgeB, object, tA = 0, tB = 1) {
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

    edge.tA = tA;
    edge.tB = tB;
    edge.object = object;
    edge.delta = edge.B.point.subtract(edge.A.point);
    edge.edgeA = edgeA;
    edge.edgeB = edgeB;
    return edge;
  }

  /**
   * Determine the point along the line of an edge given a ratio.
   * @param {PIXI.Point} edgeA      First edge endpoint
   * @param {PIXI.Point} edgeB      Other edge endpoint
   * @param {number} edgeT          The percentage from the edge endpoint A to use.
   * @returns {PIXI.Point} The point along the wall line. Ratio 0: endpoint A; 1: endpoint B.
   */
  static pointAtEdgeRatio(edgeA, edgeB, edgeT) {
    if ( edgeT.almostEqual(0) ) return edgeA;
    if ( edgeT.almostEqual(1) ) return edgeB;

    edgeT = Math.roundDecimals(edgeT, WallTracerEdge.PLACES);
    return edgeA.projectToward(edgeB, edgeT);
  }

  /**
   * Boundary rectangle that encompasses this edge.
   * @type {PIXI.Rectangle}
   */
  get bounds() {
    const { A, delta } = this;
    return new PIXI.Rectangle(A.x, A.y, delta.x, delta.y).normalize();
  }

  /** @type {string} */
  get id() { return this.object.id; }

  /** @type {object} */
  get document() { return this.object.document; }

  /**
   * Reverse this edge
   * @returns {GraphEdge}
   */
  reverse() {
    const edge = super.reverse();
    [edge.tA, edge.tB] = [this.tB, this.tA];
    [edge.edgeA, edge.edgeB] = [this.edgeB, this.edgeA];
    edge.object = this.object;
    edge.delta = edge.B.point.subtract(edge.A.point);
    return edge;
  }

  /**
   * @typedef {object} EdgeTracerCollision
   * @property {number} objectT             Location of collision on the object's edge, where A = 0 and B = 1
   * @property {number} edgeT               Location of collision on this edge, where A = 0 and B = 1
   * @property {Point} pt                   Intersection point.
   * @property {SegmentEdge} edge           Edge associated with this collision
   * @property {PlaceableObject} object     Object associated with this collision
   */

  /**
   * Find the collision, if any, between this edge and another object's edge.
   * @param {PIXI.Point} A              First edge endpoint
   * @param {PIXI.Point} B              Second edge endpoint
   * @param {PlaceableObject} object    The object for the edge to be tested, for convenience
   * @returns {EdgeTracerCollision}
   */
  findEdgeCollision(A, B, object) {
    const { A: eA, B: eB } = this;
    let out;
    if ( A.key === eA.key || eA.almostEqual(A) ) out = { objectT: 0, edgeT: 0, pt: A };
    else if ( A.key === eB.key || eB.almostEqual(A) ) out = { objectT: 0, edgeT: 1, pt: A };
    else if ( B.key === eA.key || eA.almostEqual(B) ) out = { objectT: 1, edgeT: 0, pt: B };
    else if ( B.key === eB.key || eB.almostEqual(B) ) out = { objectT: 1, edgeT: 1, pt: B };
    else if ( foundry.utils.lineSegmentIntersects(A, B, eA, eB) ) {
      const ix = CONFIG.GeometryLib.utils.lineLineIntersection(A, B, eA, eB, { t1: true });
      out = {
        objectT: Math.roundDecimals(ix.t0, WallTracerEdge.PLACES),
        edgeT: Math.roundDecimals(ix.t1, WallTracerEdge.PLACES),
        pt: ix };
    } else return null; // Edge is either completely collinear or does not intersect.

    out.pt = new PIXI.Point(out.pt.x, out.pt.y);
    out.edge = this;
    out.object = object;
    return out;
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
    const { edgeA, edgeB, object } = this;
    const objectT = this._tRatioToObjectRatio(edgeT);
    const edge1 = this.constructor.fromObject(edgeA, edgeB, object, this.tA, objectT);
    const edge2 = this.constructor.fromObject(edgeA, edgeB, object, objectT, this.tB);
    return [edge1, edge2];
  }

  /**
   * For a given t ratio for this edge, what is the equivalent object ratio?
   * @param {number} t
   * @returns {number}
   */
  _tRatioToObjectRatio(t) {
    if ( t.almostEqual(0) ) return this.tA;
    if ( t.almostEqual(1) ) return this.tB;

    // Linear mapping where edgeT === 0 --> tA, edgeT === 1 --> tB
    const dT = this.tB - this.tA;
    return this.tA + (dT * t);
  }

  /**
   * Draw this edge on the canvas.
   * Primarily for debugging.
   */
  draw(drawingOptions = {}) {
    Draw.segment(this, drawingOptions);

    // Draw first endpoint in red.
    drawingOptions.color = Draw.COLORS.red;
    this.A.draw(drawingOptions);

    // Draw second endpoint in blue.
    drawingOptions.color = Draw.COLORS.blue;
    this.B.draw(drawingOptions);
  }
}

/**
 * Represents a portion of token border.
 * The border is divided into distinct edges based on intersections with other edges.
 */
export class TokenTracerEdge extends SegmentTracerEdge {
  /** @type {Token} */
  get token() { return this.object; }

  /**
   * Construct a set of edges for the token.
   * To be used instead of constructor in most cases.
   * @param {Point} A                       First edge endpoint
   * @param {Point} b                       Other edge endpoint
   * @param {PlaceableObject} object       Object that contains this edge
   * @param {number} [tA=0]   Where the A endpoint of this edge falls on the object
   * @param {number} [tB=1]   Where the B endpoint of this edge falls on the object
   * @returns {SegmentTracerEdge[]}
   */
  static fromToken(token) {
    const edgeIter = token.constrainedTokenBorder.iterateEdges();
    const edges = [];
    for ( const edge of edgeIter ) edges.push(this.fromObject(edge.A, edge.B, token))
    return edges;
  }
}

/**
 * Represents a portion of a wall.
 * The wall is divided into distinct edges based on intersections with other edges.
 */
export class WallTracerEdge extends SegmentTracerEdge {
  /**
   * Wall represented by this edge.
   * The edge may represent the entire wall or just a portion (see tA and tB).
   * @type {Wall}
   */
  get wall() { return this.object; }

  /**
   * Construct an edge from a wall.
   * To be used instead of constructor in most cases.
   * @param {Wall} wall       Wall represented by this edge
   * @param {number} [tA=0]   Where the A endpoint of this edge falls on the wall
   * @param {number} [tB=1]   Where the B endpoint of this edge falls on the wall
   * @returns {WallTracerEdge}
   */
  static fromWall(wall, tA = 0, tB = 1) { return this.fromObject(wall.A, wall.B, wall, tA, tB); }

  /** @type {boolean} */
  get hasActiveRoof() { return this.wall.hasActiveRoof; }

  /** @type {boolean} */
  get isOpen() { return this.wall.isOpen; }

  /**
   * Find the collision, if any, between this edge and a wall
   * @param {Wall} wall               Foundry wall object to test
   * @returns {EdgeTracerCollision}
   */
  findWallCollision(wall) { return this.findEdgeCollision(wall.A, wall.B, wall); }
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
  static _keyGetter(c) { return Math.roundDecimals(c.objectT, WallTracer.PLACES); }

  /**
   * Map of a set of edges for a given wall, keyed to the wall id.
   * Must be wall id because deleted walls may still need to be accessed here.
   * @type {Map<string, Set<WallTracerEdge>>}
   */
  wallEdges = new Map();

  /**
   * Map of a set of edges for a given token, keyed to the token id.
   * Must be token id because deleted tokens may still need to be accessed here.
   * @type {Map<string, Set<TokenTracerEdge>>}
   */
  tokenEdges = new Map();

  /** @type {CanvasQuadtree} */
  edgesQuadtree = new CanvasQuadtree();

  /**
   * @type {object}
   * @property {PIXI.Polygons} least
   * @property {PIXI.Polygons} most
   * @property {PIXI.Polygons} combined
   */
  cyclePolygonsQuadtree = new CanvasQuadtree();

  /**
   * Clear all cached edges, etc. used in the graph.
   */
  clear() {
    this.edgesQuadtree.clear();
    this.cyclePolygonsQuadtree.clear();
    this.wallEdges.clear();
    this.tokenEdges.clear();
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
    const bounds = edge.bounds;
    this.edgesQuadtree.insert({ r: bounds, t: edge });
    return edge;
  }

  /**
   * When deleting an edge, make sure to remove from quadtree.
   * @param {GraphEdge} edge
   */
  deleteEdge(edge) {
    this.edgesQuadtree.remove(edge);
    super.deleteEdge(edge);
  }

  /**
   * Add an edge for an object, splitting based on edges already present in the graph.
   * @param {PIXI.Point} edgeA                  First edge endpoint
   * @param {PIXI.Point} edgeB                  Other edge endpoint
   * @param {PlaceableObject} object            Object to convert to edge(s)
   * @param {Set<SegmentTracerEdge>} [edgeSet]  Existing edge set to use
   * @param {class} [cl]                        Class to use for the object.
   * @returns {Set<SegmentTracerEdge>}
   */
  addObjectEdge(edgeA, edgeB, object, edgeSet, cl) {
    cl ??= object instanceof Wall ? WallTracerEdge
      : object instanceof Token ? TokenTracerEdge
        : SegmentTracerEdge;

    edgeSet ??= new Set();

    // Locate collision points for any edges that collide with this wall.
    // If no collisions, then a single edge can represent this wall.
    const collisions = this.findEdgeCollisions(edgeA, edgeB, object);
    if ( !collisions.size ) {
      const edge = cl.fromObject(edgeA, edgeB, object);
      this.addEdge(edge);
      return edgeSet.add(edge);
    }

    // Sort the keys so we can progress from A --> B along the wall.
    const tArr = [...collisions.keys()];
    tArr.sort((a, b) => a - b);

    // For each collision, ordered along this wall from A --> B
    // - construct a new edge for this wall portion
    // - update the collision links for the colliding edge and this new edge
    if ( !collisions.has(1) ) tArr.push(1);
    let priorT = 0;
    for ( const t of tArr ) {
      // Build edge for portion of wall between priorT and t, skipping when t === 0
      if ( t ) {
        const edge = cl.fromObject(edgeA, edgeB, object, priorT, t);
        this.addEdge(edge);
        edgeSet.add(edge);
      }

      // One or more edges may be split at this collision point.
      const cObjs = collisions.get(t) ?? [];
      for ( const cObj of cObjs ) {
        const splitEdges = cObj.edge.splitAtT(cObj.edgeT);
        if ( !splitEdges ) continue; // If the split is at the endpoint, will be null.

        // Remove the existing edge and add the new edges.
        this.deleteEdge(cObj.edge);
        const [edge1, edge2] = splitEdges;
        this.addEdge(edge1);
        this.addEdge(edge2);
        edgeSet.add(edge1);
        edgeSet.add(edge2);
      }

      // Cycle to next.
      priorT = t;
    }

    return edgeSet;
  }

  /**
   * Split the token edges by edges already in this graph.
   * @param {Token} token   Token to convert to edge(s)
   * @returns {Set<TokenTracerEdge>}
   */
  addToken(token) {
    const tokenId = token.id;
    if ( this.tokenEdges.has(tokenId) ) return this.tokenEdges.get(tokenId);

    // Construct a new token edge set.
    const edgeSet = new Set();
    this.tokenEdges.set(tokenId, edgeSet);
    const edgeIter = token.constrainedTokenBorder.iterateEdges();
    for ( const edge of edgeIter ) this.addObjectEdge(edge.A, edge.B, token, edgeSet, TokenTracerEdge);
    return edgeSet;
  }

  /**
   * Split the wall by edges already in this graph.
   * @param {Wall} wall   Wall to convert to edge(s)
   * @returns {Set<WallTracerEdge>}
   */
  addWall(wall) {
    const wallId = wall.id;
    if ( this.wallEdges.has(wallId) ) return this.wallEdges.get(wallId);

    // Construct a new wall edge set.
    const edgeSet = new Set();
    this.wallEdges.set(wallId, edgeSet);
    return this.addObjectEdge(wall.A, wall.B, wall, edgeSet, WallTracerEdge);
  }

  /**
   * Remove all associated edges with this edge set and object id.
   * @param {string} id             Id of the edge object to remove
   * @param {Map<string, Set<TokenTracerEdge>>} Map of edges to remove from
   */
  removeObject(id, objectMap) {
    const edges = objectMap.get(id);
    if ( !edges || !edges.size ) return;

    // Shallow copy the edges b/c they will be removed from the set with destroy.
    const edgesArr = [...edges];
    for ( const edge of edgesArr ) this.deleteEdge(edge);
    objectMap.delete(id);
  }

  /**
   * Remove all associated edges with this wall.
   * @param {string|Wall} wallId    Id of the wall to remove, or the wall itself.
   */
  removeWall(wallId) {
    if ( wallId instanceof Wall ) wallId = wallId.id;
    return this.removeObject(wallId, this.wallEdges);
  }

  /**
   * Remove all associated edges with this token.
   * @param {string|Token} tokenId    Id of the token to remove, or the token itself.
   */
  removeToken(tokenId) {
    if ( tokenId instanceof Token ) tokenId = tokenId.id;
    return this.removeObject(tokenId, this.tokenEdges);
  }

  /**
   * Locate collision points for any edges that collide with this edge.
   * @param {PIXI.Point} edgeA                      Edge endpoint
   * @param {PIXI.Point} edgeB                      Other edge endpoint
   * @returns {Map<number, EdgeTracerCollision[]>}  Map of locations of the collisions
   */
  findEdgeCollisions(edgeA, edgeB, object) {
    const collisions = [];
    const bounds = segmentBounds(edgeA, edgeB);
    const collisionTest = (o, _rect) => segmentsOverlap(edgeA, edgeB, o.t.A, o.t.B);
    const collidingEdges = this.edgesQuadtree.getObjects(bounds, { collisionTest });
    for ( const edge of collidingEdges ) {
      const collision = edge.findEdgeCollision(edgeA, edgeB, object);
      if ( collision ) collisions.push(collision);
    }
    return groupBy(collisions, this.constructor._keyGetter);
  }

  // ----- Polygon handling ---- //

  /**
   * @type {PIXI.Polygon} GraphCyclePolygon
   * @type {object} _wallTracerData   Object to store tracer data
   * @property {Set<Wall>} _wallTracerData.wallSet    Walls that make up the polygon
   * @property {object} _wallTracerData.restrictionTypes  CONST.WALL_RESTRICTION_TYPES
   * @property {number} _wallTracerData.restrictionTypes.light
   * @property {number} _wallTracerData.restrictionTypes.sight
   * @property {number} _wallTracerData.restrictionTypes.sound
   * @property {number} _wallTracerData.restrictionTypes.move
   * @property {object} _wallTracerData.height
   * @property {number} _wallTracerData.height.min
   * @property {number} _wallTracerData.height.max
   * @property {number} _wallTracerData.hasOneWay
   */

  /**
   * Convert a single cycle (array of vertices) to a polygon.
   * Capture the wall set for edges in the polygon.
   * Determine the minimum limit for each restriction type of all the walls.
   * @param {WallTracerVertex[]} cycle    Array of vertices that make up the cycle, in order.
   * @returns {GraphCyclePolygon|null} Polygon, with additional tracer data added.
   */
  static cycleToPolygon(cycle) {
    const nVertices = cycle.length;
    if ( nVertices < 3 ) return null;
    const points = Array(nVertices * 2);
    const wallSet = new Set();
    const restrictionTypes = {
      light: CONST.WALL_SENSE_TYPES.NORMAL,
      sight: CONST.WALL_SENSE_TYPES.NORMAL,
      sound: CONST.WALL_SENSE_TYPES.NORMAL,
      move: CONST.WALL_SENSE_TYPES.NORMAL
    };
    const height = {
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY
    };
    let hasOneWay = false;

    let vertex = cycle[nVertices - 1];
    for ( let i = 0; i < nVertices; i += 1 ) {
      const nextVertex = cycle[i];
      const j = i * 2;
      points[j] = vertex.x;
      points[j + 1] = vertex.y;

      const edge = vertex.edges.find(e => e.otherVertex(vertex).key === nextVertex.key); // eslint-disable-line no-loop-func
      const wall = edge.wall;
      wallSet.add(wall);
      const doc = wall.document;
      restrictionTypes.light = Math.min(restrictionTypes.light, doc.light);
      restrictionTypes.sight = Math.min(restrictionTypes.sight, doc.sight);
      restrictionTypes.sound = Math.min(restrictionTypes.sound, doc.sound);
      restrictionTypes.move = Math.min(restrictionTypes.move, doc.move);

      height.min = Math.min(height.min, wall.bottomZ);
      height.max = Math.max(height.max, wall.topZ);

      hasOneWay ||= doc.dir;

      vertex = nextVertex;
    }

    const poly = new PIXI.Polygon(points);
    poly.clean();
    poly._wallTracerData = { wallSet, restrictionTypes, height, hasOneWay };
    return poly;
  }

  /**
   * Update the quadtree of cycle polygons
   */
  updateCyclePolygons() {
    // Least, most, none are perform similarly. Most might be a bit faster
    // (The sort can sometimes mean none is faster, but not always)
    // Weighting by distance hurts performance.
    this.cyclePolygonsQuadtree.clear();
    const cycles = this.getAllCycles({ sortType: Graph.VERTEX_SORT.LEAST, weighted: true });
    cycles.forEach(cycle => {
      const poly = WallTracer.cycleToPolygon(cycle);
      this.cyclePolygonsQuadtree.insert({ r: poly.getBounds(), t: poly });
    });
  }

  /**
   * For a given origin point, find all polygons that encompass it.
   * Then narrow to the one that has the smallest area.
   * @param {Point} origin
   * @param {CONST.WALL_RESTRICTION_TYPES} [type]   Limit to polygons that are CONST.WALL_SENSE_TYPES.NORMAL
   *                                                for the given type
   * @returns {PIXI.Polygon|null}
   */
  encompassingPolygon(origin, type) {
    const encompassingPolygons = this.encompassingPolygons(origin, type);
    return this.smallestPolygon(encompassingPolygons);
  }

  encompassingPolygons(origin, type) {
    origin.z ??= 0;

    // Find those polygons that actually contain the origin.
    // Start by using the bounds, then test containment.
    const bounds = new PIXI.Rectangle(origin.x - 1, origin.y -1, 2, 2);
    const collisionTest = (o, _rect) => o.t.contains(origin.x, origin.y);
    let encompassingPolygons = this.cyclePolygonsQuadtree.getObjects(bounds, { collisionTest });

    if ( type ) encompassingPolygons = encompassingPolygons.filter(poly => {
      const wallData = poly._wallTracerData;

      if ( wallData.restrictionTypes[type] !== CONST.WALL_SENSE_TYPES.NORMAL
        || wallData.height.max < origin.z
        || wallData.height.min > origin.z ) return false;

      if ( !wallData.hasOneWay ) return true;

      // Confirm that each wall is blocking from the origin
      for ( const wall of wallData.wallSet ) {
        if ( !wallData.dir ) continue;
        const side = wall.orientPoint(this.origin);
        if ( side === wall.document.dir ) return false;

      }
      return true;
    });

    return encompassingPolygons;
  }

  smallestPolygon(polygons) {
    const res = polygons.reduce((acc, curr) => {
      const area = curr.area;
      if ( area < acc.area ) {
        acc.area = area;
        acc.poly = curr;
      }
      return acc;
    }, { area: Number.POSITIVE_INFINITY, poly: null});

    return res.poly;
  }

  /**
   * For a given polygon, find all polygons that could be holes within it.
   * @param {PIXI.Polygon} encompassingPolygon
   * @param {CONST.WALL_RESTRICTION_TYPES} [type]   Limit to polygons that are CONST.WALL_SENSE_TYPES.NORMAL
   *                                                for the given type
   * @returns {encompassingPolygon: {PIXI.Polygon}, holes: {Set<PIXI.Polygon>}}
   */
  _encompassingPolygonsWithHoles(origin, type) {
    const encompassingPolygons = this.encompassingPolygons(origin, type);
    const encompassingPolygon = this.smallestPolygon(encompassingPolygons);
    if ( !encompassingPolygon ) return { encompassingPolygon, holes: [] };

    // Looking for all polygons that are not encompassing but do intersect with or are contained by
    // the encompassing polygon.
    const collisionTest = (o, _rect) => {
      const poly = o.t;
      if ( encompassingPolygons.some(ep => ep.equals(poly)) ) return false;
      return poly.overlaps(encompassingPolygon);
    };

    const holes = this.cyclePolygonsQuadtree.getObjects(encompassingPolygon.getBounds(), { collisionTest });
    return { encompassingPolygon, holes };
  }

  /**
   * Build the representation of a polygon that encompasses the origin point,
   * along with any holes for that encompassing polygon.
   * @param {Point} origin
   * @param {CONST.WALL_RESTRICTION_TYPES} [type]   Limit to polygons that are CONST.WALL_SENSE_TYPES.NORMAL
   *                                                for the given type
   * @returns {PIXI.Polygon[]}
   */
  encompassingPolygonWithHoles(origin, type) {
    const { encompassingPolygon, holes } = this._encompassingPolygonsWithHoles(origin, type);
    if ( !encompassingPolygon ) return [];
    if ( !holes.size ) return [encompassingPolygon];

    // Union the holes
    const paths = ClipperPaths.fromPolygons(holes);
    const combined = paths.combine();

    // Diff the encompassing polygon against the holes
    const diffPath = combined.diffPolygon(encompassingPolygon);
    return diffPath.toPolygons();
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
