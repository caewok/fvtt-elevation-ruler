/* globals
canvas,
CONFIG,
CONST,
foundry,
game,
PIXI,
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { OTHER_MODULES, MODULE_ID } from "./const.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "./geometry/const.js";
import { Settings } from "./settings.js";
import { segmentBounds } from "./util.js";
import { almostLessThan } from "./geometry/util.js";
import { Draw } from "./geometry/Draw.js";
import { ObstacleOcclusionTest } from "./geometry/ObstacleOcclusionTest.js";

/** @type {number} */
const EPSILON = 1e-06; // Precision tolerance.

/**
 * Half-edge data structure for Foundry walls.
 * Every undirected edge is represented as two directed half-edges.
 * Allows efficient traversal of faces and vertices.
 */
class Segment {
  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  b = new PIXI.Point();

  /** @type {PlaceableObject|IterableWeakSet<PlaceableObject>} */
  objects = new foundry.utils.IterableWeakSet();

  constructor(a, b) {
    this.a.copyFrom(a);
    this.b.copyFrom(b);
  }

  /**
   * @returns {PIXI.Rectangle}
   */
  getBounds(out) {
    using min = this.a.min(this.b);
    using delta = PIXI.Point.tmp;
    this.a.subtract(this.b, delta).abs(delta);

    // Ensure the bounds completely contain the segment.
    min.x -= 1;
    min.y -= 1;
    delta.x += 2;
    delta.y += 2;

    // Construct rectangular bounds.
    out ??= new PIXI.Rectangle();
    out.x = min.x;
    out.y = min.y;
    out.width = delta.x;
    out.height = delta.y;
    return out;
  }

  /**
   * Is point collinear to the segment and within its bounds?
   * @param {PIXI.Point} pt
   * @returns {boolean}
   */
  isPointOnSegment(pt) {
    if ( !foundry.utils.orient2dFast(this.a, this.b, pt).almostEqual(0, EPSILON) ) return false;

    // Point is on the segment line.
    // In order to be within the segment, the point must be within the segment distance of a and b.
    const dist2 = PIXI.Point.distanceSquaredBetween(this.a, this.b);
    const distA = PIXI.Point.distanceSquaredBetween(this.a, pt);
    const distB = PIXI.Point.distanceSquaredBetween(this.b, pt);
    return almostLessThan(distA, dist2, EPSILON) && almostLessThan(distB, dist2, EPSILON);
  }

  static fromEdge(edge) {
    const out = new this(edge.a, edge.b);
    if ( edge.object ) out.objects.add(edge.object);
    return out;
  }
}


// ----- NOTE: Core data structures ----- //

class Vertex extends PIXI.Point {

  incidentEdge = null; // One half-edge starting here.

}

class HalfEdge {
  /** @type {Vertex} */
  origin = new Vertex(); // Vertex where edge starts.

  /** @type {HalfEdge} */
  twin = null; // Opposite half-edge.

  /** @type {HalfEdge} */
  next = null; // Next half-edge in the face loop.

  /** @type {Face} */
  face = null; // Face to the left.

  /** @type {HalfEdge} */
  angle = 0; // Used for sorting around vertices.

  /** @type {Set<string>} */
  objects = new foundry.utils.IterableWeakSet(); // Placeable objects represented by this edge

  /** @type {PIXI.Rectangle} */
  get bounds() { return segmentBounds(this.origin, this.twin.origin); }

  /**
   * Copy the point
   */
  static fromPoint(pt) {
    const out = new this();
    out.origin.copyFrom(pt);
    return out;
  }

  /**
   * Store this specific vertex as the origin, instead of copying.
   */
  static fromVertex(v) {
    const out = new this();
    out.origin = v;
    return out;
  }

  draw(opts = {}) {
    opts.color ??= Draw.COLORS.blue;
    opts.alpha ??= 0.5;
    Draw.segment({ a: this.origin, b: this.twin.origin }, opts);
  }

  drawTwin(opts = {}) {
    opts.color ??= Draw.COLORS.red;
    opts.alpha ??= 0.5;
    using delta = this.twin.origin.subtract(this.origin);
    delta.normalize(delta);
    using spacer = PIXI.Point.tmp.set(-delta.y * 2, delta.x * 2);
    Draw.segment({ a: this.origin.add(spacer), b: this.twin.origin.add(spacer) }, opts);
  }

  /**
   * Does this edge block?
   * @param {ElevatedPoint} origin      Origin of the move
   * @param {Token} moveToken           The token doing the moving
   * @param {number} [elevationZ]       Elevation of the point or origin to test;
   *                                    will be inferred from origin or moveToken
   * @returns {boolean}
   */
  placeableBlocks(origin, moveToken, elevationZ) {
    elevationZ ??= origin.z ?? moveToken.bottomZ ?? 0; // For consistency.
    for ( let placeable of this.objects ) {
      if ( placeable instanceof foundry.canvas.geometry.edges.Edge ) placeable = placeable.object;
      if ( placeable instanceof foundry.canvas.placeables.Wall
        && this.constructor.wallBlocks(placeable, origin, moveToken, elevationZ) ) return true;
      else if ( placeable instanceof foundry.canvas.placeables.Token
        && this.constructor.tokenBlocks(placeable, moveToken)
        && elevationZ.between(moveToken.topZ, moveToken.bottomZ) ) return true;
    }
    return false;
  }

  /**
   * Does this edge wall block from an origin somewhere?
   * Tested "live" and not cached so door or wall orientation changes need not be tracked.
   * @param {Wall} wall               Wall to test
   * @param {ElevatedPoint} origin    Measure wall blocking from perspective of this origin point.
   * @param {Token} moveToken         Token doing the move
   * @param {number} [elevationZ]     Elevation of the point or origin to test;
   *                                  will be inferred from origin or moveToken
   * @returns {boolean}
   */
  static wallBlocks(wall, origin, moveToken, elevationZ) {
    if ( !wall.document.move || wall.isOpen ) return false;

    // Ignore one-directional walls which are facing away from the center
    const side = wall.edge.orientPoint(origin);

    /* Unneeded?
    const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
    if ( wall.document.dir
      && (wallDirectionMode === wdm.NORMAL) === (side === wall.document.dir) ) return false;
    */

    if ( wall.document.dir
      && side === wall.document.dir ) return false;

    // Test for wall height. If elevation at the wall bottom, wall blocks; if at wall top it does not.
    elevationZ ??= origin.z || moveToken.bottomZ || 0;
    if ( !elevationZ.between(wall.bottomZ, wall.topZ, false) && elevationZ !== wall.bottomZ ) return false;

    // If Wall Height vaulting is enabled, walls less than token vision height do not block.
    const wh = OTHER_MODULES.WALL_HEIGHT;
    if ( wh.ACTIVE && moveToken.visionZ >= wall.topZ ) return false;
    return true;
  }

  /**
   * Could edges of this token block the moving token?
   * @param {Token} token             Token whose edges will be tested
   * @param {Token} moveToken         Token doing the move
   * @param {TokenBlockingConfig}
   * @returns {boolean}
   */
  static tokenBlocks(token, moveToken) {
    // Confirm token block setting.
    const PF = Settings.KEYS.PATHFINDING;
    const tokensBlock = Settings.get(PF.TOKENS_BLOCK);
    if ( tokensBlock === PF.TOKENS_BLOCK_CHOICES.NO ) return false;

    // Set up the blocking configuration.
    const excludedStatuses = CONFIG[MODULE_ID].pathfindingIgnoreStatuses;
    const { dead, live, prone } = CONFIG[MODULE_ID].tokensBlock;
    const blockingCfg = {
      dead,
      live,
      prone,
      enemies: true, // Per above, TOKENS_BLOCK_CHOICES must be HOSTILE or ALL
      allies: tokensBlock === PF.TOKENS_BLOCK_CHOICES.ALL,
      excludedStatuses,
    };
    return ObstacleOcclusionTest.tokenBlocks(token, moveToken, blockingCfg);
  }
}


class Face {
  /** @type {enum} */
  static ENCLOSURE_TYPES = {
    OUTSIDE: 0,
    ENCLOSED: 1,
  };

  /** @type {HalfEdge} */
  outerEdge = null; // One edge of the boundary.

  /** @type {ENCLOSURE_TYPES} */
  type;

  /** @type {PIXI.Polygon} */
  #polygon;

  get polygon() {
    return (this.#polygon ||= new PIXI.Polygon(...this.iterateVertices()));
  }

  clearCache() { this.#polygon = undefined; }


  /**
   * A generator that yields each half-edge of this face in sequence.
   * @yields {HalfEdge}
   */
  *iterateEdges() {
    const MAX_ITER = 1000;
    let safety = 0;
    let curr = this.outerEdge;
    if ( !curr ) return;
    const start = curr;
    do {
      yield curr;
      curr = curr.next;
    } while ( curr !== start && safety++ < MAX_ITER );
  }

  /**
   * A generator that yields each vertex of a face in sequence.
   * @yields {Vertex}
   */
  *iterateVertices() {
    for ( const edge of this.iterateEdges() ) yield edge.origin;
  }

  /**
   * Calculate the signed area of a face using the shoelace formula.
   * @returns {number} Positive for CCW, negative for CW
   */
  get area() {
    let area = 0;

    for ( const he of this.iterateEdges() ) {
      const p1 = he.origin;
      const p2 = he.twin.origin;
      area += (p1.x * p2.y) - (p2.y * p1.y);
    }
    return area / 2;
  }

  /**
   * Does this face contain this point?
   * @param {Point} pt
   * @returns {boolean}
   */
  contains({ x, y } = {}) { return this.polygon.contains(x, y); }

  /**
   * Draw this face.
   */
  draw(opts = {}) {
    if ( !opts.fill ) {
      const colors = [Draw.COLORS.blue, Draw.COLORS.red, Draw.COLORS.orange, Draw.COLORS.yellow, Draw.COLORS.green];
      const idx = Math.floor(Math.random() * colors.length);
      opts.fill = colors[idx];
    }
    opts.fillAlpha ??= 0.5;
    const poly = new PIXI.Polygon([...this.iterateVertices()]);
    Draw.shape(poly, opts);
  }
}

export class EdgeGraph {
  /** @type {Map<Vertex>} */
  vertices = new Map();

  /** @type {HalfEdge[]} */
  halfEdges = [];

  /** @type {Face[]} */
  faces = [];

  /** @type {CanvasQuadtree} */
  quadtree = new foundry.canvas.geometry.CanvasQuadtree();

  // ----- NOTE: Static factory methods ----- //

  /**
   * Scan canvas and build graph.
   */
  static buildFromCanvas({ useWalls = true, useTokens = true } = {}) {
    const wallSegmentMap = useWalls ? this.wallSegments() : new Map();
    const tokenSegmentMap = useTokens ? this.tokenSegments() : new Map();
    const segments = this.splitIntersections({ wallSegmentMap, tokenSegmentMap });
    const out = new this();
    out.assembleGraph(segments);
    return out;
  }

  // ----- NOTE: Static canvas placeable methods ----- //

  /**
   * Build segments from walls.
   * @returns {Map<id, Segment>}
   */
  static wallSegments(walls) {
    walls ??= canvas.walls.placeables;
    const m = new Map();
    walls.forEach(w => m.set(w.id, Segment.fromEdge(w.edge)));
    return m;
  }

  /**
   * Build segments from tokens.
   * @returns {Map<id, Segment[]>}
   */
  static tokenSegments(tokens) {
    tokens ??= canvas.tokens.placeables;
    const m = new Map();
    tokens.forEach(token => {
      const segments = this._tokenSegments(token);
      m.set(token.id, segments);
    });
    return m;
  }

  static _tokenSegments(token) {
    return [...token.constrainedTokenBorder.iterateEdges()].map(edge => {
      const s = new Segment(edge.a, edge.b);
      s.objects.add(token);
      return s;
    });
  }

  static splitIntersections(opts) {
    const res = this._splitIntersections(opts);
    const segments = this._fragmentSegments(res.segments, res.allPoints);
    return this._removeDuplicateSegments(segments);
  }

  /**
   * Split segments at any point where they cross or overlap.
   * @param {Segment[]}
   * @returns {Segment[]}
   */
  static _splitIntersections({ wallSegmentMap = new Map(), tokenSegmentMap = new Map() }) {
    const allPoints = [];
    const bounds = new PIXI.Rectangle();
    let i = 0;
    const segments = [...wallSegmentMap.values(), ...tokenSegmentMap.values().flatMap(arr => arr)];
    for ( const segment of segments ) {
      const ptSet = allPoints[i] ??= new Set();
      i += 1;

      // Define bounding box for quadtree and retrieve candidate segments within the bounds.
      segment.getBounds(bounds);
      if ( wallSegmentMap.size ) {
        const candidates = canvas.walls.quadtree.getObjects(bounds);
        const candidateSegments = candidates.map(wall => wallSegmentMap.get(wall.id));
        this._findIntersectingPoints(segment, candidateSegments, ptSet);
      }
      if ( tokenSegmentMap.size ) {
        const candidates = canvas.tokens.quadtree.getObjects(bounds);
        const candidateSegments = [...candidates].flatMap(token => tokenSegmentMap.get(token.id));
        this._findIntersectingPoints(segment, candidateSegments, ptSet);
      }
    }
    return { segments, allPoints };
  }

  static _findIntersectingPoints(s1, candidateSegments, ptSet = new Set()) {
    // Always include the endpoints for this segment.
    ptSet.add(s1.a.key);
    ptSet.add(s1.b.key);

    // Test candidate segments for intersection with this segment.
    using tmpPt = PIXI.Point.tmp;
    for ( let s2 of candidateSegments ) {
      if ( iterableWeakSetIntersects(s1.objects, s2.objects) ) continue; // Do not compare with itself.

      // Standard intersection.
      if ( foundry.utils.lineSegmentIntersects(s1.a, s1.b, s2.a, s2.b) ) {
        const ix = foundry.utils.lineLineIntersection(s1.a, s1.b, s2.a, s2.b);
        ptSet.add(tmpPt.set(ix.x, ix.y).key);
      }

      // B. Check for T-Junctions / Collinear Overlaps
      // Does s2's endpoint land on s1's line?
      if ( s1.isPointOnSegment(s2.a) ) ptSet.add(s2.a.key);
      if ( s1.isPointOnSegment(s2.b) ) ptSet.add(s2.b.key);
    }
    return ptSet;
  }

  /**
   * Fragment segments into sub-segments.
   * @param {Segment[]} segments
   * @param {Set<PIXI.Point.key>[]} allPoints
   * @returns {Segment[]}
   */
  static _fragmentSegments(segments, allPoints) {
    const fragmented = [];
    for ( let i = 0, iMax = segments.length; i < iMax; i += 1 ) {
      const pts = Array.from(allPoints[i]).map(key => PIXI.Point.invertKey(key));
      const s = segments[i];

      // Sort points along the line segment (distance from start point).
      pts.sort((p1, p2) => {
        p1.t0 ??= PIXI.Point.distanceSquaredBetween(s.a, p1);
        p2.t0 ??= PIXI.Point.distanceSquaredBetween(s.a, p2);
        return p1.t0 - p2.t0;
      });

      for ( let k = 0, kMax = pts.length - 1; k < kMax; k += 1 ) {
        const fragS = new Segment(pts[k], pts[k + 1]);
        iterableWeakSetAddMultiple(fragS.objects, s.objects);
        fragmented.push(fragS);
      }
    }
    return fragmented;
  }

  static _removeDuplicateSegments(segments) {
    const unique = new Map();
    for ( const s of segments ) {
      // Sort a and b so (p1, p2) is the same as (p2, p1) for the key.
      const key = [s.a.key, s.b.key].sort().join("|");
      if ( unique.has(key) ) {
        const uniqueS = unique.get(key);
        iterableWeakSetAddMultiple(uniqueS.objects, s.objects);
      } else unique.set(key, s);
    }
    return Array.from(unique.values());
  }

  // ----- NOTE: Graph properties ----- //

  /**
   * Do any graph edges reference this placeable?
   * @param {Placeable} placeable
   */
  hasPlaceable(placeable) {
    for ( const he of this.halfEdges ) {
      if ( he.objects.has(placeable) ) return true;
    }
    return false;
  }

  // ----- NOTE: Methods ----- //

  /**
   * Get a vertex or create a new one. The vertex will not (yet) be linked.
   * @param {PIXI.Point} pt
   * @returns {Vertex}
   */
  getVertex(pt) {
    const key = pt.key;
    if ( !this.vertices.has(key) ) {
      const v = new Vertex(pt.x, pt.y);
      this.vertices.set(key, v);
    }
    return this.vertices.get(key);
  }

  /**
   * Link vertices and half-edges to form the topological structure.
   * @param {Segment[]} segments
   */
  assembleGraph(segments) {
    // Create paired half-edges.
    for ( const s of segments ) this.#createNewHalfEdgePair(s.a, s.b, s.objects);
    this._linkNextEdges();
    this._identifyFaces();
  }

  /**
   * For each vertex, link the next half-edges, sorted by angle.
   */
  _linkNextEdges() {
    for ( let v of this.vertices.values() ) {
      // Equivalent? const outgoing = this.halfEdges.filter(he => he.origin.equals(v));
      const outgoing = this.halfEdges.filter(he => he.origin === v);
      outgoing.sort((a, b) => a.angle - b.angle);

      for ( let i = 0, iMax = outgoing.length; i < iMax; i += 1 ) {
        // Next edge of a twin is the next edge in CCW order.
        const current = outgoing[i];
        const nextInRadial = outgoing[(i + 1) % outgoing.length];
        current.twin.next = nextInRadial;
      }
    }
  }

  /**
   * Identify faces for the half edges.
   */
  _identifyFaces() {
    this.faces.length = 0;
    const visited = new Set();
    for ( let he of this.halfEdges ) {
      if ( visited.has(he) ) continue;

      const face = new Face();
      face.outerEdge = he;
      let curr = he;
      while ( !visited.has(curr) ) {
        visited.add(curr);
        curr.face = face;
        curr = curr.next;
      }
      this.faces.push(face);
    }
    this.classifyFaces();
  }

  // ----- NOTE: Faces ----- //

  /**
   * Iterates through all the faces and labels them.
   */
  classifyFaces() {
    let largestArea = Number.NEGATIVE_INFINITY;
    let outerFace = null;

    for ( const face of this.faces ) {
      const area = face.area;
      face.type = Face.ENCLOSURE_TYPES.ENCLOSED;

      // In screen-space (Y-down), the largest negative area
      // is typically the boundary of the entire graph.
      if ( area < 0 && Math.abs(area) > largestArea ) {
        largestArea = Math.abs(area);
        outerFace = face;
      }
    }

    if ( outerFace ) outerFace.type = Face.ENCLOSURE_TYPES.OUTSIDE;
    return {
      enclosed: this.faces.filter(f => f.type === Face.ENCLOSURE_TYPES.ENCLOSED),
      outside: outerFace,
    };
  }

  // ----- NOTE: Graph modification ----- //

  /**
   * Check for any edges with an empty object set and remove those edges.
   */
  clean() {
    const toRemove = new Set();
    for ( const he of this.halfEdges ) {
      const objects = [...he.objects]; // Have to iterate to get the current objects.
      if ( !objects.length ) toRemove.add(he);
    }
    if ( toRemove.size ) this._removeEdges(toRemove);
  }

  /**
   * Remove edges related to a specific placeable and clean the graph.
   * @param {PlaceableObject} placeable
   */
  removePlaceable(placeable) {
    for ( const he of this.halfEdges ) he.objects.delete(placeable);

    // Call clean so all empty edges are removed, not just this placeable.
    this.clean();
  }

  /**
   * Remove edges in a set and relink graph.
   * @param {Set<HalfEdge>} heSet
   */
  _removeEdges(heSet) {
    for ( const he of heSet ) this.#removeEdge(he);

    // Filter the main list.
    this.halfEdges = this.halfEdges.filter(he => !heSet.has(he));

    // Critical: Re-link topology and re-identify faces.
    this._linkNextEdges();
    this._identifyFaces();
  }

  /**
   * Helper to remove a specific edge. Does not relink graph.
   * @param {HalfEdge} halfEdges
   */
  #removeEdge(halfEdge) {
    const v = halfEdge.origin;

    // Remove from vertex references.
    if ( v.incidentEdge === halfEdge ) {
      // Locate another incident edge that isn't this one.
      const others = this.halfEdges.find(e => e !== halfEdge && e === v);
      v.incidentEdge = others || null;
    }

    // If vertex is isolated, remove.
    if ( !v.incidentEdge ) this.vertices.delete(v.key);

    this.quadtree.remove(halfEdge);
  }

  /**
   * Add a new wall
   * @param {Wall} newWall
   */
  addWall(newWall) {
    // Find where the new edge intersects existing edges already in the graph.
    // Split new wall and existing and integrate the new fragments.
    this.addSegments([Segment.fromEdge(newWall.edge)]);
  }

  /**
   * Add a new token.
   * @param {Token} token
   */
  addToken(newToken) {
    this.addSegments(this.constructor._tokenSegments(newToken));
  }

  addSegments(newSegments) {
    for ( const s of newSegments ) this.#addSegment(s);
    this._linkNextEdges();
    this._identifyFaces();
  }

  #addSegment(newSegment) {
    const pointsOnNewSegment = new Set();

    // Add endpoints as potentially new.
    pointsOnNewSegment.add(newSegment.a.key);
    pointsOnNewSegment.add(newSegment.b.key);

    // Check intersections against one side of existing half-edges.
    const checked = new Set();
    using tmpPt = PIXI.Point.tmp;
    for ( const edge of this.halfEdges ) {
      if ( checked.has(edge) || checked.has(edge.twin) ) continue;
      checked.add(edge);

      const s2A = edge.origin;
      const s2B = edge.twin.origin;
      if ( foundry.utils.lineSegmentIntersects(newSegment.a, newSegment.b, s2A, s2B) ) {
        const ix = foundry.utils.lineLineIntersection(newSegment.a, newSegment.b, s2A, s2B);
        const ixPt = tmpPt.set(ix.x, ix.y);
        const ixKey = ixPt.key;
        pointsOnNewSegment.add(ixKey);

        // If intersection is not existing vertex, split the existing edge.
        if ( ixKey !== s2A.key && ixKey !== s2B.key ) this.#splitExistingEdge(edge, ixPt);
      }
    }

    // Create the new fragments for the added wall.
    const pts = Array.from(pointsOnNewSegment).map(key => PIXI.Point.invertKey(key));
    pts.sort((p1, p2) => {
      p1.t0 ??= PIXI.Point.distanceSquaredBetween(newSegment.a, p1);
      p2.t0 ??= PIXI.Point.distanceSquaredBetween(newSegment.a, p2);
      return p1.t0 - p2.t0;
    });
    for ( let i = 0, iMax = pts.length - 1; i < iMax; i += 1 ) {
      this.#createNewHalfEdgePair(pts[i], pts[i + 1], newSegment.objects);
    }
  }

  /**
   * Split an existing edge pair by inserting a new vertex in the middle.
   * @param {HalfEdge} edge
   * @param {Point} point
   */
  #splitExistingEdge(edge, point) {
    const vNew = this.getVertex(point);

    // Shorten the existing edge to end at vNew.
    // (In this structure, that means creating a new pair from vNew to vEnd.)
    const vEnd = edge.twin.origin;
    edge.twin.origin = vNew;
    this.#createNewHalfEdgePair(vNew, vEnd, edge.objects);
  }

  /**
   * Create a new pair of half-edges, linking accordingly.
   * @param {Point} pt1       Will be replaced by equivalent vertex
   * @param {Point} pt2       Will be replaced by equivalent vertex
   * @param {PlaceableObject[]}   Objects represented by this edge
   */
  #createNewHalfEdgePair(pt1, pt2, objects = []) {
    const v1 = this.getVertex(pt1);
    const v2 = this.getVertex(pt2);
    const he1 = HalfEdge.fromVertex(v1);
    const he2 = HalfEdge.fromVertex(v2);
    for ( const elem of objects ) {
      he1.objects.add(elem);
      he2.objects.add(elem);
    }
    he1.twin = he2;
    he2.twin = he1;
    using delta = v2.subtract(v1);
    he1.angle = Math.atan2(delta.y, delta.x);
    he2.angle = Math.atan2(-delta.y, -delta.x);

    this.halfEdges.push(he1, he2);
    this.quadtree.insert({ r: he1.bounds, t: he1 }); // Only insert one of the pair.
    v1.incidentEdge = he1;
    v2.incidentEdge = he2;
  }

  // ----- NOTE: Point testing ----- //

  pointIsInFace(pt) {
    for ( const face of this.faces ) {
      if ( face.type === Face.ENCLOSURE_TYPES.OUTSIDE ) continue;
      if ( face.polygon.contains(pt.x, pt.y) ) return face;
    }
    return false;
  }

  enclosedFacesForPoint(pt) {
    const faces = new Set();
    for ( const face of this.faces ) {
      if ( face.type === Face.ENCLOSURE_TYPES.OUTSIDE ) continue;
      if ( face.polygon.contains(pt.x, pt.y) ) faces.add(face);
    }
    return faces;
  }

  // ----- NOTE: Collision testing ----- //

  /**
   * Instead of a typical `token.checkCollision` test, test for collisions against the edge graph.
   * With this approach, collisions with enemy tokens may trigger pathfinding based on settings.
   * @param {PIXI.Point} a          Origin point for the move
   * @param {PIXI.Point} b          Destination point for the move
   * @param {Token} token           Token that is moving
   * @returns {boolean}
   */
  hasCollision(a, b, moveToken) {
    const lineSegmentIntersects = foundry.utils.lineSegmentIntersects;
    const edges = this.quadtree.getObjects(segmentBounds(a, b));
    return edges.some(edge => lineSegmentIntersects(a, b, edge.origin, edge.twin.origin)
      && edge.placeableBlocks(a, moveToken));
  }

  /**
   * Combine edge test with separate token blocking test in 3d.
   * Used if the edge graph does not contain token edges but token collisions should still be tested.
   * @param {PIXI.Point} a          Origin point for the move
   * @param {PIXI.Point} b          Destination point for the move
   * @param {Token} moveToken       Token that is moving
   * @returns {boolean}
   */
  pathBlocked(a, b, moveToken) {
    return this.hasCollision(a, b, moveToken) || this.constructor.tokenBlocksSegment(a, b, moveToken);
  }

  /**
   * Is this segment blocked by a token?
   * Helper to use even if tokens are not in the edge graph.
   * Likely faster than tracking tokens in the edge graph unless there is a reason
   * to track how tokens and walls connect. Also handles 3d.
   * @param {GridCoordinates3d} a       Start of the path segment
   * @param {GridCoordinates3d} b       End of the path segment
   * @param {Token} moveToken           Token doing the movement
   * @returns {boolean} True if blocked
   */
  static tokenBlocksSegment(a, b, moveToken) {
    // NOTE: rayIntersection will return false if a.z is at the edge of the token.
    // For example, if a.z === 0, tokens at elevation 0 will not block.
    using dir = b.subtract(a);
    for ( const token of canvas.tokens.placeables ) {
      // console.debug(`tokenBlocksSegment|${moveToken.name} --> ${token.name}`);
      const geom = token[GEOMETRY_LIB_ID][GEOMETRY_ID];
      if ( !geom ) continue;
      if ( !HalfEdge.tokenBlocks(token, moveToken) ) continue;
      const ix = geom.rayIntersection(a, dir);
      if ( ix ) return true;
    }
    return false;
  }

  // ----- NOTE: Drawing ----- //

  drawEdges() {
    const seen = new Set();
    this.halfEdges.forEach(he => {
      if ( seen.has(he) ) return;
      he.draw();
      seen.add(he);

      if ( seen.has(he.twin) ) return;
      he.drawTwin();
      seen.add(he.twin);
    });
  }

  drawVertices() {
    this.vertices.forEach(v => Draw.point(v, { radius: 2 }));
  }

  drawFaces() {
    this.faces.forEach(face => face.draw());
  }
}

function iterableWeakSetAddMultiple(orig, toAdd) {
  for ( const value of toAdd ) orig.add(value);
}

function iterableWeakSetIntersects(s1, s2) {
  for ( const value of s1 ) {
    if ( s2.has(value) ) return true;
  }
  return false;
}

/** Testing
api = game.modules.get("elevationruler").api;
EdgeGraph = api.EdgeGraph
Draw = CONFIG.GeometryLib.lib.Draw

wallSegmentMap = EdgeGraph.wallSegments()
tokenSegmentMap = EdgeGraph.tokenSegments()


res = EdgeGraph._splitIntersections({ wallSegmentMap })
res = EdgeGraph._splitIntersections({ tokenSegmentMap })
res.segments.forEach(s => Draw.segment(s))
res.allPoints.forEach(ptSet => ptSet.forEach(key => Draw.point(PIXI.Point.invertKey(key))))


segments = EdgeGraph._fragmentSegments(res.segments, res.allPoints);
segments = EdgeGraph._removeDuplicateSegments(segments)

segments = EdgeGraph.splitIntersections(EdgeGraph.wallSegments());
segments = EdgeGraph.splitIntersections(EdgeGraph.tokenSegments());
segments = EdgeGraph.splitIntersections([...EdgeGraph.wallSegments(), ...EdgeGraph.tokenSegments());

segments.forEach(s => Draw.segment(s))

graph = EdgeGraph.buildFromCanvas()
graph.drawEdges()
graph.drawVertices()
graph.drawFaces()
res = graph.classifyFaces()
[...res.outside.iterateVertices()].forEach(v => Draw.point(v))

// Remove walls, tokens.
for ( const wall of canvas.walls.placeables ) {
  graph.removePlaceable(wall)
}
for ( const token of canvas.tokens.placeables ) {
  graph.removePlaceable(token)
}

for ( const wall of canvas.walls.placeables ) {
  graph.addWall(wall)
}
for ( const token of canvas.tokens.placeables ) {
  graph.addToken(token)
}

// Build one wall and token at a time.

*/
