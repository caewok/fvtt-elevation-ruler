/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, MODULES_ACTIVE, SPEED } from "./const.js";
import { Settings } from "./settings.js";
import { getCenterPoint3d } from "./grid_coordinates.js";

/*
Class to measure penalty, as percentage of distance, between two points.
Accounts for token movement through terrain.
Type of penalties:
- Moving through other tokens.
- Moving through Terrain Mapper terrain.
- Moving through Drawings. Under drawing elevation is ignored.

Instantiate the class for a given measurement, which then identifies the bounds of potential obstacles.
*/

export class MovePenalty {

  /** @type {Token} */
  moveToken;

  /** @type {function} */
  speedFn;

  /** @type {Set<Region>} */
  regions = new Set();

  /** @type {Set<Drawing>} */
  drawings = new Set();

  /** @type {Set<Token>} */
  tokens = new Set();

  /**
   * @param {Token} [moveToken]               The token doing the movement
   * @param {GridCoordinates3d[]} [path]      The path that will be tested for move penalties
   *   Used to filter regions, tokens, drawings accordingly
   */
  constructor(moveToken, speedFn, path = []) {
    this.moveToken = moveToken;
    this.speedFn = speedFn ?? (token => foundry.utils.getProperty(token, SPEED.ATTRIBUTES[token.movementType]));
    const tokenMultiplier = this.tokenMultiplier;
    const terrainAPI = this.terrainAPI;

    // Only regions with terrains; tokens if that setting is enabled; drawings if enabled.
    if ( tokenMultiplier !== 1 ) canvas.tokens.placeables.forEach(t => this.tokens.add(t));
    if ( terrainAPI ) canvas.regions.placeables.forEach(r => {
      if ( r.terrainmapper.hasTerrain ) this.regions.add(r);
    });

    canvas.drawings.placeables.forEach(d => {
      const penalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
      if ( penalty && penalty !== 1 ) this.drawings.add(d)
    });

    // Locate all the regions/drawings/tokens along the path, testing using 2d bounds.
    for ( let i = 1, n = path.length; i < n; i += 1 ) {
      const a = getCenterPoint3d(path[i - 1]);
      const b = getCenterPoint3d(path[i]);
      this.tokens.forEach(t => {
        if ( !t.constrainedTokenBorder.lineSegmentIntersects(a, b, { inside: true })) this.tokens.delete(t);
      });
      this.drawings.forEach(d => {
        if ( !d.bounds.lineSegmentIntersects(a, b, { inside: true })) this.drawings.delete(d);
      });
      this.regions.forEach(r => {
        if ( !r.bounds.lineSegmentIntersects(a, b, { inside: true })) this.regions.delete(r);
      });
    }
    this.tokens.delete(moveToken);
  }

  // ----- NOTE: Getters ------ //

  /** @type {boolean} */
  get anyPotentialObstacles() { return this.tokens.size || this.regions.size || this.drawings.size; }

  /**
   * Local clone of a token.
   * Currently clones the actor and the token document but makes no effort to clone the other token properties.
   * @param {Token} token
   * @returns {object}
   *   - @prop {TokenDocument} document
   *   - @prop {Actor} actor
   */
  get localTokenClone() {
    const actor = new CONFIG.Actor.documentClass(this.moveToken.actor.toObject())
    const document = new CONFIG.Token.documentClass(this.moveToken.document.toObject())
    return { document, actor };
  }

  // ----- NOTE: Primary methods ----- //

  /**
   * Determine the movement penalties along a start|end segment.
   * @param {GridCoordinates3d} startCoords
   * @param {GridCoordinates3d} endCoords
   * @returns {number} The number used to multiply the move speed along the segment.
   */
  movementPenaltyForSegment(startCoords, endCoords) {
    const start = getCenterPoint3d(startCoords);
    const end = getCenterPoint3d(endCoords);
    const cutawayShapes = this._cutawayShapes(start, end);
    if ( !cutawayShapes.length ) return 1;
    const cutawayIxs = this._intersectionsForCutawayShapes(start, end, cutawayShapes);
    const changePts = this._penaltiesForIntersections(start, end, cutawayIxs);
    return changePts.avgMultiplier;
  }

  // ----- NOTE: Secondary methods ----- //

  /**
   * @typedef {PIXI.Polygon} CutawayShape
   * @prop {Token} token      Token this shape represents
   * @prop {Region} region    Region this shape represents
   * @prop {Drawing} drawing  Drawing this shape represents
   */

  /**
   * @typedef {PIXI.Point} CutawayIntersection
   * @prop {CutawayShape} shape   Shape that is intersected
   * @prop {boolean} movingInto   From start --> end, are we moving into the shape?
   * @prop {number} moveMultiplier
   */

  /**
   * Get all the cutaways for tokens, regions, drawings for a given start|end segment.
   * Associate each cutaway with its underlying object.
   * @param {Point3d} start
   * @param {Point3d} end
   * @returns {CutawayShape[]} Polygon with an associated object.
   */
  _cutawayShapes(start, end) {
    const shapes = [];
    for ( const region of this.regions ) {
      this.terrainAPI.ElevationHandler._fromPoint3d(start);
      this.terrainAPI.ElevationHandler._fromPoint3d(end);
      const combined = region.terrainmapper._cutaway(start, end);
      if ( !combined ) continue;
      const polys = combined.toPolygons();
      polys.forEach(poly => poly.region = region);
      shapes.push(...polys);
    }
    for ( const token of this.tokens ) {
      const polys = this.constructor.tokenCutaway(start, end, token);
      polys.forEach(poly => poly.token = token);
      shapes.push(...polys);
    }
    for ( const drawing of this.drawings ) {
      const polys = this.constructor.drawingCutaway(start, end, drawing);
      polys.forEach(poly => poly.drawing = drawing);
      shapes.push(...polys);
    }
    return shapes;
  }

  /**
   * Determine intersections for an array of cutaway shapes.
   * Sort them and determine for each if this is a move into the shape or a move out.
   * @param {Point3d} start
   * @param {Point3d} end
   * @param {CutawayShape[]} cutawayShapes
   * @returns {CutawayIntersection[]} Points marked with shape and movingInto properties.
   */
  _intersectionsForCutawayShapes(start, end, cutawayShapes = []) {
    const start2d = CONFIG.GeometryLib.utils.cutaway.to2d(start, start, end);
    const end2d = CONFIG.GeometryLib.utils.cutaway.to2d(end, start, end);
    const cutawayIxs = [];
    for ( const shape of cutawayShapes ) {
      const ixs = shape.segmentIntersections(start2d, end2d);
      ixs.sort((a, b) => a.t0 - b.t0);

      // If inside the shape, the first intersection will be at the start. So always starting outside --> in.
      let isInside = false;

      // Mark each intersection point along the polygon.
      // Can skip ending intersections.
      for ( const ix of ixs ) {
        const ixP = PIXI.Point.fromObject(ix);
        ixP.movingInto = isInside ^ shape.isPositive; // isPositive means not a hole.
        ixP.shape = shape;
        cutawayIxs.push(ixP);
        isInside = !isInside;
      }
    }
    return cutawayIxs;
  }

  /**
   * Determine movement penalties along a start|end segment for a given array of intersections.
   * @param {Point3d} start
   * @param {Point3d} end
   * @param {CutawayIntersection[]} cutawayIxs
   * @returns {CutawayIntersection[]} Intersections with penalties and intersections converted to distance for x axis.
   */
  _penaltiesForIntersections(start, end, cutawayIxs) {
    if ( !cutawayIxs.length ) {
      const arr = [];
      arr.totalDistance = PIXI.Point.distanceBetween(start, end);
      arr.totalTime = this.speedFn(this.moveToken);
      arr.avgMultiplier = 1;
      return arr;
    }

    const testRegions = this.terrainAPI && this.regions;
    const tokenMultiplier = this.tokenMultiplier;
    let tClone = this.moveToken;
    if ( testRegions ) {
      tClone = this.localTokenClone;
      const Terrain = CONFIG.terrainmapper.Terrain;
      const tokenTerrains = Terrain.allOnToken(tClone);
      if ( tokenTerrains.length ) {
        CONFIG.terrainmapper.Terrain.removeFromTokenLocally(tClone, tokenTerrains, { refresh: false });
        tClone.actor._initialize();
      }
    }
    const startingSpeed = this.speedFn(tClone);

    // Traverse each intersection, determining the speed multiplier from starting speed
    // and calculating total time and distance. x meters / y meters/second = x/y seconds
    const { to2d, convertToDistance } = CONFIG.GeometryLib.utils.cutaway;
    let totalDistance = 0;
    let totalTime = 0;
    let currentMultiplier = 1;
    const start2d = convertToDistance(to2d(start, start, end));
    const end2d = convertToDistance(to2d(end, start, end));
    let prevIx = start2d;
    const changePts = [];
    cutawayIxs = cutawayIxs.map(ix => convertToDistance(duplicateCutawayIntersection(ix))); // Avoid modifying the originals.
    cutawayIxs.push(end2d);
    cutawayIxs.sort((a, b) => a.x - b.x);
    for ( const ix of cutawayIxs ) {
      // Must invert the multiplier to apply them as penalties. So a 2x penalty is 1/2 times speed.
      const multFn = ix.movingInto ? x => 1 / x : x => x;
      const terrainFn = ix.movingInto ? this.#addTerrainsToToken.bind(this) : this.#removeTerrainsFromToken.bind(this);

      // Handle all intersections at the same point.
      if ( ix.almostEqual(prevIx) ) {
        if ( ix.shape?.token ) currentMultiplier *= multFn(tokenMultiplier);
        if ( ix.shape?.drawing ) currentMultiplier *= multFn(ix.shape.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY));
        if ( ix.shape?.region ) terrainFn(tClone, ix.shape.region);
        continue;
      }

      // Now we have prevIx --> ix.
      prevIx.multiplier = currentMultiplier;
      prevIx.dist = PIXI.Point.distanceBetween(prevIx, ix);
      prevIx.tokenSpeed = (this.speedFn(tClone) * prevIx.multiplier);
      totalDistance += prevIx.dist;
      totalTime += (prevIx.dist / prevIx.tokenSpeed);
      changePts.push(prevIx);
      prevIx = ix;

      if ( ix.almostEqual(end2d) ) break;

      // Account for the changes due to ix.
      if ( ix.shape?.token ) currentMultiplier *= multFn(tokenMultiplier);
      if ( ix.shape?.drawing ) currentMultiplier *= multFn(ix.shape.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY));
      if ( ix.shape?.region ) terrainFn(tClone, ix.shape.region);
    }

    // Determine the ratio compared to a set speed
    const totalDefaultTime = totalDistance / startingSpeed;
    changePts.totalDistance = totalDistance;
    changePts.totalTime = totalTime;
    changePts.avgMultiplier = (totalDefaultTime / totalTime) || 0;
    return changePts;
  }

  /**
   * Add region terrains to a token (clone). Requires Terrain Mapper to be active.
   * @param {Token|object} token    Token or token clone
   * @param {Region} region         Terrain region to use
   */
  #addTerrainsToToken(token, region) {
    const { terrains, secretTerrains } = region.terrainmapper.terrains;
    const allTerrains = [...terrains, ...secretTerrains];
    if ( !allTerrains.length ) return;
    CONFIG.terrainmapper.Terrain.addToTokenLocally(token, allTerrains, { refresh: false });
    token.actor._initialize();
  }

  /**
   * Remove region terrains from a token (clone). Requires Terrain Mapper to be active.
   * @param {Token|object} token    Token or token clone
   * @param {Region} region         Terrain region to use
   */
  #removeTerrainsFromToken(token, region) {
    const { terrains, secretTerrains } = region.terrainmapper.terrains;
    const allTerrains = [...terrains, ...secretTerrains];
    if ( !allTerrains.length ) return;
    CONFIG.terrainmapper.Terrain.removeFromTokenLocally(token, allTerrains, { refresh: false });
    token.actor._initialize();
  }

  // ----- NOTE: Static getters ----- //

  /** @type {number} */
  static get tokenMultiplier() { return Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER); }

  /** @type {object|undefined} */
  static get terrainAPI() { return MODULES_ACTIVE.API?.TERRAIN_MAPPER; }

  // ----- NOTE: Static methods ----- //

  /**
   * Construct a polygon in cutaway space for a given drawing, based on a line segment.
   * Drawing assumed to be infinite in z direction up, stopping at the drawing elevation.
   * @param {Point3d} start     The beginning endpoint for the 3d segment start|end
   * @param {Point3d} end       The ending point for the 3d segment start|end
   * @param {Drawing} drawing
   * @returns {PIXI.Polygon[]}
   */
  static drawingCutaway(start, end, drawing) {
    const MAX_ELEV = 1e06;
    const bottomZ = drawing.elevationZ;
    const bottomElevationFn = _pt => bottomZ;
    const topElevationFn = _pt => MAX_ELEV;
    const centeredShape = CONFIG.GeometryLib.utils.centeredPolygonFromDrawing(drawing);
    return centeredShape.cutaway(start, end, { bottomElevationFn, topElevationFn });
  }

  /**
   * Construct a polygon in cutaway space for a given token, based on a line segment.
   * Token bottom assumed to be elevation and token top to be the token height.
   * @param {Point3d} start   The beginning endpoint for the 3d segment start|end
   * @param {Point3d} end     The ending point for the 3d segment start|end
   * @param {Token} token
   * @returns {PIXI.Polygon[]} Null if no intersection
   */
  static tokenCutaway(start, end, token) {
    const bottomElevationFn = _pt => token.bottomZ;
    const topElevationFn = _pt => token.topZ;
    return token.constrainedTokenBorder.cutaway(start, end, { bottomElevationFn, topElevationFn });
  }
}


/**
 * Duplicate pertinent parts of a CutawayIntersection.
 * @param {CutawayIntersection} ix
 * @returns {CutawayIntersection}
 */
function duplicateCutawayIntersection(ix) {
  const newIx = ix.clone();
  newIx.movingInto = ix.movingInto;
  newIx.shape = ix.shape;
  return newIx;
}



/**
 * A function that returns the cost for a given move between grid/gridless spaces.
 * In square and hexagonal grids the grid spaces are always adjacent unless teleported.
 * The distance is 0 if and only if teleported. The function is never called with the same offsets.
 * @callback GridMeasurePathCostFunction
 * @param {GridOffset} from    The offset that is moved from.
 * @param {GridOffset} to      The offset that is moved to.
 * @param {number} distance    The distance between the grid spaces, or 0 if teleported.
 * @returns {number}           The cost of the move between the grid spaces.
 */
