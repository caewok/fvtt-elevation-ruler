/* globals
canvas,
CONFIG,
CONST,
Drawing,
foundry
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
  static get terrainAPI() { return MODULES_ACTIVE.API.TERRAIN_MAPPER; }

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
    return this.#applyChildClass("movePenaltyFn", gridless);
  }

  /**
   * Helper method to choose between gridless and gridded subclasses.
   * @param {string} method       Method to use
   * @param {boolean} gridless    Should this be a gridless measurement?
   * @param {...} args            Additional arguments passed to method
   * @returns {*} Result of the applied method.
   */
  static #applyChildClass(method, gridless = false, ...args) {
    gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
    const cl = gridless ? MovePenaltyGridless : MovePenaltyGridded;
    return cl[method](...args);
  }

  /**
   * For a given point between a and b, locate colliding objects of the given type.
   * @param {GridCoordinates3d} a       Starting point
   * @param {GridCoordinates3d} b       Ending point
   * @param {function} collisionTest    Test used in quadtree to eliminate false positives
   * @param {Quadtree} quadtree         Quadtree to use for the search
   * @returns {Set<PlaceableObject>} Objects from the given quadtree, or the null set
   */
  static _placeablesAlongSegment(a, b, collisionTest, quadtree) {
    const bounds = segmentBounds(a, b);
    return quadtree.getObjects(bounds, { collisionTest });
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
    return this.#applyChildClass("moveMultiplier", gridless, a, b, opts);
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

    // Find tokens along the ray whose constrained borders intersect the ray.
    const collisionTest = o => o.t.constrainedTokenBorder.lineSegmentIntersects(a, b, { inside: true });
    const tokens = this._placeablesAlongSegment(a, b, collisionTest, canvas.tokens.quadtree);
    tokens.delete(token);
    if ( !tokens.size ) return 1;

    // Determine the percentage of the ray that intersects the constrained token shapes.
    const penaltyFn = () => tokenMultiplier;
    return this.rayShapesIntersectionPenalty(a, b, tokens.map(t => t.constrainedTokenBorder), penaltyFn);
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
   * @param {Point3d} a                       Starting point for the segment
   * @param {Point3d} b                       Ending point for the segment
   * @returns {number} Percent penalty
   */
  static moveMultiplier(a, b) {
    // Find drawings along the ray whose borders intersect the ray.
    const collisionTest = o => o.t.bounds.lineSegmentIntersects(a, b, { inside: true });
    const drawings = this._placeablesAlongSegment(a, b, collisionTest, canvas.drawings.quadtree)
      .filter(d => this._hasActiveDrawingTerrain(d, b.z ?? 0, a.z ?? 0));
    if ( !drawings.size ) return 1;

    // Determine the percentage of the ray that intersects the constrained token shapes.
    const penaltyFn = d => d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) || 1;
    return this.rayShapesIntersectionPenalty(a, b, drawings.map(d => this._shapeForDrawing(d)), penaltyFn);

  }

  /**
   * Helper to test if a drawing has a terrain that is active for this elevation.
   * @param {Drawing} drawing       Placeable drawing to test
   * @param {number} currElev       Elevation to test
   * @param {number} [prevElev]     If defined, drawing must be between prevElev and currElev.
   *   If not defined, drawing must be at currElev
   * @returns {boolean}
   */
  static _hasActiveDrawingTerrain(drawing, currElev, prevElev) {
    if ( !drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) ) return false;
    const drawingE = foundry.utils.getProperty(drawing.document, "flags.elevatedvision.elevation");
    if ( typeof drawingE === "undefined" ) return true;

    const drawingZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(drawingE);
    if ( typeof prevElev === "undefined" ) return currElev.almostEqual(drawingZ);
    return drawingZ.between(prevElev, currElev);
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
  static moveMultiplier(a, b, ...opts) { return this.movePenaltyFn()(a, b, opts); }


  /**
   * Retrieve objects that have an overlap with the grid center.
   * @param {GridCoordinates3d} currGridCoords    The current grid location
   * @param {GridCoordinates3d} prevGridCoords    The previous step along the grid
   * @param {Quadtree} quadtree                   Quadtree for the placeable type
   * @param {function} objectBoundsFn             Function that describes bounds for the placeable
   *   - @param {PlaceableObject} object
   *   - @returns {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle} Shape of the object's bounds
   * @param {function} filterFn                   Function that eliminates objects not within elevation
   *   - @param {PlaceableObject} object
   *   - @param {number} currZ              Current elevation
   *   - @param {number} prevZ              Elevation at previous step
   *   - @returns {boolean} True if object should be kept
   * @returns {Set<PlaceableObject>}
   */
  static _getMoveObjectsCenterGrid(currGridCoords, prevGridCoords, quadtree, objectBoundsFn, filterFn) {
    const shape = gridShape(currGridCoords);
    const bounds = shape.getBounds();
    const currCenter = getCenterPoint3d(currGridCoords);
    const prevZ = canvasElevationFromCoordinates(prevGridCoords);
    const collisionTest = o => this._shapeForDrawing(o.t).contains(currCenter.x, currCenter.y)
      && filterFn(o.t, currCenter.z, prevZ);
    return quadtree.getObjects(bounds, { collisionTest });
  }

  /**
   * Retrieve objects that have a percent overlap with the grid bounds.
   * @param {GridCoordinates3d} currGridCoords    The current grid location
   * @param {GridCoordinates3d} prevGridCoords    The previous step along the grid
   * @param {Quadtree} quadtree                   Quadtree for the placeable type
   * @param {function} objectBoundsFn             Function that describes bounds for the placeable
   *   - @param {PlaceableObject} object
   *   - @returns {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle} Shape of the object's bounds
   * @param {function} filterFn                   Function that eliminates objects not within elevation
   *   - @param {PlaceableObject} object
   *   - @param {number} currZ              Current elevation
   *   - @param {number} prevZ              Elevation at previous step
   *   - @returns {boolean} True if object should be kept
   * @returns {Set<PlaceableObject>}
   */
  static _getMoveObjectsPercentGrid(currGridCoords, prevGridCoords, quadtree, objectBoundsFn, filterFn) {
    const currZ = canvasElevationFromCoordinates(currGridCoords);
    const prevZ = canvasElevationFromCoordinates(prevGridCoords);
    const shape = gridShape(currGridCoords);
    const bounds = shape.getBounds();
    const percentThreshold = this.percentThreshold;
    const totalArea = shape.area;
    const collisionTest = o => percentOverlap(objectBoundsFn(o.t), shape, totalArea) >= percentThreshold
      && filterFn(o.t, currZ, prevZ);
    return quadtree.getObjects(bounds, { collisionTest });
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

  static movePenaltyFn() { return this.#penaltySubclass.moveMultiplier.bind(this); }

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
   * Filter placeable tokens by either a center test or a percent overlap test.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {Settings.KEYS.GRID_TERRAIN.CHOICES} type Type of test: center or percentage
   * @returns {Set<Token>}
   */
  static _filterTokens(currGridCoords, prevGridCoords, type) {
    const method = type === Settings.KEYS.GRID_TERRAIN.CHOICES.PERCENT
      ? "_getMoveObjectsPercentGrid" : "_getMoveObjectsCenterGrid";
    const objectBoundsFn = t => t.constrainedTokenBorder;
    const filterFn = (t, currZ, _prevZ) => currZ.between(t.bottomZ && t.topZ);
    return this[method](
      currGridCoords,
      prevGridCoords,
      canvas.tokens.quadtree,
      objectBoundsFn,
      filterFn);
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
  static moveMultiplier(currGridCoords, prevGridCoords, { token, tokenMultiplier } = {}) {
    tokenMultiplier ??= this.tokenMultiplier;
    if ( tokenMultiplier === 1 ) return 1;
    const tokens = this._filterTokens(currGridCoords, prevGridCoords, CENTER);
    tokens.delete(token);
    return tokens.size ? tokenMultiplier : 1;
  }
}

export class TokenMovePenaltyPercentGrid extends TokenMovePenaltyGridded {
  /**
   * Move tokenMultiplieriplier accounting for tokens that overlap a percentage of the grid.
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
    const tokens = this._filterTokens(currGridCoords, prevGridCoords, PERCENT);
    tokens.delete(token);
    return tokens.size ? tokenMultiplier : 1;
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
  static movePenaltyFn() { return this.#penaltySubclass.moveMultiplier.bind(this); }

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
   * Filter placeable tokens by either a center test or a percent overlap test.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @param {Settings.KEYS.GRID_TERRAIN.CHOICES} type Type of test: center or percentage
   * @returns {Set<Token>}
   */
  static _filter(currGridCoords, prevGridCoords, type) {
    const method = type === PERCENT
      ? "_getMoveObjectsPercentGrid" : "_getMoveObjectsCenterGrid";
    return this[method](
      currGridCoords,
      prevGridCoords,
      canvas.drawings.quadtree,
      this._shapeForDrawing,
      this._hasActiveDrawingTerrain);
  }

  /**
   * Helper to calculate the percentage penalty for a set of drawings.
   * @param {Set<Drawing>} drawings
   * @returns {number}
   */
  static _calculateDrawingsMovePenalty(drawings) {
    return drawings.reduce((acc, curr) => {
      const penalty = curr.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) || 1;
      return acc * penalty;
    }, 1);
  }
}

export class DrawingMovePenaltyCenterGrid extends DrawingMovePenaltyGridded {
  /**
   * Move multiplier accounting for tokens that overlap the center of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords) {
    const drawings = this._filter(currGridCoords, prevGridCoords, CENTER);
    return this._calculateDrawingsMovePenalty(drawings);
  }

}

export class DrawingMovePenaltyPercentGrid extends DrawingMovePenaltyGridded {
  /**
   * Move multiplier accounting for tokens that overlap a percentage of the grid.
   * @param {GridCoordinates3d} currGridCoords        The current grid location
   * @param {GridCoordinates3d} prevGridCoords        The previous step along the grid
   * @returns {number} Percent penalty
   */
  static moveMultiplier(currGridCoords, prevGridCoords) {
    const drawings = this._getMoveObjectsPercentGrid(
      currGridCoords,
      prevGridCoords,
      canvas.drawings.quadtree,
      this._shapeForDrawing,
      this._hasActiveDrawingTerrain);
    return this._calculateDrawingsMovePenalty(drawings);
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

  static movePenaltyFn() { return this.#penaltySubclass.moveMultiplier.bind(this); }

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
    const currCenter = getCenterPoint3d(currGridCoords);
    this.terrain.percentMovementChangeForTokenAtPoint(token, currCenter, this.getSpeedAttribute(token));
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
    const currElev = canvasElevationFromCoordinates(currGridCoords);
    const shape = gridShape(currGridCoords);
    this.terrain.percentMovementChangeForTokenWithinShape(
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
    const currCenter = getCenterPoint3d(currGridCoords);
    this.terrain.percentMovementChangeForTokenAtPoint(token, currCenter, this.getSpeedAttribute(token));
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
 * @param {GridCoordinates} a                    Origin point of ray
 * @param {GridCoordinates} b                    Destination point of ray
 * @param {Set<PIXI.Polygon
           |PIXI.Rectangle
           |PIXI.Circle>} shapes            Any shape that has a contains(x,y) method
 * @param {function} shapePenaltyFn         Function that takes a shape and returns a penalty value
 * @returns {number}
 */
function rayShapesIntersectionPenalty(a, b, shapes, shapePenaltyFn) {
  if ( !shapes.size ) return 1;

  a = pointFromGridCoordinates(a);
  b = pointFromGridCoordinates(b);

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

// Register subclasses used for different grid penalty measurements.
TokenMovePenaltyGridded._registerPenaltySubclass(CENTER, TokenMovePenaltyCenterGrid);
TokenMovePenaltyGridded._registerPenaltySubclass(PERCENT, TokenMovePenaltyPercentGrid);
TokenMovePenaltyGridded._registerPenaltySubclass(EUCLIDEAN, TokenMovePenaltyEuclideanGrid);

DrawingMovePenaltyGridded._registerPenaltySubclass(CENTER, DrawingMovePenaltyCenterGrid);
DrawingMovePenaltyGridded._registerPenaltySubclass(PERCENT, DrawingMovePenaltyPercentGrid);
DrawingMovePenaltyGridded._registerPenaltySubclass(EUCLIDEAN, DrawingMovePenaltyEuclideanGrid);

TerrainMovePenaltyGridded._registerPenaltySubclass(CENTER, TerrainMovePenaltyCenterGrid);
TerrainMovePenaltyGridded._registerPenaltySubclass(PERCENT, TerrainMovePenaltyPercentGrid);
TerrainMovePenaltyGridded._registerPenaltySubclass(EUCLIDEAN, TerrainMovePenaltyEuclideanGrid);
