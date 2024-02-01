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

import { Draw } from "../geometry/Draw.js";


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
   * @param {Point} center              Test if wall blocks from perspective of this origin point.
   * @param {number} [spacer]           How much away from the corner to set the corner destinations.
   *   If the edge is less than 2 * spacer, it will be deemed invalid.
   *   Corner destinations are skipped if not more than spacer away from median.
   * @returns {PIXI.Point[]}
   */
  getValidDestinations(origin, spacer) {
    spacer ??= canvas.grid.size * 0.5;
    const length = this.length;
    const destinations = [];

    // No destination if edge is smaller than 2x spacer unless it is a door.
    // Cheat a little on the spacing so tokens exactly the right size will fit.
    if ( this.edgeBlocks(origin)
      || (!this.isOpenDoor && (length < (spacer * 1.9))) ) return destinations;
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
   * @returns {boolean}
   */
  isOpenDoor() {
    return this.objects.every(obj =>
      (obj instanceof Wall) ? obj.isOpen
        : (obj instanceof Token ) ? !this._tokenEdgeBlocks(obj)
          : true);
  }

  /**
   * Compilation of tests based on edge type for whether this wall blocks.
   * @param {Point} origin    Measure wall blocking from perspective of this origin point.
   * @returns {boolean}
   */
  edgeBlocks(origin) {
    return this.objects.some(obj =>
      (obj instanceof Wall) ? this._wallBlocks(obj, origin)
        : (obj instanceof Token) ? this._tokenEdgeBlocks(obj)
          : false);
  }

  /**
   * Does this edge wall block from an origin somewhere else in the triangle?
   * Tested "live" and not cached so door or wall orientation changes need not be tracked.
   * @param {Point} origin    Measure wall blocking from perspective of this origin point.
   * @returns {boolean}
   */
  _wallBlocks(wall, origin) {
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

    return true;
  }

  /**
   * Does this token edge block from an origin somewhere else in the triangle?
   * @param {Point} origin    Measure edge blocking from perspective of this origin point.
   * @returns {boolean}
   */
  _tokenEdgeBlocks(token) {
    const moveToken = this.constructor.moveToken;
    if ( !moveToken || moveToken === token ) return false;

    const D = CONST.TOKEN_DISPOSITIONS;
    const moveTokenD = moveToken.document.disposition;
    const edgeTokenD = token.document.disposition;
    switch ( this.constructor.tokenBlockType ) {
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
    const orient2d = foundry.utils.orient2dFast;
    if ( orient2d(a, b, otherEndpoint) > 0 ) this.ccwTriangle = triangle;
    else this.cwTriangle = triangle;
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
   * @param {number} spacer                           How far from the corner to set the corner destinations
   * @returns {PathNode} Each element has properties describing the destination, conforming to pathfinding
   *   - {number} key
   *   - {PIXI.Point} entryPoint
   *   - {BorderTriangle} entryTriangle
   *   - {BorderTriangle} priorTriangle
   */
  getValidDestinations(priorTriangle, spacer) {
    spacer ??= canvas.grid.size * 0.5;
    const destinations = [];
    const center = this.center;
    for ( const edge of Object.values(this.edges) ) {
      const entryTriangle = edge.otherTriangle(this); // Neighbor
      if ( !entryTriangle || (priorTriangle && priorTriangle === entryTriangle) ) continue;
      const pts = edge.getValidDestinations(center, spacer);
      pts.forEach(entryPoint => {
        destinations.push({
          entryPoint,
          key: entryPoint.key, // Key needs to be unique for each point,
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
   * @param {number} spacer                         How far from the corner to set the corner destinations
   * @param {Point} fromPoint                       Point to measure from, for cost
   */
  getValidDestinationsWithCost(priorTriangle, spacer, fromPoint) {
    const destinations = this.getValidDestinations(priorTriangle, spacer);
    destinations.forEach(d => {
      d.cost = this._calculateMovementCost(fromPoint, d.entryPoint);
      d.fromPoint = fromPoint;
    });
    return destinations;
  }

  /**
   * Calculate the cost for a single path node from a given point.
   * @param {PathNode} node
   * @param {Point} fromPoint
   * @returns {number} Cost value
   */
  _calculateMovementCost(fromPoint, toPoint) {
    // TODO: Handle 3d distance. Probably Ray3d with measureDistance or measureDistances.
    // TODO: Handle terrain distance.
    return CONFIG.GeometryLib.utils.gridUnitsToPixels(canvas.grid.measureDistance(fromPoint, toPoint));
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
      const blocks = edge.edgeBlocks(this.center)
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
          console.warn("aSet and bSet intersection is larger than expected.", pointMap, edge);
        }
        if ( ixSet.size && !ixSet.has(borderTriangle) ) {
          console.warn("ixSet does not have this borderTriangle", pointMap, edge, borderTriangle);
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
