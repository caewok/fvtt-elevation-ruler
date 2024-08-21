/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, MODULES_ACTIVE, SPEED, MOVEMENT_TYPES } from "../const.js";
import { Settings } from "../settings.js";
import { getCenterPoint3d } from "./grid_coordinates.js";
import { movementType } from "../token_hud.js";
import { log, keyForValue } from "../util.js";

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

  /** @type {Set<Region>} */
  pathRegions = new Set();

  /** @type {Set<Drawing>} */
  pathDrawings = new Set();

  /** @type {Set<Token>} */
  pathTokens = new Set();


  /**
   * @param {Token} moveToken               The token doing the movement
   * @param {function} [speedFn]            Function used to determine speed of the token
   */
  constructor(moveToken, speedFn) {
    this.moveToken = moveToken;
    this.speedFn = speedFn ?? (token => foundry.utils.getProperty(token, SPEED.ATTRIBUTES[keyForValue(MOVEMENT_TYPES,  token.movementType)]));
    this.localTokenClone = this.constructor._constructTokenClone(this.moveToken);
    const tokenMultiplier = this.constructor.tokenMultiplier;
    const terrainAPI = this.constructor.terrainAPI;

    // Only regions with terrains; tokens if that setting is enabled; drawings if enabled.
    if ( tokenMultiplier !== 1 ) canvas.tokens.placeables.forEach(t => this.tokens.add(t));
    if ( terrainAPI ) canvas.regions.placeables.forEach(r => {
      if ( r.terrainmapper.hasTerrain ) this.regions.add(r);
    });
    canvas.drawings.placeables.forEach(d => {
      const penalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
      if ( penalty && penalty !== 1 ) this.drawings.add(d)
    });
    this.tokens.delete(moveToken);

    // Initially set the path sets to the full set of placeables.
    this.tokens.forEach(t => this.pathTokens.add(t));
    this.drawings.forEach(d => this.pathDrawings.add(d));
    this.regions.forEach(r => this.pathRegions.add(r));
  }

  /**
   * Limit the placeables to test to a given path.
   * @param {GridCoordinates3d[]} [path]      The path that will be tested
   */
  restrictToPath(path = []) {
    this.pathTokens.clear();
    this.pathDrawings.clear();
    this.pathRegions.clear();

    // Locate all the regions/drawings/tokens along the path, testing using 2d bounds.
    for ( let i = 1, n = path.length; i < n; i += 1 ) {
      const a = getCenterPoint3d(path[i - 1]);
      const b = getCenterPoint3d(path[i]);
      this.tokens.forEach(t => {
        if ( t.constrainedTokenBorder.lineSegmentIntersects(a, b, { inside: true })) this.pathTokens.add(t);
      });
      this.drawings.forEach(d => {
        if ( d.bounds.lineSegmentIntersects(a, b, { inside: true })) this.pathDrawings.add(d);
      });
      this.regions.forEach(r => {
        if ( r.bounds.lineSegmentIntersects(a, b, { inside: true })) this.pathRegions.add(r);
      });
    }
  }

  // ----- NOTE: Getters ------ //

  /** @type {boolean} */
  get anyPotentialObstacles() { return this.pathTokens.size || this.pathRegions.size || this.pathDrawings.size; }

  /**
   * Local clone of a token.
   * Currently clones the actor and the token document but makes no effort to clone the other token properties.
   * @param {Token} token
   * @returns {object}
   *   - @prop {TokenDocument} document
   *   - @prop {Actor} actor
   */
  localTokenClone;

  /**
   * Construct the local token clone.
   * This takes some time.
   * @returns {object}
   */
  static _constructTokenClone(token) {
    const actor = new CONFIG.Actor.documentClass(token.actor.toObject())
    const document = new CONFIG.Token.documentClass(token.document.toObject())
    const tClone = { document, actor, _original: token };

    // Add the movementType and needed properties to calculate movement type.
    Object.defineProperties(tClone, {
      movementType: {
        get: movementType
      },
      center: {
        get: function() {
          const {x, y} = this._original.getCenterPoint(this.document);
          return new PIXI.Point(x, y);
        }
      },
      elevationE: {
        get: function() {
          return this.document.elevation
        }
      }
    });
    return tClone;
  }

  #penaltyCache = new Map();

  clearPenaltyCache() { this.#penaltyCache.clear(); }

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
    const key = `${start.key}|${end.key}`;
    if ( this.#penaltyCache.has(key) ) return this.#penaltyCache.get(key);

    const t0 = performance.now();
    const cutawayIxs = this._cutawayIntersections(start, end);
    if ( !cutawayIxs.length ) return 1;
    const t1 = performance.now();
    const avgMultiplier = this._penaltiesForIntersections(start, end, cutawayIxs);
    const t2 = performance.now();
    if ( CONFIG[MODULE_ID].debug ) {
      console.group(`${MODULE_ID}|movementPenaltyForSegment`);
      console.debug(`${startCoords.x},${startCoords.y},${startCoords.z}(${startCoords.i},${startCoords.j},${startCoords.k}) --> ${endCoords.x},${endCoords.y},${endCoords.z}(${endCoords.i},${endCoords.j},${endCoords.k})`);
      console.table({
        _cutawayIntersections: (t1 - t0).toNearest(.01),
        penaltiesForIntersections: (t2 - t1).toNearest(.01),
        total: (t2 - t0).toNearest(.01)
      });
      console.groupEnd(`${MODULE_ID}|movementPenaltyForSegment`);
    }
    this.#penaltyCache.set(key, 1 / avgMultiplier);
    return 1 / avgMultiplier;
  }

  // ----- NOTE: Secondary methods ----- //

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
   * @returns {CutawayIntersection[]} Polygon with an associated object.
   */
  _cutawayIntersections(start, end) {
    const cutawayIxs = [];
    const terrainAPI = this.constructor.terrainAPI;
    for ( const region of this.pathRegions ) {
      terrainAPI.ElevationHandler._fromPoint3d(start);
      terrainAPI.ElevationHandler._fromPoint3d(end);
      const ixs = region.terrainmapper._cutawayIntersections(start, end);
      ixs.forEach(ix => ix.region = region);
      cutawayIxs.push(...ixs);
    }
    for ( const token of this.pathTokens ) {
      const ixs = this.constructor.tokenCutawayIntersections(start, end, token);
      ixs.forEach(ix => ix.token = token);
      cutawayIxs.push(...ixs);
    }
    for ( const drawing of this.pathDrawings ) {
      const ixs = this.constructor.drawingCutawayIntersections(start, end, drawing);
      ixs.forEach(ix => ix.drawing = drawing);
      cutawayIxs.push(...ixs);
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
    if ( !cutawayIxs.length ) return 1;

    // Set up the token clone to add and subtract terrains.
    const tokenMultiplier = this.constructor.tokenMultiplier;
    let tClone = this.moveToken;
    const testRegions = this.constructor.terrainAPI && this.pathRegions;
    if ( testRegions ) {
      tClone = this.localTokenClone;
      const Terrain = CONFIG.terrainmapper.Terrain;
      const tokenTerrains = Terrain.allOnToken(tClone);
      if ( tokenTerrains.length ) {
        CONFIG.terrainmapper.Terrain.removeFromTokenLocally(tClone, tokenTerrains, { refresh: false });
        tClone.actor._initialize(); // This is slow; we really need something more specific to active effects.
      }
    }
    const startingSpeed = this.speedFn(tClone) || 1;

    // Traverse each intersection, determining the speed multiplier from starting speed
    // and calculating total time and distance. x meters / y meters/second = x/y seconds
    const { to2d, convertToDistance } = CONFIG.GeometryLib.utils.cutaway;
    let totalDistance = 0;
    let totalTime = 0;
    let currentMultiplier = 1;
    const start2d = convertToDistance(to2d(start, start, end));
    const end2d = convertToDistance(to2d(end, start, end));
    let prevIx = start2d;
    //const changePts = [];
    cutawayIxs = cutawayIxs.map(ix => convertToDistance(shallowCopyCutawayIntersection(ix))); // Avoid modifying the originals.
    cutawayIxs.push(end2d);
    cutawayIxs.sort((a, b) => a.x - b.x);
    for ( const ix of cutawayIxs ) {
      // Must invert the multiplier to apply them as penalties. So a 2x penalty is 1/2 times speed.
      const multFn = ix.movingInto ? x => 1 / x : x => x;
      const terrainFn = ix.movingInto ? this.#addTerrainsToToken.bind(this) : this.#removeTerrainsFromToken.bind(this);

      // Handle all intersections at the same point.
      if ( ix.almostEqual(prevIx) ) {
        if ( ix.token ) currentMultiplier *= multFn(tokenMultiplier);
        if ( ix.drawing ) currentMultiplier *= multFn(ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY));
        if ( ix.region ) terrainFn(tClone, ix.region);
        continue;
      }

      // Now we have prevIx --> ix.
      prevIx.multiplier = currentMultiplier;
      prevIx.dist = PIXI.Point.distanceBetween(prevIx, ix);
      prevIx.tokenSpeed = (this.speedFn(tClone) || 1) * prevIx.multiplier;
      totalDistance += prevIx.dist;
      totalTime += (prevIx.dist / prevIx.tokenSpeed);
      //changePts.push(prevIx);
      prevIx = ix;

      if ( ix.almostEqual(end2d) ) break;

      // Account for the changes due to ix.
      if ( ix.token ) currentMultiplier *= multFn(tokenMultiplier);
      if ( ix.drawing ) currentMultiplier *= multFn(ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY));
      if ( ix.region ) terrainFn(tClone, ix.region);
    }

    // Determine the ratio compared to a set speed
    const totalDefaultTime = totalDistance / startingSpeed;
    const avgMultiplier = (totalDefaultTime / totalTime) || 0;
    return avgMultiplier;
  }

  /**
   * Add region terrains to a token (clone). Requires Terrain Mapper to be active.
   * @param {Token|object} token    Token or token clone
   * @param {Region} region         Terrain region to use
   */
  #addTerrainsToToken(token, region) {
    const terrains = region.terrainmapper.terrains;
    if ( !terrains.size ) return;

    const t0 = performance.now();
    CONFIG.terrainmapper.Terrain.addToTokenLocally(token, [...terrains.values()], { refresh: false });
    const t1 = performance.now();
    token.actor._initialize(); // This is slow; we really need something more specific to active effects.
    const t2 = performance.now();
    log(`#addTerrainsToToken|\taddLocally: ${(t1 - t0).toNearest(0.01)} ms\tinitialize: ${(t2 - t1).toNearest(0.01)} ms`);
  }

  /**
   * Remove region terrains from a token (clone). Requires Terrain Mapper to be active.
   * @param {Token|object} token    Token or token clone
   * @param {Region} region         Terrain region to use
   */
  #removeTerrainsFromToken(token, region) {
    const terrains = region.terrainmapper.terrains;
    if ( !terrains.size ) return;

    const t0 = performance.now();
    CONFIG.terrainmapper.Terrain.removeFromTokenLocally(token, [...terrains.values()], { refresh: false });
    const t1 = performance.now();
    token.actor._initialize(); // This is slow; we really need something more specific to active effects.
    const t2 = performance.now();
    log(`#removeTerrainsFromToken|\tremoveLocally: ${(t1 - t0).toNearest(0.01)} ms\tinitialize: ${(t2 - t1).toNearest(0.01)} ms`);
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
  static drawingCutawayIntersections(start, end, drawing) {
    const MAX_ELEV = 1e06;
    const bottomZ = drawing.elevationZ;
    const bottomElevationFn = _pt => bottomZ;
    const topElevationFn = _pt => MAX_ELEV;
    const centeredShape = CONFIG.GeometryLib.utils.centeredPolygonFromDrawing(drawing);
    return centeredShape.cutawayIntersections(start, end, { bottomElevationFn, topElevationFn });
  }

  /**
   * Construct a polygon in cutaway space for a given token, based on a line segment.
   * Token bottom assumed to be elevation and token top to be the token height.
   * @param {Point3d} start   The beginning endpoint for the 3d segment start|end
   * @param {Point3d} end     The ending point for the 3d segment start|end
   * @param {Token} token
   * @returns {PIXI.Polygon[]} Null if no intersection
   */
  static tokenCutawayIntersections(start, end, token) {
    const bottomElevationFn = _pt => token.bottomZ;
    const topElevationFn = _pt => token.topZ;
    return token.constrainedTokenBorder.cutawayIntersections(start, end, { bottomElevationFn, topElevationFn });
  }
}


/**
 * Duplicate pertinent parts of a CutawayIntersection.
 * @param {CutawayIntersection} ix
 * @returns {CutawayIntersection}
 */
function shallowCopyCutawayIntersection(ix) {
  const newIx = new ix.constructor();
  Object.getOwnPropertyNames(ix).forEach(key => newIx[key] = ix[key]);
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
