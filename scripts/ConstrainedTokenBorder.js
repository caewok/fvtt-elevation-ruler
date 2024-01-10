/* globals
canvas,
ClockwiseSweepPolygon,
PIXI,
PolygonEdge
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export const PATCHES = {};
PATCHES.ConstrainedTokenBorder = {};

// ----- NOTE: Hooks ----- //

/** Hooks to increment wall ids. */
function canvasInit() { ConstrainedTokenBorder._wallsID++; }

function createWall(wallD) { if ( wallD.rendered ) ConstrainedTokenBorder._wallsID++; }

function updateWall(_wallD) { if ( document.rendered ) ConstrainedTokenBorder._wallsID++; }

function deleteWall(_wallD) { if ( document.rendered ) ConstrainedTokenBorder._wallsID++; }


PATCHES.ConstrainedTokenBorder.HOOKS = {
  canvasInit,
  createWall,
  updateWall,
  deleteWall
};

// Hooks.once("setup", () => {
//   if ( game.settings.get("core", "noCanvas") ) return;
//
//   Hooks.on("canvasInit", () => { ConstrainedTokenBorder._wallsID++; });
//
//   Hooks.on("createWall", document => {
//     if ( document.rendered ) ConstrainedTokenBorder._wallsID++;
//   });
//
//   Hooks.on("updateWall", document => {
//     if ( document.rendered ) ConstrainedTokenBorder._wallsID++;
//   });
//
//   Hooks.on("deleteWall", document => {
//     if ( document.rendered ) ConstrainedTokenBorder._wallsID++;
//   });
// });

/**
 * Generate a polygon of the token bounds with portions intersected by walls stripped out.
 * Use line-of-sight from the center point to determine the resulting token shape.
 * This border represents the physical bounds of the token, so the move restriction is
 * used for walls (which thus don't have limited restriction walls).
 */
export class ConstrainedTokenBorder extends ClockwiseSweepPolygon {
  /**
   * Cache shape by token.
   */
  static _cache = new WeakMap();

  /**
   * Retrieve the constrained token shape for the given wall restriction type.
   * @param {Token} token
   * @param {string} type   Corresponds to wall restriction: sight, sound, light, move
   */
  static get(token) {
    let polygon = this._cache.get(token);
    if ( !polygon ) this._cache.set(token, polygon = new this(token));
    polygon.initialize();
    polygon.compute();
    return polygon;
  }

  /** Indicator of wall changes
   * @type {number}
   */
  static _wallsID = 0;

  /**
   * Properties to test if relevant token characterics have changed.
   * @type {object}
   */
  _tokenDimensions = {
    x: Number.NEGATIVE_INFINITY,
    y: Number.NEGATIVE_INFINITY,
    topZ: Number.POSITIVE_INFINITY,
    bottomZ: Number.NEGATIVE_INFINITY,
    width: -1,
    height: -1 };

  /** @type {Token} */
  _token;

  // TODO: Change this to a boolean "dirty" flag
  /** @type {number} */
  _wallsID = -1;

  /**
   * If true, no walls constrain token.
   * @type {boolean}
   */
  _unrestricted;

  /** @type {boolean} */
  _dirty = true;

  constructor(token) {
    super();
    this._token = token;
  }

  /** @override */
  initialize() {
    const { x, y, topZ, bottomZ } = this._token;
    const { width, height } = this._token.document;

    const tokenMoved = this._tokenDimensions.x !== x
      || this._tokenDimensions.y !== y
      || this._tokenDimensions.topZ !== topZ
      || this._tokenDimensions.bottomZ !== bottomZ
      || this._tokenDimensions.width !== width
      || this._tokenDimensions.height !== height;

    if ( tokenMoved || this._wallsID !== ConstrainedTokenBorder._wallsID ) {
      this._tokenDimensions.x = x;
      this._tokenDimensions.y = y;
      this._tokenDimensions.topZ = topZ;
      this._tokenDimensions.bottomZ = bottomZ;
      this._tokenDimensions.width = width;
      this._tokenDimensions.height = height;
      this._wallsID = ConstrainedTokenBorder._wallsID;
      this._dirty = true;

      const border = this._token.tokenBorder;
      const config = {
        source: this._token.vision,
        type: "move",
        boundaryShapes: [border] };

      const center = this._token.center;
      super.initialize({ x: center.x, y: center.y }, config);
    }
  }

  /** @override */
  getBounds() {
    return this._token.bounds;
  }

  /** @override */
  compute() {
    if ( this._dirty ) {
      this._dirty = false;
      super.compute();
    }
  }

  /** @override */
  _compute() {
    this.points.length = 0;

    if ( this._identifyEdges() ) {
      this._identifyVertices();
      this._executeSweep();
      this._constrainBoundaryShapes();
      this._unrestricted = false;
    } else {
      this._unrestricted = true;
    }

    this.vertices.clear();
    this.edges.clear();
    this.rays.length = 0;
  }

  /** @override */
  _identifyEdges() {
    const walls = this._getWalls();
    const type = this.config.type;
    const bounds = this._token.bounds;
    for ( const wall of walls ) {
      // If only walls on a token bounds, then we can stop and return the unrestricted token shape.
      // Token borders are either square or hex.
      // Too hard to properly reject walls on the hex border, so just use bounds to omit some.
      const dx = wall.B.x - wall.A.x;
      const dy = wall.B.y - wall.A.y;
      if ( !dx && (wall.A.x.almostEqual(bounds.left) || wall.A.x.almostEqual(bounds.right)) ) continue;
      if ( !dy && (wall.A.y.almostEqual(bounds.top) || wall.A.y.almostEqual(bounds.bottom)) ) continue;

      // Otherwise, use this wall in constructing the constrained border
      this.edges.add(PolygonEdge.fromWall(wall, type));
    }

    // If no edges, we return early and ultimately use the token border instead of sweep.
    if ( this.edges.size === 0 ) return false;

    // Add in the canvas boundaries as in the original _identifyEdges.
    for ( const boundary of canvas.walls.outerBounds ) {
      const edge = PolygonEdge.fromWall(boundary, type);
      edge._isBoundary = true;
      this.edges.add(edge);
    }

    return true;
  }

  /** @override */
  _defineBoundingBox() {
    return this._token.bounds.clone().ceil().pad(1);
  }

  /** @override */
  contains(x, y) {
    const inBounds = this._token.bounds.contains(x, y);
    if ( this._unrestricted || !inBounds ) return inBounds;

    return PIXI.Polygon.prototype.contains.call(this, x, y);
  }

  /**
   * Return either this polygon or the underlying token border if possible.
   * @returns {ConstrainedTokenShape|PIXI.Rectangle}
   */
  constrainedBorder() {
    return this._unrestricted ? this._token.tokenBorder : this;
  }
}

