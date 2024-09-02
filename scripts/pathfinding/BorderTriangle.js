/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
Token,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { WallTracerEdge } from "./WallTracer.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { Settings } from "../settings.js";

const OTHER_DIRECTION = {
  ccw: "cw",
  cw: "ccw"
};

const OTHER_TRIANGLE = {
  cwTriangle: "ccwTriangle",
  ccwTriangle: "cwTriangle"
};

/**
 * An edge that makes up the triangle-shaped polygon
 */
export class BorderEdge {
  /**
   * If CONST.TOKEN_DISPOSITIONS.NEUTRAL, blocks none.
   * If CONST.TOKEN_DISPOSITIONS.FRIENDLY, blocks if the tokenDisposition is same as token edge
   * If CONST.TOKEN_DISPOSITIONS.HOSTILE, blocks if the tokenDisposition is opposite from token edge
   * Otherwise, blocks all.
   * Tokens with secret dispositions always block unless tokenBlockType is 0.
   * @type {CONST.TOKEN_DISPOSITIONS}
   */
  static tokenBlockType = CONST.TOKEN_DISPOSITIONS.SECRET;

  /** @type {Token} */
  static moveToken;

  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  b = new PIXI.Point();

  /** @type {Set<number>} */
  endpointKeys = new Set();

  /** @type {BorderTriangle} */
  cwTriangle;

  /** @type {BorderTriangle} */
  ccwTriangle;

  /**
   * Placeable objects represented by this edge.
   * @type {Set<PlaceableObject>}
   */
  objects = new Set();

  constructor(a, b) {
    this.a.copyFrom(a);
    this.b.copyFrom(b);
    this.endpointKeys.add(this.a.key);
    this.endpointKeys.add(this.b.key);
  }

  /** @type {PIXI.Point} */
  #median;

  get median() { return this.#median || (this.#median = this.a.add(this.b).multiplyScalar(0.5)); }

  /** @type {number} */
  #length;

  get length() { return this.#length || (this.#length = this.b.subtract(this.a).magnitude()); }

  /**
   * Get the other triangle for this edge.
   * @param {BorderTriangle}
   * @returns {BorderTriangle}
   */
  otherTriangle(triangle) { return this.cwTriangle === triangle ? this.ccwTriangle : this.cwTriangle; }

  /**
   * Get the triangle either cw or ccw to this edge, as measured from a given vertex key.
   * vertexKey --> otherVertex --> otherTriangleVertex
   * @param {number} vertexKey        Key for the anchor vertex
   * @param {string} [direction]      Either ccw or cw
   * @returns {BorderTriangle}
   */
  findTriangleFromVertexKey(vertexKey, dir = "ccw") {
    const [a, b] = this.a.key === vertexKey ? [this.a, this.b] : [this.b, this.a];

    if ( this.ccwTriangle ) {
      const cCCW = this._nonSharedVertex(this.ccwTriangle);
      return (foundry.utils.orient2dFast(a, b, cCCW) > 0) ^ (dir !== "ccw") ? this.ccwTriangle : this.cwTriangle;
    } else {
      const cCW = this._nonSharedVertex(this.cwTriangle);
      return (foundry.utils.orient2dFast(a, b, cCW) < 0) ^ (dir !== "cw") ? this.cwTriangle : this.ccwTriangle;
    }
  }

  /**
   * Get the non-shared vertex for a triangle of this edge.
   * @param {number} vertexKey
   * @param {BorderTriangle} [tri]    The shared triangle with this edge
   * @returns {Point}
   */
  _nonSharedVertex(tri = this.ccwTriangle) {
    return Object.values(tri.vertices).find(v => !this.endpointKeys.has(v.key));
  }

  /**
   * Remove the triangle link.
   * @param {BorderTriangle}
   */
  removeTriangle(triangle) {
    if ( this.cwTriangle === triangle ) this.cwTriangle = undefined;
    if ( this.ccwTriangle === triangle ) this.ccwTriangle = undefined;
  }

  /**
   * Provide valid destinations for this edge.
   * Blocked walls are invalid.
   * Typically returns 2 corner destinations plus the median destination.
   * If the edge is less than 2 * spacer, no destinations are valid.
   * @param {Point} center              Test if wall blocks from perspective of this origin point
   * @param {number} elevation          Assumed elevation of the move, for testing blocking walls, tokens
   * @param {number} [spacer]           How much away from the corner to set the corner destinations
   *   If the edge is less than 2 * spacer, it will be deemed invalid.
   *   Corner destinations are skipped if not more than spacer away from median.
   * @returns {PIXI.Point[]}
   */
  getValidDestinations(origin, elevation, spacer) {
    elevation ??= 0;
    spacer ??= canvas.grid.size * 0.5;
    const length = this.length;
    const destinations = [];

    // If both vertices block, limit destinations to edges 2x spacer.
    // (Strongly suggests a hallway or other walling on both sides of the edge.)
    // Otherwise, don't test for spacer because edges could be non-blocking on either side,
    // which increases the size of the space.
    // For doors, let the token through regardless.
    if ( this.edgeBlocks(origin, elevation) ) return destinations;
    if ( !this.isOpenDoor
       && this.vertexBlocks(this.a.key)
       && this.vertexBlocks(this.b.key)
       && length < (spacer * 1.9) ) return destinations;
    destinations.push(this.median);

    // Skip corners if not at least spacer away from median.
    // Again, cheat a little on the spacing.
    if ( length < (spacer * 3.9) ) return destinations;

    const { a, b } = this;
    const t = spacer / length;
    destinations.push(
      a.projectToward(b, t),
      b.projectToward(a, t));
    return destinations;
  }

  /**
   * Determine if this is an open door with nothing else blocking.
   * @type {boolean}
   */
  get isOpenDoor() {
    if ( !this.objects.size ) return false;
    const { moveToken, tokenBlockType } = this.constructor;
    return this.objects.every(obj =>
      (obj instanceof Wall) ? obj.isOpen
        : (obj instanceof Token ) ? !WallTracerEdge.tokenEdgeBlocks(obj, moveToken, tokenBlockType)
          : true);
  }

  /**
   * Compilation of tests based on edge type for whether this wall blocks.
   * @param {Point} origin    Measure wall blocking from perspective of this origin point.
   * @returns {boolean}
   */
  edgeBlocks(origin, elevation = 0) {
    if ( !origin ) {
//       if ( !this.ccwTriangle || !this.cwTriangle || !this.ccwTriangle.center || !this.cwTriangle.center) {
//         console.warn("edgeBlocks|Triangle centers not defined.");
//         return false;
//       }
      const ccwBlocks = this.ccwTriangle ? this.edgeBlocks(this.ccwTriangle.center, elevation) : false;
      const cwBlocks = this.cwTriangle ? this.edgeBlocks(this.cwTriangle.center, elevation) : false;
      return ccwBlocks || cwBlocks;
    }

    const { moveToken, tokenBlockType } = this.constructor;
    return this.objects.some(obj => {
      if ( obj instanceof Wall ) return WallTracerEdge.wallBlocks(obj, origin, moveToken, elevation);
      if ( obj instanceof Token ) return WallTracerEdge.tokenEdgeBlocks(obj, moveToken, tokenBlockType, elevation);
      return false;
    });
  }

  /**
   * Link a triangle to this edge, replacing any previous triangle in that position.
   */
  linkTriangle(triangle) {
    const { a, b } = this;
    if ( !triangle.endpointKeys.has(a.key)
      || !triangle.endpointKeys.has(b.key) ) throw new Error("Triangle does not share this edge!");

    const { a: aTri, b: bTri, c: cTri } = triangle.vertices;
    const otherEndpoint = !this.endpointKeys.has(aTri.key) ? aTri
      : !this.endpointKeys.has(bTri.key) ? bTri
        : cTri;

    // Debugging
    if ( !this.endpointKeys.has(aTri.key)
      && !this.endpointKeys.has(bTri.key)
      && !this.endpointKeys.has(cTri.key) ) console.error(`Triangle ${triangle.id} keys not found ${aTri.key}, ${bTri.key}, ${cTri.key}`, this);

    const orient2d = foundry.utils.orient2dFast;
    const oABE = orient2d(a, b, otherEndpoint);

    // Debugging
    if ( oABE === 0 ) console.error(`Triangle ${triangle.id} collinear to this edge at ${otherEndpoint.x},${otherEndpoint.y}`, this);

    if ( orient2d(a, b, otherEndpoint) > 0 ) this.ccwTriangle = triangle;
    else this.cwTriangle = triangle;
  }

  /**
   * Test if at least one edge of this vertex is blocking.
   * (Used to decide when to limit movement through the edge.)
   * Does not test this edge.
   * @param {number} vertexKey
   * @param {Point} origin    Measure wall blocking from perspective of this origin point.
   * @returns {boolean}
   */
  vertexBlocks(vertexKey, elevation = 0) {
    const iter = this.sharedVertexEdges(vertexKey);
    for ( const edge of iter ) {
      // if ( !edge.ccwTriangle || !edge.cwTriangle ) console.warn("vertexBlocks|Edge triangles not defined."); // Debugging.
      if ( edge === this ) continue; // Could break here b/c this edge implicitly is always last.
      if ( edge.edgeBlocks(undefined, elevation) ) return true;
    }
  }

  /**
   * Iterator to retrieve all edges that share the given vertex.
   * @param {number} vertexKey
   * @yields {BorderEdge}
   */
  *sharedVertexEdges(vertexKey) {
    // Circle around the vertex, retrieving each new edge of the triangles in turn.
    let currEdge = this;
    let iter = 0;
    const MAX_ITER = 1000;
    do {
      currEdge = currEdge._nextEdge(vertexKey, "ccw");
      yield currEdge;
      iter += 1;
      if ( iter > MAX_ITER ) {
        console.warn("sharedVertexEdges iterations exceeded.");
        break;
      }
    } while ( currEdge !== this );
  }

  /**
   * Retrieve the next ccw edge that shares the given vertex for the given triangle.
   * @param {number} vertexKey        Key for the anchor vertex
   * @param {string} [direction]      Either ccw or c.
   * @returns {BorderEdge}
   */
  _nextEdge(vertexKey, dir = "ccw", _recurse = true) {
    const tri = this.findTriangleFromVertexKey(vertexKey, dir);
    if ( tri ) return Object.values(tri.edges).find(e => e !== this && e.endpointKeys.has(vertexKey));

    // Edge is at a border, vertex at the corner of the border.
    // Need to run the opposite direction until we get undefined in that direction.
    if ( !_recurse ) return null;
    const maxIter = 100;
    let iter = 0;
    let edge = this;
    let prevEdge;
    const otherDir = OTHER_DIRECTION[dir];
    do {
      prevEdge = edge;
      iter += 1;
      edge = prevEdge._nextEdge(vertexKey, otherDir, false);
    } while ( iter < maxIter && edge && edge !== this );
    return prevEdge;
  }

  /**
   * For debugging.
   * Draw this edge.
   */
  draw(opts = {}) {
    if ( !Object.hasOwn(opts, "color") ) {
      const hasWall = this.objects.some(obj => obj instanceof Wall);
      const hasToken = this.objects.some(obj => obj instanceof Token);
      opts.color = (hasWall && hasToken) ? Draw.COLORS.white
        : hasWall ? Draw.COLORS.red
          : hasToken ? Draw.COLORS.orange
            : Draw.COLORS.blue;
    }

    Draw.segment({ A: this.a, B: this.b }, opts);
  }
}

/**
 * A triangle-shaped polygon.
 * Assumed static---points cannot change.
 * Note: delaunay triangles from Delaunator are oriented counterclockwise
 */
export class BorderTriangle {
  static EDGE_NAMES = ["AB", "BC", "CA"];

  vertices = {
    a: new PIXI.Point(), /** @type {PIXI.Point} */
    b: new PIXI.Point(), /** @type {PIXI.Point} */
    c: new PIXI.Point()  /** @type {PIXI.Point} */
  };

  edges = {
    AB: undefined, /** @type {BorderEdge} */
    BC: undefined, /** @type {BorderEdge} */
    CA: undefined  /** @type {BorderEdge} */
  };

  /** @type {BorderEdge} */

  /** @type {Set<number>} */
  endpointKeys = new Set();

  /** @type {number} */
  id = -1;

  /**
   * @param {Point} a
   * @param {Point} b
   * @param {Point} c
   */
  constructor(edgeAB, edgeBC, edgeCA) {
    // Determine the shared endpoint for each.
    let a = edgeCA.endpointKeys.has(edgeAB.a.key) ? edgeAB.a : edgeAB.b;
    let b = edgeAB.endpointKeys.has(edgeBC.a.key) ? edgeBC.a : edgeBC.b;
    let c = edgeBC.endpointKeys.has(edgeCA.a.key) ? edgeCA.a : edgeCA.b;

    const oABC = foundry.utils.orient2dFast(a, b, c);
    if ( !oABC ) throw Error("BorderTriangle requires three non-collinear points.");
    if ( oABC < 0 ) {
      // Flip to ccw.
      [a, c] = [c, a];
      [edgeAB, edgeCA] = [edgeCA, edgeAB];
    }

    this.vertices.a.copyFrom(a);
    this.vertices.b.copyFrom(b);
    this.vertices.c.copyFrom(c);

    this.edges.AB = edgeAB;
    this.edges.BC = edgeBC;
    this.edges.CA = edgeCA;

    Object.values(this.vertices).forEach(v => this.endpointKeys.add(v.key));
    Object.values(this.edges).forEach(e => e.linkTriangle(this));
  }

  /**
   * Construct a BorderTriangle from three points.
   * Creates three new edges.
   * @param {Point} a     First point of the triangle
   * @param {Point} b     Second point of the triangle
   * @param {Point} c     Third point of the triangle
   * @returns {BorderTriangle}
   */
  static fromPoints(a, b, c) {
    return new this(
      new BorderEdge(a, b),
      new BorderEdge(b, c),
      new BorderEdge(c, a)
    );
  }

  /** @type {Point} */
  #center;

  get center() { return this.#center
    || (this.#center = this.vertices.a.add(this.vertices.b).add(this.vertices.c).multiplyScalar(1/3)); }

  /**
   * Contains method based on orientation.
   * More inclusive than PIXI.Polygon.prototype.contains in that any point on the edge counts.
   * @param {number} x                  X coordinate of point to test
   * @param {number} y                  Y coordinate of point to test
   * @returns {boolean}
   */
  contains(pt) {
    const orient2d = foundry.utils.orient2dFast;
    const { a, b, c } = this.vertices;
    return orient2d(a, b, pt) >= 0
        && orient2d(b, c, pt) >= 0
        && orient2d(c, a, pt) >= 0;
  }

  /** @type {PIXI.Rectangle} */
  #bounds;

  get bounds() { return this.#bounds || (this.#bounds = this._getBounds()); }

  getBounds() { return this.bounds; }

  _getBounds() {
    const { a, b, c } = this.vertices;
    const xMinMax = Math.minMax(a.x, b.x, c.x);
    const yMinMax = Math.minMax(a.y, b.y, c.y);
    return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
  }

  /**
   * Provide valid destinations given that you came from a specific neighbor.
   * Typically returns 2 corner destinations plus the median destination per edge.
   * Invalid destinations for an edge:
   * - blocked walls
   * - no neighbor (edge on border of map)
   * - edge length < 2 * spacer
   * - edge shared with the prior triangle, if any
   *
   * Corner destination skipped if median --> corner < spacer
   *
   * @param {BorderTriangle|null} priorTriangle       Triangle that preceded this one along the path
   * @param {number} elevation                        Assumed elevation of the move, for testing edge walls, tokens.
   * @param {number} spacer                           How far from the corner to set the corner destinations
   * @returns {PathNode[]} Each element has properties describing the destination, conforming to pathfinding
   *   - {number} key
   *   - {PIXI.Point} entryPoint
   *   - {BorderTriangle} entryTriangle
   *   - {BorderTriangle} priorTriangle
   */
  getValidDestinations(priorTriangle, elevation, spacer) {
    spacer ??= canvas.grid.size * 0.5;
    const destinations = [];
    const center = this.center;
    for ( const edge of Object.values(this.edges) ) {
      const entryTriangle = edge.otherTriangle(this); // Neighbor
      if ( !entryTriangle || (priorTriangle && priorTriangle === entryTriangle) ) continue;
      const pts = edge.getValidDestinations(center, elevation, spacer);
      pts.forEach(entryPoint => {
        destinations.push({
          entryPoint,
          key: `${entryPoint.key}_${entryTriangle.id}`, // Key needs to be unique for each point and triangle!
          entryTriangle, // Needed to locate neighbors in the next iteration.
          priorTriangle: this // Needed to eliminate irrelevant neighbors in the next iteration.
        });
      });
    }
    return destinations;
  }

  /**
   * Retrieve destinations with cost calculation added.
   * @param {BorderTriangle|null} priorTriangle     Triangle that preceded this one along the path
   * @param {number} elevation                      Assumed elevation of the move, for testing edge walls, tokens.
   * @param {number} spacer                         How far from the corner to set the corner destinations
   * @param {Point} fromPoint                       Point to measure from, for cost
   * @param {Token} [token]                         Token doing the movement
   * @returns {PathNode[]}
   */
  getValidDestinationsWithCost(priorTriangle, elevation, spacer, fromPoint, token) {
    const destinations = this.getValidDestinations(priorTriangle, elevation, spacer);
    destinations.forEach(d => {
      d.cost = this._calculateMovementCost(fromPoint, d.entryPoint, token);

      // NaN is bad--results in infinite loop; probably don't want to set NaN to 0 cost.
      if ( !Number.isFinite(d.cost) ) d.cost = 1e06;
      d.fromPoint = fromPoint;
    });
    return destinations;
  }

  /**
   * Calculate the cost for a single path node from a given point.
   * @param {Point} fromPoint                         Where the movement starts
   * @param {Point} toPoint                           Where the movement ends
   * @param {Token} [token]                           Token doing the movement
   * @returns {number} Cost value
   */
  _calculateMovementCost(fromPoint, toPoint, token) {
    // TODO: Handle 3d distance. Probably Ray3d with measureDistance or measureDistances.
    // TODO: Handle terrain distance.
    const diagonals = Settings.get(Settings.KEYS.MEASURING.EUCLIDEAN_GRID_DISTANCE)
        ? GridCoordinates3d.GRID_DIAGONALS.EUCLIDEAN : canvas.grid.diagonals;
    if ( CONFIG[MODULE_ID].pathfindingCheckTerrains ) {

      const res = GridCoordinates3d.gridMeasurementForSegment(fromPoint, toPoint, 0, undefined, diagonals);
      return CONFIG.GeometryLib.utils.gridUnitsToPixels(res.cost);
    }
    const distance = GridCoordinates3d.gridDistanceBetween(fromPoint, toPoint, undefined, diagonals);
    return CONFIG.GeometryLib.utils.gridUnitsToPixels(distance);
  }

  /**
   * Replace an edge in this triangle.
   * Used to link triangles by an edge.
   * @param {string} edgeName     "AB"|"BC"|"CA"
   */
  _setEdge(edgeName, newEdge) {
    const oldEdge = this.edges[edgeName];
    if ( !oldEdge ) {
      console.error(`No edge with name ${edgeName} found.`);
      return;
    }

    if ( !(newEdge instanceof BorderEdge) ) {
      console.error("BorderTriangle requires BorderEdge to replace an edge.");
      return;
    }

    if ( !(oldEdge.endpointKeys.has(newEdge.a.key) && oldEdge.endpointKeys.has(newEdge.b.key)) ) {
      console.error("BorderTriangle edge replacement must have the same endpoints. Try building a new triangle instead.");
      return;
    }

    oldEdge.removeTriangle(this);
    this.edges[edgeName] = newEdge;
    newEdge.linkTriangle(this);
  }

  /**
   * Locate an edge name given edge keys.
   * @param {number} key0
   * @param {number} key1
   * @returns {string|null} Edge name or null if none.
   */
  _edgeNameForKeys(key0, key1) {
    if ( !(this.endpointKeys.has(key0) && this.endpointKeys.has(key1)) ) return undefined;

    const keysAB = this.edges.AB.endpointKeys;
    if ( keysAB.has(key0) && keysAB.has(key1) ) return "AB";

    const keysBC = this.edges.BC.endpointKeys;
    if ( keysBC.has(key0) && keysBC.has(key1) ) return "BC";

    const keysCA = this.edges.CA.endpointKeys;
    if ( keysCA.has(key0) && keysCA.has(key1) ) return "CA";

    return undefined; // Should not be reached.
  }

  /**
   * For debugging.
   * Draw edges, identifying the different types and whether they block.
   */
  drawTriangle(opts = {}) {
    Object.values(this.edges).forEach(edge => {
      const edgeOpts = {...opts}; // Avoid modification of the original each loop.
      const blocks = edge.edgeBlocks(this.center);
      edgeOpts.alpha ??= blocks ? 1 : 0.25;
      edgeOpts.width ??= blocks ? 2 : 1;
      edge.draw(edgeOpts);
    });
  }

  /**
   * For debugging. Draw edges on the canvas.
   */
  drawEdges(opts = {}) { Object.values(this.edges).forEach(e => e.draw(opts)); }

  /*
   * Draw links to other triangles.
   */
  drawLinks(toMedian = false) {
    const center = this.center;
    for ( const edge of Object.values(this.edges) ) {
      const other = edge.otherTriangle(this);
      if ( other ) {
        const B = toMedian ? edge.median : other.center;
        const color = edge.edgeBlocks(center) ? Draw.COLORS.orange : Draw.COLORS.green;
        Draw.segment({ A: center, B }, { color });
      }
    }
  }

  /**
   * Link edges of an array of BorderTriangles.
   * Each linked edge is shared with a second triangle.
   * Assumed that no edge endpoint is in the middle of another edge.
   * @param {BorderTriangle[]} borderTriangles    Triangle to link. Modified in place.
   * @returns {BorderTriangle[]} The same array, for convenience.
   */
  static linkTriangleEdges(borderTriangles) {
    // Map: edge key --> triangles set.
    const pointMap = new Map();
    for ( const borderTriangle of borderTriangles ) {
      const { a, b, c } = borderTriangle.vertices;
      if ( !pointMap.has(a.key) ) pointMap.set(a.key, new Set());
      if ( !pointMap.has(b.key) ) pointMap.set(b.key, new Set());
      if ( !pointMap.has(c.key) ) pointMap.set(c.key, new Set());

      const aSet = pointMap.get(a.key);
      const bSet = pointMap.get(b.key);
      const cSet = pointMap.get(c.key);

      aSet.add(borderTriangle);
      bSet.add(borderTriangle);
      cSet.add(borderTriangle);
    }

    // For each triangle, if the edge is not yet linked, link if it has a shared edge.
    // Use the point map to determine if a triangle has a shared edge.
    for ( const borderTriangle of borderTriangles ) {
      for ( const edge of Object.values(borderTriangle.edges) ) {
        if ( edge.cwTriangle && edge.ccwTriangle ) continue; // Already linked.
        const aSet = pointMap.get(edge.a.key);
        const bSet = pointMap.get(edge.b.key);
        const ixSet = aSet.intersection(bSet);

        // Debug: should always have 2 elements: this borderTriangle and the other.
        if ( ixSet.size > 2 ) {
          console.warn("aSet and bSet intersection is larger than expected.", { pointMap, edge });
        }
        if ( ixSet.size && !ixSet.has(borderTriangle) ) {
          console.warn("ixSet does not have this borderTriangle", { pointMap, edge, borderTriangle });
        }

        if ( ixSet.size !== 2 ) continue; // No bordering triangle.
        const [tri1, tri2] = ixSet;
        const otherTriangle = borderTriangle === tri1 ? tri2 : tri1;

        // Determine where this edge is on the other triangle and replace.
        const otherEdgeName = otherTriangle._edgeNameForKeys(edge.a.key, edge.b.key);
        if ( !otherEdgeName ) continue; // Should not happen.
        otherTriangle._setEdge(otherEdgeName, edge);
      }
    }

    return borderTriangles;
  }
}
