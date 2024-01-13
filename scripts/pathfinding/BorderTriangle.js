/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Draw } from "./geometry/Draw.js";

/**
 * An edge that makes up the triangle-shaped polygon
 */
export class BorderEdge {
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

  /** @type {Wall} */
  wall;

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

    // No destination if edge is smaller than 2x spacer.
    if ( length < (spacer * 2) || this.wallBlocks(origin) ) return destinations;
    destinations.push(this.median);

    // Skip corners if not at least spacer away from median.
    if ( length < (spacer * 4) ) return destinations;

    const { a, b } = this;
    const t = spacer / length;
    destinations.push(
      a.projectToward(b, t),
      b.projectToward(a, t));
    return destinations;
  }


  /**
   * Does this edge wall block from an origin somewhere else in the triangle?
   * Tested "live" and not cached so door or wall orientation changes need not be tracked.
   * @param {Point} origin    Measure wall blocking from perspective of this origin point.
   * @returns {boolean}
   */
  wallBlocks(origin) {
    const wall = this.wall;
    if ( !wall ) return false;
    if ( !wall.document.move || wall.isOpen ) return false;

    // Ignore one-directional walls which are facing away from the center
    const side = wall.orientPoint(origin);
    const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
    if ( wall.document.dir
      && (wallDirectionMode === wdm.NORMAL) === (side === wall.document.dir) ) return false;
    return true;
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
    opts.color ??= this.wall ? Draw.COLORS.red : Draw.COLORS.blue;
    Draw.segment({ A: this.a, B: this.b }, opts);
  }
}

/**
 * A triangle-shaped polygon.
 * Assumed static---points cannot change.
 * Note: delaunay triangles from Delaunator are oriented counterclockwise
 */
export class BorderTriangle {
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
      [a, b, c] = [c, b, a];
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
   * Blocked walls are invalid.
   * Typically returns 2 corner destinations plus the median destination.
   * @param {Point} entryPoint
   * @param {BorderTriangle|null} priorTriangle
   * @param {number} spacer           How much away from the corner to set the corner destinations.
   *   If the edge is less than 2 * spacer, it will be deemed invalid.
   *   Corner destinations are skipped if not more than spacer away from median.
   * @returns {object[]} Each element has properties describing the destination:
   *   - {BorderTriangle} triangle
   *   - {Point} entryPoint
   *   - {number} distance
   */
  getValidDestinations(entryPoint, priorTriangle, spacer) {
    spacer ??= canvas.grid.size * 0.5;
    const destinations = [];
    const center = this.center;
    for ( const edge of Object.values(this.edges) ) {
      const neighbor = edge.otherTriangle(this);
      if ( priorTriangle && priorTriangle === neighbor ) continue;
      const pts = edge.getValidDestinations(center, spacer);
      pts.forEach(pt => {
        destinations.push({
          entryPoint: pt,
          triangle: neighbor,

          // TODO: Handle 3d distances.
          // Probably use canvas.grid.measureDistances, passing a Ray3d.
          // TODO: Handle terrain distance
          distance: canvas.grid.measureDistance(center, pt),
        });
      })
    }
    return destinations;
  }

  /**
   * Replace an edge in this triangle.
   * Used to link triangles by an edge.
   * @param {string} edgeName     "AB"|"BC"|"CA"
   */
  setEdge(edgeName, newEdge) {
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
   * For debugging. Draw edges on the canvas.
   */
  drawEdges() { Object.values(this.edges).forEach(e => e.draw()); }

  /*
   * Draw links to other triangles.
   */
  drawLinks() {
    const center = this.center;
    for ( const edge of Object.values(this.edges) ) {
      if ( edge.otherTriangle(this) ) {
        const color = edge.wallBlocks(center) ? Draw.COLORS.orange : Draw.COLORS.green;
        Draw.segment({ A: center, B: edge.median }, { color });

      }
    }
  }
}