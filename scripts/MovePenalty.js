/* globals
canvas,
CONST,
Drawing,
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/*
Class to measure penalty, as percentage of distance, between two points.
Accounts for token movement through terrain.
Type of penalties:
- Moving through other tokens. (TokenMovePenalty)
- Moving through Terrain Layer terrain (TerrainMovePenalty)
- Moving through Drawings with Terrain Layer terrain (DrawingMovePenalty)
*/

import { MODULES_ACTIVE, MODULE_ID, FLAGS, SPEED } from "./const.js";
import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { CenteredRectangle } from "./geometry/CenteredPolygon/CenteredRectangle.js";
import { CenteredPolygon } from "./geometry/CenteredPolygon/CenteredPolygon.js";
import { Ellipse } from "./geometry/Ellipse.js";
import {
  segmentBounds,
  percentOverlap } from "./util.js";
import {
  getCenterPoint3d,
  canvasElevationFromCoordinates,
  gridShape,
  pointFromGridCoordinates } from "./grid_coordinates.js";

// Cannot do this b/c some circular definition is causing Settings to be undefined.
// const { CENTER, PERCENT, EUCLIDEAN } = Settings.KEYS.GRID_TERRAIN.CHOICES;

// Taken directly from Settings.js
const CENTER = "grid-terrain-choice-center-point";
const PERCENT = "grid-terrain-choice-percent-area";
const EUCLIDEAN = "grid-terrain-choice-euclidean";

export class MovePenalty {
  /** @type {number} */
  static get tokenMultiplier() { return Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER); }

  /** @type {object|undefined} */
  static get terrainAPI() { return false; } // MODULES_ACTIVE.API.TERRAIN_MAPPER; } // Not currently implemented for v12.

  /** @type {Terrain|undefined} */
  static get terrain() { return this.terrainAPI?.Terrain; }

  /**
   * Returns a penalty function for gridded or gridless moves.
   * @param {boolean} [gridless=false]    Should a gridless penalty be used?
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {Token} [token]                 Token doing the move. Required for token moves.
   *   - @returns {number} Percent penalty to apply for the move.
   */
  static movePenaltyFn({ gridless = false } = {}) {
    const cl = this._getChildClass(gridless);
    return cl.movePenaltyFn();
  }

  /**
   * Get the relevant child class depending on whether gridded or gridless is desired.
   * @param {boolean} [gridless]    Should a gridless penalty be used?
   * @returns {class}
   */
  static _getChildClass(gridless) {
    gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
    return gridless ? MovePenaltyGridless : MovePenaltyGridded;
  }


  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {object}
   *   - @prop {Set<Token>} tokens
   *   - @prop {Set<Drawing>} drawings
   *   - @prop {Set<Terrain>} terrains
   */
  static allTerrainPlaceablesAlongSegment(a, b, token, { gridless = false } = {}) {
    const cl = this._getChildClass(gridless);
    return cl.allTerrainPlaceablesAlongSegment(a, b, token);
  }

  /**
   * Test if any qualifying terrain placeables block the segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @returns {boolean} True if any block
   */
  static anyTerrainPlaceablesAlongSegment(a, b, token, { gridless = false } = {}) {
    const cl = this._getChildClass(gridless);
    return cl.anyTerrainPlaceablesAlongSegment(a, b, token);
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Quadtree} quadtree         The quadtree to use for lookup
   * @returns {Set<Drawing>}
   */
  static _allTerrainPlaceablesAlongSegment(a, b, quadtree) {
    return this._placeablesAlongSegment(a, b, quadtree)
      .filter(this._placeableFilterFn(a, b));
  }

  /**
   * Determine if any terrain placeables are along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token to exclude (generally the moving token)
   * @returns {Set<Token>}
   */
  static _anyTerrainPlaceablesAlongSegment(a, b) {
    return this.allTerrainPlaceablesAlongSegment(a, b).size;
  }

  /**
   * For a given point between a and b, locate colliding objects of the given type.
   * Returns all objects that intersect a --> b according to object bounds.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Quadtree} quadtree         Quadtree to use for the search
   * @returns {Set<PlaceableObject>} Objects from the given quadtree, or the null set
   */
  static _placeablesAlongSegment(a, b, quadtree) {
    a = pointFromGridCoordinates(a);
    b = pointFromGridCoordinates(b);
    const abBounds = segmentBounds(a, b);
    const collisionTest = o => this._placeableBounds(o.t).lineSegmentIntersects(a, b, { inside: true });
    return quadtree.getObjects(abBounds, { collisionTest });
  }

  /**
   * Move multiplier for the path a --> b.
   * @param {Point3d} a                     Starting point for the segment
   * @param {Point3d} b                     Ending point for the segment
   * @param {boolean} gridless    Should this be a gridless measurement?
   * @param {...} opts            Additional arguments passed to method
   * @returns {number} Percent penalty
   */
  static moveMultiplier(a, b, { gridless = false, ...opts } = {}) {
    const cl = this._getChildClass(gridless);
    return cl.moveMultiplier(a, b, opts);
  }

  /** Helper to calculate a shape for a given drawing.
   * @param {Drawing} drawing
   * @returns {CenteredPolygon|CenteredRectangle|PIXI.Circle}
   */
  static _shapeForDrawing(drawing) {
    switch ( drawing.type ) {
      case Drawing.SHAPE_TYPES.RECTANGLE: return CenteredRectangle.fromDrawing(drawing);
      case Drawing.SHAPE_TYPES.POLYGON: return CenteredPolygon.fromDrawing(drawing);
      case Drawing.SHAPE_TYPES.ELLIPSE: return Ellipse.fromDrawing(drawing);
      default: return drawing.bounds;
    }
  }

  /**
   * Penalty for a specific drawing.
   * @param {Drawing} drawing       Placeable drawing to test
   * @returns {number}
   */
  static drawingPenalty(drawing) {
    return drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) || 1;
  }

  /**
   * Construct a function that determines if a placeable should qualify as intersecting the segment a, b.
   * Can assume the placeable border does intersect a|b.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {function}
   *   - @param {Token} t
   *   - @returns {boolean}
   */
  static _placeableFilterFn(a, b) {
    const verticalTest = this._placeableVerticalTestFn(a, b);
    const qualifyTest = this._placeableQualificationTestFn(a, b);
    return o => verticalTest(o) && qualifyTest(o);
  }

  /**
   * Construct a function that tests if a given placeable falls within the vertical range
   * of the segment. Assumes the placeable border does intersect a|b.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableVerticalTestFn(a, b) { return o => o.elevationZ.between(a.z, b.z); }

  /**
   * Construct a function that tests if a given placeable qualifies as potentially penalizing
   * movement along the segment. Assumes the placeable border does intersect a|b.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableQualificationTestFn(_a, _b) { return _o => true; }

  /**
   * Get the bounds for placeable of the type to be tested.
   * @param {PlaceableObject} obj
   * @returns {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse}
   */
  static _placeableBounds(obj) {
    if ( obj instanceof Token ) return obj.constrainedTokenBorder;
    if ( obj instanceof Drawing ) return this._shapeForDrawing(obj);
    return obj.bounds(); }
}

// Add in additional method to calculate penalties along ray that intersects shape(s).
MovePenalty.rayShapesIntersectionPenalty = rayShapesIntersectionPenalty;


// ----- NOTE: Gridless ----- //

export class MovePenaltyGridless extends MovePenalty {
  /**
   * Construct a penalty function for gridless moves.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {object} [opts]                   Additional options to affect the measurement
   *   - @param {Token} [opts.token]              Token doing the move
   *   - @param {number} [opts.tokenMultiplier]   Multiplier for tokens
   *   - @returns {number} Percent penalty to apply for the move.
   */
  static movePenaltyFn() {
    const fns = [
      DrawingMovePenaltyGridless.movePenaltyFn(),
      TokenMovePenaltyGridless.movePenaltyFn()
    ];
    if ( this.terrainAPI ) fns.push(TerrainMovePenaltyGridless.movePenaltyFn());
    return multiplicativeCompose(...fns);
  }

  /**
   * Move multiplier for the path a --> b.
   * @param {Point3d} a                     Starting point for the segment
   * @param {Point3d} b                     Ending point for the segment
   * @param {object} opts                   Additional arguments passed to method
   * @returns {number} Percent penalty
   */
  static moveMultiplier(a, b, opts) { return this.movePenaltyFn()(a, b, opts); }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {object}
   *   - @prop {Set<Token>} tokens
   *   - @prop {Set<Drawing>} drawings
   *   - @prop {Set<Terrain>} terrains
   */
  static allTerrainPlaceablesAlongSegment(a, b, token) {
    return {
      tokens: TokenMovePenaltyGridless._allTerrainPlaceablesAlongSegment(a, b, token),
      drawings: DrawingMovePenaltyGridless._allTerrainPlaceablesAlongSegment(a, b),
      terrains: TerrainMovePenaltyGridless._allTerrainPlaceablesAlongSegment(a, b, token)
    };
  }

  /**
   * Test if any qualifying terrain placeables block the segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {boolean} True if any block
   */
  static anyTerrainPlaceablesAlongSegment(a, b, token) {
    return TokenMovePenaltyGridless._anyTerrainPlaceablesAlongSegment(a, b, token)
      || DrawingMovePenaltyGridless._anyTerrainPlaceablesAlongSegment(a, b)
      || TerrainMovePenaltyGridless._anyTerrainPlaceablesAlongSegment(a, b, token);
  }
}

export class TokenMovePenaltyGridless extends MovePenaltyGridless {
  /**
   * Construct a penalty function.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {object} [opts]                      Options affecting the calculation
   *   - @param {Token} [opts.token]                 Token doing the move
   *   - @param {number} [opts.tokenMultiplier]      Penalty multiplier for encountered tokens
   *   - @returns {number} Percent penalty to apply for the move.
   */
  static movePenaltyFn() { return this.moveMultiplier.bind(this); }

  /**
   * Move multiplier accounting for tokens encountered along the path a --> b.
   * Multiplier based on the percentage of the segment that overlaps 1+ tokens.
   * @param {GridCoordinates3d} a                       Starting point for the segment
   * @param {GridCoordinates3d} b                       Ending point for the segment
   * @param {object} [opts]                   Options affecting the calculation
   * @param {Token} [opts.token]              Token to exclude from search (usually the moving token)
   * @param {number} [opts.tokenMultiplier]   Penalty multiplier for encountered tokens
   * @returns {number} Percent penalty
   */
  static moveMultiplier(a, b, { token, tokenMultiplier } = {}) {
    tokenMultiplier ??= this.tokenMultiplier;
    if ( tokenMultiplier === 1 ) return 1;

    a = pointFromGridCoordinates(a);
    b = pointFromGridCoordinates(b);

    // Find tokens along the ray whose constrained borders intersect the ray.
    const tokens = this.allTerrainPlaceablesAlongSegment(a, b, token);
    if ( !tokens.size ) return 1;

    // Determine the percentage of the ray that intersects the constrained token shapes.
    const penaltyFn = () => tokenMultiplier;
    return this.rayShapesIntersectionPenalty(a, b, tokens.map(t => t.constrainedTokenBorder), penaltyFn);
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token to exclude (generally the moving token)
   * @returns {Set<Token>}
   */
  static _allTerrainPlaceablesAlongSegment(a, b, token) {
    const tokens = super._allTerrainPlaceablesAlongSegment(a, b, canvas.tokens.quadtree);
    tokens.delete(token);
    return tokens;
  }
}

export class DrawingMovePenaltyGridless extends MovePenaltyGridless {

  /**
   * Construct a penalty function.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {object} [opts]                   Additional options to affect the measurement
   *   - @param {Token} [opts.token]              Token doing the move
   *   - @param {number} [opts.tokenMultiplier]   Multiplier for tokens
   *   - @returns {number} Percent penalty to apply for the move.
   */
  static movePenaltyFn() { return this.moveMultiplier.bind(this); }

  /**
   * Move multiplier accounting for drawings encountered along the path a --> b.
   * Multiplier based on the percentage of the segment that overlaps 1+ drawings.
   * @param {GridCoordinates3d} a                       Starting point for the segment
   * @param {GridCoordinates3d} b                       Ending point for the segment
   * @returns {number} Percent penalty
   */
  static moveMultiplier(a, b) {
    a = pointFromGridCoordinates(a);
    b = pointFromGridCoordinates(b);

    // Find drawings along the ray whose borders intersect the ray.
    const drawings = this.allTerrainPlaceablesAlongSegment(a, b);
    if ( !drawings.size ) return 1;

    // Determine the percentage of the ray that intersects the constrained token shapes.
    return this.rayShapesIntersectionPenalty(a, b, drawings.map(d => this._shapeForDrawing(d)), this.drawingPenalty);
  }

  /**
   * Construct a function that tests if a given placeable qualifies as potentially penalizing
   * movement along the segment. Assumes the placeable border does intersect a|b.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableQualificationTestFn(_a, _b) { return d => this.drawingPenalty(d) !== 1; }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token to exclude (generally the moving token)
   * @returns {Set<Drawing>}
   */
  static _allTerrainPlaceablesAlongSegment(a, b) {
    return super._allTerrainPlaceablesAlongSegment(a, b, canvas.drawings.quadtree);
  }
}

export class TerrainMovePenaltyGridless extends MovePenaltyGridless {

  /**
   * Construct a penalty function.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {object} [opts]                   Additional options to affect the measurement
   *   - @param {Token} [opts.token]              Token doing the move
   *   - @param {number} [opts.tokenMultiplier]   Multiplier for tokens
   *   - @returns {number} Percent penalty to apply for the move.
   */
  static movePenaltyFn() {
    if ( this.terrainAPI ) return this.moveMultiplier.bind(this);
    return () => 1;
  }

  /**
   * Move multiplier accounting for tokens encountered along the path a --> b.
   * Multiplier based on the percentage of the segment that overlaps 1+ tokens.
   * @param {Point3d} a                       Starting point for the segment
   * @param {Point3d} b                       Ending point for the segment
   * @param {object} [opts]                   Options affecting the calculation
   * @param {Token} [opts.token]              Token whose move will be penalized; required
   * @returns {number} Percent penalty
   */
  static moveMultiplier(a, b, { token }) {
    if ( !this.terrainAPI || !token ) return 1;
    return this.terrainAPI.Terrain.percentMovementForTokenAlongPath(token, a, b) || 1;
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token that encounters the terrain
   * @returns {Set<TerrainMarkers>}
   */
  static _allTerrainPlaceablesAlongSegment(a, b, token) {
    if ( !this.terrainAPI ) return new Set();
    const ttr = new canvas.terrain.TravelTerrainRay(token, { origin: a, destination: b });
    return new Set([
      ...ttr._canvasTerrainMarkers().filter(m => m.terrains.size),
      ...ttr._tilesTerrainMarkers(),
      ...ttr._templatesTerrainMarkers()
    ]);
  }

  /**
   * Determine if any terrain placeables are along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token to exclude (generally the moving token)
   * @returns {Set<Token>}
   */
  static _anyTerrainPlaceablesAlongSegment(a, b, token) {
    if ( !this.terrainAPI ) return false;
    const ttr = new canvas.terrain.TravelTerrainRay(token, { origin: a, destination: b });
    return ttr._canvasTerrainMarkers().filter(m => m.terrains.size).length
      || ttr._tilesTerrainMarkers().length
      || ttr._templatesTerrainMarkers().length;
  }
}

// ----- NOTE: Gridded ----- //

export class MovePenaltyGridded extends MovePenalty {
  /** @type {Settings.KEYS.GRID_TERRAIN.CHOICES} */
  static get griddedAlgorithm() { return Settings.get(Settings.KEYS.GRID_TERRAIN.ALGORITHM); }

  /** @type {number} */
  static get percentAreaThreshold() { return Settings.get(Settings.KEYS.GRID_TERRAIN.AREA_THRESHOLD); }

  /**
   * Returns a penalty function for gridded moves.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {Token} [token]                 Token doing the move. Required for token moves.
   *   - @returns {number} Percent penalty to apply for the move.
   */
  static movePenaltyFn() {
    const fns = [
      DrawingMovePenaltyGridded.movePenaltyFn(),
      TokenMovePenaltyGridded.movePenaltyFn()
    ];
    if ( this.terrainAPI ) fns.push(TerrainMovePenaltyGridded.movePenaltyFn());
    return multiplicativeCompose(...fns);
  }

  /**
   * Move multiplier for the path a --> b.
   * @param {Point3d} a                     Starting point for the segment
   * @param {Point3d} b                     Ending point for the segment
   * @param {object} opts                   Additional arguments passed to method
   * @returns {number} Percent penalty
   */
  static moveMultiplier(a, b, opts) { return this.movePenaltyFn()(a, b, opts); }

  /**
   * Test if the object overlaps with the grid center.
   * @param {PlaceableObject} obj                 Object to test
   * @param {GridCoordinates3d} currGridCoords    The current grid location
   * @returns {boolean}
   */
  static _placeableCenterOverlap(obj, currGridCoords) {
    const currCenter = getCenterPoint3d(currGridCoords);
    return this._placeableBounds(obj).contains(currCenter.x, currCenter.y);
  }

  /**
   * Test if the object has a percentage overlap with the current grid space, by area.
   * @param {PlaceableObject} obj                     Object to test
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {PIXI.Polygon|PIXI.Rectangle} [shape]     Grid shape
   * @param {number} [percentThreshold]               Threshold test
   * @returns {boolean}
   */
  static _placeablePercentAreaOverlap(obj, currGridCoords, shape, percentThreshold) {
    percentThreshold ??= this.percentThreshold;
    shape ??= gridShape(currGridCoords);
    const totalArea = shape.area;
    return percentOverlap(this._placeableBounds(obj), shape, totalArea) >= percentThreshold;
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {object}
   *   - @prop {Set<Token>} tokens
   *   - @prop {Set<Drawing>} drawings
   *   - @prop {Set<Terrain>} terrains
   */
  static allTerrainPlaceablesAlongSegment(a, b, token) {
    return {
      tokens: TokenMovePenaltyGridded.allTerrainPlaceablesAlongSegment(a, b, token),
      drawings: DrawingMovePenaltyGridded.allTerrainPlaceablesAlongSegment(a, b),
      terrains: TerrainMovePenaltyGridded.allTerrainPlaceablesAlongSegment(a, b, token)
    };
  }

  /**
   * Test if any qualifying terrain placeables block the segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {boolean} True if any block
   */
  static anyTerrainPlaceablesAlongSegment(a, b, token) {
    return TokenMovePenaltyGridded._anyTerrainPlaceablesAlongSegment(a, b, token)
      || DrawingMovePenaltyGridded._anyTerrainPlaceablesAlongSegment(a, b)
      || TerrainMovePenaltyGridded._anyTerrainPlaceablesAlongSegment(a, b, token);
  }
}

export class TokenMovePenaltyGridded extends MovePenaltyGridded {
  /** @type {Map<String, class>} */
  static #penaltySubclasses = new Map();

  /**
   * Track subclasses used for different grid penalty measurements.
   */
  static _registerPenaltySubclass(type, theClass) { this.#penaltySubclasses.set(type, theClass); }

  /** @type {class} */
  static get #penaltySubclass() { return this.#penaltySubclasses.get(this.griddedAlgorithm); }

  /**
   * Returns a penalty function for gridded moves.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {Token} [token]                 Token doing the move. Required for token moves.
   *   - @param {number} [tokenMultiplier]      Penalty multiplier for encountered tokens
   *   - @returns {number} Percent penalty to apply for the move.
   */

  static movePenaltyFn() { return this.#penaltySubclass.moveMultiplier.bind(this.#penaltySubclass); }

  /**
   * Move multiplier accounting for tokens on the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, opts) {
    return this.#penaltySubclasses.moveMultiplier(currGridCoords, prevGridCoords, opts);
  }

  /**
   * Move multiplier accounting for tokens that overlap some portion of the grid
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @param {Token} [opts.token]                      Token to exclude from search (the moving token)
   * @param {number} [opts.tokenMultiplier]           Penalty multiplier for encountered tokens
   * @returns {number} Percent penalty
   */
  static _moveMultiplier(currGridCoords, prevGridCoords, { token, tokenMultiplier } = {}) {
    tokenMultiplier ??= this.tokenMultiplier;
    if ( tokenMultiplier === 1 ) return 1;

    currGridCoords = pointFromGridCoordinates(currGridCoords);
    prevGridCoords = pointFromGridCoordinates(prevGridCoords);

    // Find tokens along the ray whose constrained borders intersect the ray.
    // currGridCoords will be used to test whether token overlaps.
    const tokens = this._placeablesAlongSegment(currGridCoords, prevGridCoords, canvas.tokens.quadtree);
    tokens.delete(token);
    if ( !tokens.size ) return 1;

    // If any token qualifies, assess the penalty.
    const filterFn = this._placeableFilterFn(currGridCoords, prevGridCoords);
    if ( tokens.some(filterFn) ) return tokenMultiplier;
    return 1;
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token to exclude (generally the moving token)
   * @returns {Set<Token>}
   */
  static _allTerrainPlaceablesAlongSegment(a, b, token) {
    const tokens = super._allTerrainPlaceablesAlongSegment(a, b, canvas.tokens.quadtree);
    tokens.delete(token);
    return tokens;
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {Set<Token>}
   */
  static allTerrainPlaceablesAlongSegment(a, b, token) {
    return this.#penaltySubclass._allTerrainPlaceablesAlongSegment(a, b, token);
  }

  /**
   * Test if any qualifying terrain placeables block the segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {boolean} True if any block
   */
  static anyTerrainPlaceablesAlongSegment(a, b, token) {
    return this.#penaltySubclass._anyTerrainPlaceablesAlongSegment(a, b, token);
  }
}

export class TokenMovePenaltyCenterGrid extends TokenMovePenaltyGridded {
  /**
   * Move multiplier accounting for tokens that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @param {Token} [opts.token]                      Token to exclude from search (the moving token)
   * @param {number} [opts.tokenMultiplier]           Penalty multiplier for encountered tokens
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, opts) {
    return this._moveMultiplier(currGridCoords, prevGridCoords, opts);
  }

  /**
   * Construct a function that tests if the token border overlaps the grid center point.
   * @param {Point3d} a     The grid center point to test
   * @param {Point3d} b     Unused (represents previous grid center point).
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableQualificationTestFn(a, _b) { return t => this._placeableCenterOverlap(t, a); }
}

export class TokenMovePenaltyPercentGrid extends TokenMovePenaltyGridded {
  /**
   * Move multiplier accounting for tokens that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @param {Token} [opts.token]                      Token to exclude from search (the moving token)
   * @param {number} [opts.tokenMultiplier]           Penalty multiplier for encountered tokens
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, opts) {
    return this._moveMultiplier(currGridCoords, prevGridCoords, opts);
  }

  /**
   * Construct a function that tests if the token border overlaps the grid shape.
   * @param {Point3d} a     The grid center point to test
   * @param {Point3d} b     Unused (represents previous grid center point).
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableQualificationTestFn(a, _b) {
    const percentThreshold = this.percentThreshold; // Precalculate for speed.
    const shape = gridShape(a); // Precalculate for speed.
    return t => this._placeablePercentAreaOverlap(t, a, shape, percentThreshold);
  }
}

export class TokenMovePenaltyEuclideanGrid extends TokenMovePenaltyGridded {
  /**
   * Move multiplier accounting for tokens splitting the euclidean distance between the two locations.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @param {Token} [opts.token]                      Token to exclude from search (the moving token)
   * @param {number} [opts.tokenMultiplier]           Penalty multiplier for encountered tokens
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, { token, tokenMultiplier } = {}) {
    tokenMultiplier ??= this.tokenMultiplier;
    if ( tokenMultiplier === 1 ) return 1;
    const currCenter = getCenterPoint3d(prevGridCoords);
    const prevCenter = getCenterPoint3d(currGridCoords);
    return TokenMovePenaltyGridless.moveMultiplier(prevCenter, currCenter, token, tokenMultiplier);
  }
}

export class DrawingMovePenaltyGridded extends MovePenaltyGridded {
  /** @type {Map<String, class>} */
  static #penaltySubclasses = new Map();

  /**
   * Track subclasses used for different grid penalty measurements.
   */
  static _registerPenaltySubclass(type, theClass) { this.#penaltySubclasses.set(type, theClass); }

  /** @type {class} */
  static get #penaltySubclass() { return this.#penaltySubclasses.get(this.griddedAlgorithm); }

  /**
   * Returns a penalty function for gridded moves.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {Token} [token]                 Token doing the move. Required for token moves.
   *   - @returns {number} Percent penalty to apply for the move.
   */
  static movePenaltyFn() { return this.#penaltySubclass.moveMultiplier.bind(this.#penaltySubclass); }

  /**
   * Move multiplier accounting for drawings on the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords) {
    return this.#penaltySubclass.moveMultiplier(currGridCoords, prevGridCoords);
  }

  /**
   * Move multiplier accounting for tokens that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @returns {number} Percent penalty
   */
  static _moveMultiplier(currGridCoords, prevGridCoords) {
    currGridCoords = pointFromGridCoordinates(currGridCoords);
    prevGridCoords = pointFromGridCoordinates(prevGridCoords);

    const drawings = this._placeablesAlongSegment(currGridCoords, prevGridCoords, canvas.drawings.quadtree)
      .filter(this._placeableFilterFn(currGridCoords, prevGridCoords));
    return this._calculateDrawingsMovePenalty(drawings);
  }

  /**
   * Helper to calculate the percentage penalty for a set of drawings.
   * @param {Set<Drawing>} drawings
   * @returns {number}
   */
  static _calculateDrawingsMovePenalty(drawings) {
    return drawings.reduce((acc, curr) => {
      const penalty = this.drawingPenalty(curr);
      return acc * penalty;
    }, 1);
  }

  /**
   * Construct a function that tests if a given placeable qualifies as potentially penalizing
   * movement along the segment. Assumes the placeable border does intersect a|b.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableQualificationTestFn(_a, _b) { return d => this.drawingPenalty(d) !== 1; }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token to exclude (generally the moving token)
   * @returns {Set<Drawing>}
   */
  static _allTerrainPlaceablesAlongSegment(a, b) {
    return super._allTerrainPlaceablesAlongSegment(a, b, canvas.drawings.quadtree);
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @returns {Set<Drawing>}
   */
  static allTerrainPlaceablesAlongSegment(a, b) {
    return this.#penaltySubclass._allTerrainPlaceablesAlongSegment(a, b);
  }

  /**
   * Test if any qualifying terrain placeables block the segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @returns {boolean} True if any block
   */
  static anyTerrainPlaceablesAlongSegment(a, b) {
    return this.#penaltySubclass._anyTerrainPlaceablesAlongSegment(a, b);
  }
}

export class DrawingMovePenaltyCenterGrid extends DrawingMovePenaltyGridded {

  /**
   * Move multiplier accounting for tokens that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, opts) {
    return this._moveMultiplier(currGridCoords, prevGridCoords, opts);
  }

  /**
   * Construct a function that tests if the drawing border overlaps the grid center.
   * @param {Point3d} a     The grid center point to test
   * @param {Point3d} b     Unused (represents previous grid center point).
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableQualificationTestFn(a, b) {
    const parentTest = super._placeableQualificationTestFn(a, b);
    return d => parentTest(d) && this._placeableCenterOverlap(d, a);
  }
}

export class DrawingMovePenaltyPercentGrid extends DrawingMovePenaltyGridded {
  /**
   * Move multiplier accounting for tokens that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, opts) {
    return this._moveMultiplier(currGridCoords, prevGridCoords, opts);
  }

  /**
   * Construct a function that tests if the token border overlaps the grid shape.
   * @param {Point3d} a     The grid center point to test
   * @param {Point3d} b     Unused (represents previous grid center point).
   * @returns {function}
   *   - @param {PlaceableObject} o
   *   - @returns {boolean}
   */
  static _placeableQualificationTestFn(a, b) {
    const percentThreshold = this.percentThreshold; // Precalculate for speed.
    const shape = gridShape(a); // Precalculate for speed.
    const parentTest = super._placeableQualificationTestFn(a, b);
    return d => parentTest(d) && this._placeablePercentAreaOverlap(d, a, shape, percentThreshold);
  }
}

export class DrawingMovePenaltyEuclideanGrid extends DrawingMovePenaltyGridded {
  /**
   * Move multiplier accounting for tokens that overlap a percentage of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords) {
    const currCenter = getCenterPoint3d(prevGridCoords);
    const prevCenter = getCenterPoint3d(currGridCoords);
    return DrawingMovePenaltyGridless.moveMultiplier(prevCenter, currCenter);
  }
}

export class TerrainMovePenaltyGridded extends MovePenaltyGridded {
  /** @type {Map<String, class>} */
  static #penaltySubclasses = new Map();

  /**
   * Track subclasses used for different grid penalty measurements.
   */
  static _registerPenaltySubclass(type, theClass) { this.#penaltySubclasses.set(type, theClass); }

  /** @type {class} */
  static get #penaltySubclass() { return this.#penaltySubclasses.get(this.griddedAlgorithm); }

  /**
   * Determine the speed attribute for a given token.
   * @param {Token} token
   * @returns {SPEED.ATTRIBUTES}
   */
  static getSpeedAttribute(token) { return SPEED.ATTRIBUTES[token.movementType] ?? SPEED.ATTRIBUTES.WALK; }

  /**
   * Returns a penalty function for gridded moves.
   * @returns {function}
   *   - @param {GridCoordinates3d} a
   *   - @param {GridCoordinates3d} b
   *   - @param {object} [opts]                      Options affecting the calculation
   *   - @returns {number} Percent penalty to apply for the move.
   */

  static movePenaltyFn() { return this.#penaltySubclass.moveMultiplier.bind(this.#penaltySubclass); }

  /**
   * Move multiplier accounting for tokens on the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, opts) {
    return this.#penaltySubclass.moveMultiplier(currGridCoords, prevGridCoords, opts);
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token that encounters the terrain
   * @returns {Set<TerrainMarkers>}
   */
  static _allTerrainPlaceablesAlongSegment(a, b, token) {
    if ( !this.terrainAPI ) return new Set();
    const ttr = new canvas.terrain.TravelTerrainRay(token, { origin: a, destination: b });
    return new Set([
      ...ttr._canvasTerrainMarkers().filter(m => m.terrains.size),
      ...ttr._tilesTerrainMarkers(),
      ...ttr._templatesTerrainMarkers()
    ]);
  }

  /**
   * Determine if any terrain placeables are along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} token               Token to exclude (generally the moving token)
   * @returns {Set<Token>}
   */
  static _anyTerrainPlaceablesAlongSegment(a, b, token) {
    if ( !this.terrainAPI ) return false;
    const ttr = new canvas.terrain.TravelTerrainRay(token, { origin: a, destination: b });
    return ttr._canvasTerrainMarkers().filter(m => m.terrains.size).length
      || ttr._tilesTerrainMarkers().length
      || ttr._templatesTerrainMarkers().length;
  }

  /**
   * Find all terrain placeables along segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {Set<Token>}
   */
  static allTerrainPlaceablesAlongSegment(a, b, token) {
    return this.#penaltySubclass._allTerrainPlaceablesAlongSegment(a, b, token);
  }

  /**
   * Test if any qualifying terrain placeables block the segment a|b.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {Token} [token]             Movement token
   * @returns {boolean} True if any block
   */
  static anyTerrainPlaceablesAlongSegment(a, b, token) {
    return this.#penaltySubclass._anyTerrainPlaceablesAlongSegment(a, b, token);
  }
}

export class TerrainMovePenaltyCenterGrid extends TerrainMovePenaltyGridded {
  /**
   * Move multiplier accounting for terrains that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @param {Token} [opts.token]                      Token affected by the terrain
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, { token } = {}) {
    if ( !token ) return 1;
    const currCenter = getCenterPoint3d(currGridCoords);
    return this.terrain.percentMovementChangeForTokenAtPoint(token, currCenter, this.getSpeedAttribute(token));
  }
}

export class TerrainMovePenaltyPercentGrid extends TerrainMovePenaltyGridded {
  /**
   * Move multiplier accounting for terrains that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @param {Token} [opts.token]                      Token affected by the terrain
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, { token } = {}) {
    if ( !token ) return 1;
    const currElev = canvasElevationFromCoordinates(currGridCoords);
    const shape = gridShape(currGridCoords);
    return this.terrain.percentMovementChangeForTokenWithinShape(
      token,
      shape,
      this.percentThreshold,
      this.getSpeedAttribute(token),
      currElev);
  }
}

export class TerrainMovePenaltyEuclideanGrid extends TerrainMovePenaltyGridded {
  /**
   * Move multiplier accounting for terrains that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {object} [opts]                           Options affecting the calculation
   * @param {Token} [opts.token]                      Token affected by the terrain
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords, { token } = {}) {
    if ( !token ) return 1;
    const currCenter = getCenterPoint3d(currGridCoords);
    return this.terrain.percentMovementChangeForTokenAtPoint(token, currCenter, this.getSpeedAttribute(token));
  }
}


/**
 * Compose multiple functions, multiplying the result of each. Default return is 1.
 * @param {function} ...      Functions to apply in turn, from left to right
 * @returns {number} Multiplied value, where 1 is the default for an empty function list.
 * Example:
 * fn = multiplicativeCompose(x => x + 2, x => x * 3)
 * fn(5) ==> (5 + 2) * (5 * 3) = 7 * 15 = 105
 */
const multiplicativeCompose = (...functions) => {
  return (...args) => {
    return functions.reduce((acc, fn) => acc * fn(...args), 1);
  };
};

/**
 * Determine the percentage of the ray that intersects a set of shapes.
 * @param {Point3d} a                    Origin point of ray
 * @param {Point3d} b                    Destination point of ray
 * @param {Set<PIXI.Polygon
           |PIXI.Rectangle
           |PIXI.Circle>} shapes            Any shape that has a contains(x,y) method
 * @param {function} shapePenaltyFn         Function that takes a shape and returns a penalty value
 * @returns {number}
 */
function rayShapesIntersectionPenalty(a, b, shapes, shapePenaltyFn) {
  if ( !shapes.size ) return 1;

  const tValues = [];
  const deltaMag = b.to2d().subtract(a).magnitude();

  // Determine the portion of the a|b segment that intersects the shapes, marking at percent from a towards b.
  for ( const shape of shapes ) {
    const penalty = shapePenaltyFn(shape) ?? 1;
    let inside = false;
    if ( shape.contains(a.x, a.y) ) {
      inside = true;
      tValues.push({ t: 0, inside, penalty });
    }

    // At each intersection, we switch between inside and outside.
    const ixs = shape.segmentIntersections(a, b);

    // See Foundry issue #10336. Don't trust the t0 values.
    ixs.forEach(ix => {
      // See PIXI.Point.prototype.towardsPoint
      const distance = Point3d.distanceBetween(a, ix);
      ix.t0 = distance / deltaMag;
    });
    ixs.sort((a, b) => a.t0 - b.t0);

    ixs.forEach(ix => {
      inside ^= true;
      tValues.push({ t: ix.t0, inside, penalty });
    });
  }

  // Sort tValues and calculate distance between inside start/end.
  // May be multiple inside/outside entries.
  tValues.sort((a, b) => a.t0 - b.t0);
  let nInside = 0;
  let prevT = 0;
  let distInside = 0;
  let distOutside = 0;
  let penaltyDistInside = 0;
  let currPenalty = 1;
  for ( const tValue of tValues ) {
    if ( tValue.inside ) {
      nInside += 1;
      if ( !tValue.t ) {
        currPenalty *= tValue.penalty;
        continue; // Skip because t is 0 so no distance moved yet.
      }

      // Calculate distance for this segment
      const startPt = a.projectToward(b, prevT ?? 0);
      const endPt = a.projectToward(b, tValue.t);
      const dist = Point3d.distanceBetween(startPt, endPt);
      if ( nInside === 1 ) distOutside += dist;
      else {
        distInside += dist;
        penaltyDistInside += (dist * currPenalty); // Penalty before this point.
      }

      // Cycle to next.
      currPenalty *= tValue.penalty;
      prevT = tValue.t;

    } else if ( nInside > 2 ) {  // !tValue.inside
      nInside -= 1;

      // Calculate distance for this segment
      const startPt = a.projectToward(b, prevT ?? 0);
      const endPt = a.projectToward(b, tValue.t);
      const dist = Point3d.distanceBetween(startPt, endPt);
      distInside += dist;
      penaltyDistInside += (dist * currPenalty); // Penalty before this point.

      // Cycle to next.
      currPenalty *= (1 / tValue.penalty);
      prevT = tValue.t;
    }
    else if ( nInside === 1 ) { // Inside is false and we are now outside.
      nInside = 0;

      // Calculate distance for this segment
      const startPt = a.projectToward(b, prevT);
      const endPt = a.projectToward(b, tValue.t);
      const dist = Point3d.distanceBetween(startPt, endPt);
      distInside += dist;
      penaltyDistInside += (dist * currPenalty); // Penalty before this point.


      // Cycle to next.
      currPenalty *= (1 / tValue.penalty);
      prevT = tValue.t;
    }
  }

  // If still inside, we can go all the way to t = 1
  const startPt = a.projectToward(b, prevT);
  const dist = Point3d.distanceBetween(startPt, b);
  if ( nInside > 0 ) {
    distInside += dist;
    penaltyDistInside += (dist * currPenalty); // Penalty before this point.
  } else distOutside += dist;


  if ( !distInside ) return 1;

  const totalDistance = Point3d.distanceBetween(a, b);
  return (distOutside + penaltyDistInside) / totalDistance;
}

// NOTE: Register subclasses used for different grid penalty measurements.
TokenMovePenaltyGridded._registerPenaltySubclass(CENTER, TokenMovePenaltyCenterGrid);
TokenMovePenaltyGridded._registerPenaltySubclass(PERCENT, TokenMovePenaltyPercentGrid);
TokenMovePenaltyGridded._registerPenaltySubclass(EUCLIDEAN, TokenMovePenaltyEuclideanGrid);

DrawingMovePenaltyGridded._registerPenaltySubclass(CENTER, DrawingMovePenaltyCenterGrid);
DrawingMovePenaltyGridded._registerPenaltySubclass(PERCENT, DrawingMovePenaltyPercentGrid);
DrawingMovePenaltyGridded._registerPenaltySubclass(EUCLIDEAN, DrawingMovePenaltyEuclideanGrid);

TerrainMovePenaltyGridded._registerPenaltySubclass(CENTER, TerrainMovePenaltyCenterGrid);
TerrainMovePenaltyGridded._registerPenaltySubclass(PERCENT, TerrainMovePenaltyPercentGrid);
TerrainMovePenaltyGridded._registerPenaltySubclass(EUCLIDEAN, TerrainMovePenaltyEuclideanGrid);

