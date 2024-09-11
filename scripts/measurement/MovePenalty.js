/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, OTHER_MODULES, SPEED, MOVEMENT_TYPES } from "../const.js";
import { Settings } from "../settings.js";
import { movementType } from "../token_hud.js";
import { log, keyForValue } from "../util.js";
import { getOffsetDistanceFn } from "./Grid.js";

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
    this.speedFn = speedFn ?? (token =>
      foundry.utils.getProperty(token, SPEED.ATTRIBUTES[keyForValue(MOVEMENT_TYPES, token.movementType)]));
    this.#localTokenClone = this.constructor._constructTokenClone(this.moveToken);
    const tokenMultiplier = this.constructor.tokenMultiplier;
    const terrainAPI = this.constructor.terrainAPI;

    // Only regions with terrains; tokens if that setting is enabled; drawings if enabled.
    if ( tokenMultiplier !== 1 ) canvas.tokens.placeables.forEach(t => this.tokens.add(t));
    if ( terrainAPI ) canvas.regions.placeables.forEach(r => {
      if ( r.terrainmapper.hasTerrain ) this.regions.add(r);
    });
    canvas.drawings.placeables.forEach(d => {
      const penalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) ?? 1;
      const useFlatPenalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT);
      if ( (!useFlatPenalty && penalty !== 1) || (useFlatPenalty && penalty !== 0) ) this.drawings.add(d);
    });
    this.tokens.delete(moveToken);

    // Remove certain hidden tokens.
    // Note this is done only at beginning, but the MoveInstance only intended to last through a ruler measure.
    this.tokens = this.tokens.filter(t => !(t.document.hidden
        || t.actor.statuses.intersects(CONFIG[MODULE_ID].pathfindingIgnoreStatuses)));

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
      const a = path[i - 1].center;
      const b = path[i].center;
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
  #localTokenClone;

  /**
   * Construct the local token clone.
   * This takes some time.
   * @returns {object}
   */
  static _constructTokenClone(token) {
    const actor = new CONFIG.Actor.documentClass(token.actor.toObject());
    const document = new CONFIG.Token.documentClass(token.document.toObject());
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
          return this.document.elevation;
        }
      }
    });
    return tClone;
  }

  #penaltyCache = new Map();

  clearPenaltyCache() { this.#penaltyCache.clear(); }

  // ----- NOTE: Primary methods ----- //

  /**
   * Determine the movement cost for a segment.
   * @param {GridCoordinates3d} startCoords     Exact starting position
   * @param {GridCoordinates3d} endCoords       Exact ending position
   * @param {number} costFreeDistance           Measured distance of the segment (may be offset distance)
   * @returns {number} The costFreeDistance + cost, in grid units.
   */
  movementCostForSegment(startCoords, endCoords, costFreeDistance = 0, forceGridPenalty) { // eslint-disable-line default-param-last
    forceGridPenalty ??= Settings.get(Settings.KEYS.MEASURING.FORCE_GRID_PENALTIES);
    forceGridPenalty &&= !canvas.grid.isGridless;

    // Did we already test this segment?
    const startKey = forceGridPenalty ? startCoords.center.key : startCoords.key;
    const endKey = forceGridPenalty ? endCoords.center.key : endCoords.key;
    const key = `${startKey}|${endKey}`;
    if ( this.#penaltyCache.has(key) ) return this.#penaltyCache.get(key);

    let res = costFreeDistance;
    if ( forceGridPenalty ) {
      // Cost is assigned to each grid square/hex
      const isOneStep = Math.abs(endCoords.i - startCoords.i) < 2
        && Math.abs(endCoords.j - startCoords.j) < 2
        && Math.abs(endCoords.k - startCoords.k) < 2;
      if ( isOneStep ) return this.movementCostForGridSpace(endCoords, costFreeDistance);

      // Unlikely scenario where endCoords are more than 1 step away from startCoords.
      let totalCost = 0;
      const path = canvas.grid.getDirectPath([startCoords, endCoords]);
      const offsetDistanceFn = getOffsetDistanceFn();
      let prevOffset = path[0];
      for ( let i = 1, n = path.length; i < n; i += 1 ) {
        const currOffset = path[i];
        const offsetDist = offsetDistanceFn(prevOffset, currOffset);
        totalCost += (this.movementCostForGridSpace(endCoords, offsetDist) - offsetDist);
        prevOffset = currOffset;
      }
      res = totalCost + costFreeDistance;
    } else {
      // Cost is proportional to the distance of the segment covered by each penalty-imposing token,region,drawing.
      const multiplier = this.proportionalCostForSegment(startCoords, endCoords);
      res = costFreeDistance * multiplier;
    }
    this.#penaltyCache.set(key, res);
    return res;
  }


  /**
   * Determine the movement cost when in a specific grid space.
   * Typically used with Settings.KEYS.FORCE_GRID_PENALTIES.
   * @param {GridCoordinates3d} coords     Exact starting position
   * @param {number} costFreeDistance           Measured distance of the step
   * @returns {number} The additional cost, in grid units, plus the costFreeDistance.
   */
  movementCostForGridSpace(coords, costFreeDistance = 0) {
    // Determine what regions, tokens, drawings overlap the center point.
    const centerPt = coords.center;
    const regions = [...this.regions].filter(r => r.testPoint(centerPt, centerPt.elevation));
    const tokens = [...this.tokens].filter(t => t.constrainedTokenBorder.contains(centerPt.x, centerPt.y)
      && centerPt.elevation.between(t.bottomE, t.topE));
    const drawings = [...this.drawings].filter(d => d.bounds.contains(centerPt.x, centerPt.y)
      && d.elevationE <= centerPt.elevation);

    // Track all speed multipliers and flat penalties for the grid space.
    let flatPenalty = 0;
    let currentMultiplier = 1;

    // Drawings
    drawings.forEach(d => {
      const penalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
      if ( d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT) ) flatPenalty += penalty;
      else currentMultiplier *= penalty;
    });

    // Tokens
    const tokenMultiplier = this.constructor.tokenMultiplier;
    const useTokenFlat = this.constructor.useFlatTokenMultiplier;
    if ( useTokenFlat ) flatPenalty += (tokenMultiplier * tokens.length); // Default to 0.
    else currentMultiplier *= (tokens.length ? (tokenMultiplier * tokens.length) : 1); // Default to 1.

    // Regions
    const testRegions = this.constructor.terrainAPI && regions.length;
    const tClone = testRegions ? this.#initializeTokenClone() : this.moveToken;
    const startingSpeed = this.speedFn(tClone) || 1;
    regions.forEach(r => this.#addTerrainsToToken(tClone, r));

    currentMultiplier ||= 1; // Don't let it divide by 0.
    const speedInGrid = ((this.speedFn(tClone) || 1) / currentMultiplier);
    const gridMult = startingSpeed / speedInGrid; // If currentMultiplier > 1, gridMult should be > 1.
    return (flatPenalty + (gridMult * costFreeDistance));

    /* Example
      Token has speed 30 and moves 10 grid units.
      Assume speed is halved plus a +5 flat penalty.
      30 / 15 = 2 * 10 = 20 grid units + 5 penalty.
      So instead of moving 10 units, it is as though the token moved 25.
    */
  }


  /**
   * Determine the movement penalties along a start|end segment.
   * By default, the penalty is apportioned based on the exact intersections of the penalty
   * region to the segment. If `forceGridPenalty=true`, then the penalty is assigned per grid space.
   *
   * @param {GridCoordinates3d} startCoords     Exact starting position
   * @param {GridCoordinates3d} endCoords       Exact ending position
   * @returns {number} The number used to multiply the move speed along the segment.
   */
  proportionalCostForSegment(startCoords, endCoords) {
    // Intersections for each region, token, drawing.
    const cutawayIxs = this._cutawayIntersections(startCoords, endCoords);
    if ( !cutawayIxs.length ) return 1;
    return this._penaltiesForIntersections(startCoords, endCoords, cutawayIxs);
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
    if ( this.constructor.terrainAPI ) {
      for ( const region of this.pathRegions ) {
        const ixs = region.terrainmapper._cutawayIntersections(start, end);
        ixs.forEach(ix => ix.region = region);
        cutawayIxs.push(...ixs);
      }
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
   * @returns {number} The penalty multiplier for the given start --> end
   */
  _penaltiesForIntersections(start, end, cutawayIxs) {
    if ( !cutawayIxs.length ) return 1;

    // Tokens
    const tokenMultiplier = this.constructor.tokenMultiplier;
    const useTokenFlat = this.constructor.useFlatTokenMultiplier;

    // Regions
    const testRegions = this.constructor.terrainAPI && this.pathRegions;
    const tClone = testRegions ? this.#initializeTokenClone() : this.moveToken;
    const startingSpeed = this.speedFn(tClone) || 1;

    // Traverse each intersection, determining the speed multiplier from starting speed
    // and calculating total time and distance. x meters / y meters/second = x/y seconds
    const { to2d, convertToDistance } = CONFIG.GeometryLib.utils.cutaway;
    let totalDistance = 0;
    let totalUnmodifiedDistance = 0;
    let totalTime = 0;
    let currentMultiplier = 1;
    let currentFlat = 0;
    const start2d = convertToDistance(to2d(start, start, end));
    const end2d = convertToDistance(to2d(end, start, end));
    let prevIx = start2d;
    cutawayIxs = cutawayIxs.map(ix => convertToDistance(shallowCopyCutawayIntersection(ix))); // Avoid modifying the originals.
    cutawayIxs.push(end2d);
    cutawayIxs.sort((a, b) => a.x - b.x);
    for ( const ix of cutawayIxs ) {
      // Must invert the multiplier to apply them as penalties. So a 2x penalty is 1/2 times speed.
      const multFn = ix.movingInto ? x => 1 / x : x => x;
      const addFn = ix.movingInto ? x => x : x => -x;
      const terrainFn = ix.movingInto ? this.#addTerrainsToToken.bind(this) : this.#removeTerrainsFromToken.bind(this);

      // Handle all intersections at the same point.
      if ( ix.almostEqual(prevIx) ) {
        if ( ix.token ) {
          if ( useTokenFlat ) currentFlat += addFn(tokenMultiplier);
          else currentMultiplier *= multFn(tokenMultiplier);
        }
        if ( ix.drawing ) {
          const penalty = ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
          if ( ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT) ) currentFlat += addFn(penalty);
          else currentMultiplier *= multFn(penalty);
        }
        if ( ix.region ) terrainFn(tClone, ix.region);
        continue;
      }

      // Now we have prevIx --> ix.
      prevIx.flat = currentFlat;
      prevIx.multiplier = currentMultiplier;
      prevIx.dist = CONFIG.GeometryLib.utils.pixelsToGridUnits(PIXI.Point.distanceBetween(prevIx, ix));
      totalUnmodifiedDistance += prevIx.dist;

      // Speed is adjusted when moving through regions with a multiplier.
      prevIx.tokenSpeed = ((this.speedFn(tClone) || 1) * prevIx.multiplier);

      // Flat adds extra distance to the grid square. Diagonal is longer, so will have larger penalty.
      prevIx.dist += (prevIx.dist * currentFlat / canvas.grid.distance);
      totalDistance += prevIx.dist;
      totalTime += (prevIx.dist / prevIx.tokenSpeed);
      prevIx = ix;

      if ( ix.almostEqual(end2d) ) break;

      // Account for the changes due to ix.
      if ( ix.token ) {
        if ( useTokenFlat ) currentFlat += addFn(tokenMultiplier);
        else currentMultiplier *= multFn(tokenMultiplier);
      }
      if ( ix.drawing ) {
        const penalty = ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
        if ( ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT) ) currentFlat += addFn(penalty);
        else currentMultiplier *= multFn(penalty);
      }
      if ( ix.region ) terrainFn(tClone, ix.region);
    }

    // Determine the ratio compared to a set speed
    const totalDefaultTime = totalUnmodifiedDistance / startingSpeed;
    const avgMultiplier = (totalDefaultTime / totalTime) || 0;
    return 1 / avgMultiplier;
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

  /**
   * Initialize the token clone for testing movement penalty through regions.
   * @returns {object} Token like object
   */
  #initializeTokenClone() {
    const tClone = this.#localTokenClone;
    const Terrain = CONFIG.terrainmapper.Terrain;
    const tokenTerrains = Terrain.allOnToken(tClone);
    if ( tokenTerrains.length ) {
      CONFIG.terrainmapper.Terrain.removeFromTokenLocally(tClone, tokenTerrains, { refresh: false });
      tClone.actor._initialize(); // This is slow; we really need something more specific to active effects.
    }
    return tClone;
  }

  // ----- NOTE: Static getters ----- //

  /** @type {number} */
  static get tokenMultiplier() { return Settings.get(Settings.KEYS.MEASURING.TOKEN_MULTIPLIER); }

  /** @type {boolean} */
  static get useFlatTokenMultiplier() { return Settings.get(Settings.KEYS.MEASURING.TOKEN_MULTIPLIER_FLAT); }

  /** @type {object|undefined} */
  static get terrainAPI() { return OTHER_MODULES.TERRAIN_MAPPER.API; }

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
