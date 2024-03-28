/* globals
canvas,
CONFIG,
CONST,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import {
  pointFromGridCoordinates,
  unitElevationFromCoordinates,
  getCenterPoint3d } from "./grid_coordinates.js";
import { Point3d } from "./geometry/3d/Point3d.js";

// Class that handles physical distance measurement between two points.

export class PhysicalDistance {
  /**
   * Measure physical distance between two points, accounting for grid rules.
   * @param {GridCoordinates3d} a                     Starting point for the segment
   * @param {GridCoordinates3d} b                     Ending point for the segment
   * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
   * @returns {number} Distance in grid units.
   *  A segment wholly within a square may be 0 distance.
   *  Instead of mathematical shortcuts from center, actual grid squares are counted.
   *  Euclidean on a grid also uses grid squares, but measures using actual diagonal from center to center.
   */
  static measure(a, b, { gridless = false } = {}) {
    return this.#applyChildClass("measure", gridless, a, b);
  }

  /**
   * Get the grid coordinates for a segment between origin and destination.
   * Supplies coordinates in 3 dimensions.
   * @param {GridCoordinates3d} origin        Origination point
   * @param {GridCoordinates3d} destination   Destination point
   * @returns {GridCoordinates3d[]} Array containing each grid point under the line.
   *   For gridless, returns the GridCoordinates of the origin and destination.
   */
  static gridUnder3dLine(origin, destination, { gridless = false } = {}) {
    return this.#applyChildClass("gridUnder3dLine", gridless, origin, destination);
  }

  /**
   * Get the grid coordinates for a segment between origin and destination.
   * @param {GridCoordinates} origin       Origination point
   * @param {GridCoordinates} destination  Destination point
   * @returns {GridCoordinates[]} Array containing each grid point under the line.
   *   For gridless, returns the GridCoordinates of the origin and destination.
   */
  static gridUnder2dLine(origin, destination, { gridless = false } = {}) {
    return this.#applyChildClass("gridUnder2dLine", gridless, origin, destination);
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
    const cl = gridless ? MeasurePhysicalDistanceGridless : MeasurePhysicalDistanceGridded;
    return cl[method](...args);
  }
}

export class MeasurePhysicalDistanceGridless extends MeasurePhysicalDistance {
  /**
   * Measure physical distance between two points, accounting for grid rules.
   * @param {GridCoordinates3d} a                     Starting point for the segment
   * @param {GridCoordinates3d} b                     Ending point for the segment
   * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
   * @returns {number} Distance in grid units.
   *  A segment wholly within a square may be 0 distance.
   *  Instead of mathematical shortcuts from center, actual grid squares are counted.
   *  Euclidean on a grid also uses grid squares, but measures using actual diagonal from center to center.
   */
  static measure(a, b) {
    a = pointFromGridCoordinates(a);
    b = pointFromGridCoordinates(b);
    return CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));
  }

  /**
   * Get the grid coordinates for a segment between origin and destination.
   * Supplies coordinates in 3 dimensions.
   * @param {GridCoordinates3d} origin        Origination point
   * @param {GridCoordinates3d} destination   Destination point
   * @returns {GridCoordinates3d[]} Returns the GridCoordinates of the origin and destination.
   */
  static gridUnder3dLine(origin, destination) {
    const pts = this.gridUnder2dLine(origin, destination);
    pts[0].k = unitElevationFromCoordinates(origin);
    pts[1].k = unitElevationFromCoordinates(destination);
    return pts;
  }

  /*
   * Get the grid coordinates for a segment between origin and destination.
   * @param {GridCoordinates} origin       Origination point
   * @param {GridCoordinates} destination  Destination point
   * @returns {GridCoordinates[]} Array containing each grid point under the line.
   *   For gridless, returns the GridCoordinates of the origin and destination.
   */
  static gridUnder2dLine(origin, destination) {
    return canvas.grid.getDirectPath([origin, destination]);
  }
}

export class MeasurePhysicalDistanceGridded extends MeasurePhysicalDistance {
  /** @type {enum} */
  static CHANGE = {
    NONE: 0,
    V: 1,
    H: 2,
    D: 3,
    E: 4
  };

  /**
   * Measure physical distance between two points, accounting for grid rules.
   * @param {GridCoordinates3d} a                     Starting point for the segment
   * @param {GridCoordinates3d} b                     Ending point for the segment
   * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
   * @returns {number} Distance in grid units.
   *  A segment wholly within a square may be 0 distance.
   *  Instead of mathematical shortcuts from center, actual grid squares are counted.
   *  Euclidean on a grid also uses grid squares, but measures using actual diagonal from center to center.
   */
  static measure(a, b) {
    // Convert each grid step into a distance value.
    // Sum the horizontal and vertical moves.
    const changeCount = this.sumGridMoves(a, b);
    let d = (changeCount.V + changeCount.H) * canvas.dimensions.distance;

    // Add diagonal distance based on varying diagonal rules.
    const diagAdder = this.#diagonalDistanceAdder();
    d += diagAdder(changeCount.D);
    return d;
  }

  /**
   * Construct a function used to add diagonal distance under alternating rules.
   * @returns {function}
   *  - @param {number} nDiag
   *  - @returns {number} Diagonal distance. Accounts for alternating rules.
   */
  static #diagonalDistanceAdder() {
    const distance = canvas.dimensions.distance;
    const diagonalMult = this.#diagonalDistanceMultiplier();
    const diagonalDist = distance * diagonalMult;
    const diagonalRule = canvas.grid.grid.diagonals;
    const D = CONST.GRID_DIAGONALS;
    switch ( diagonalRule ) {
      case D.ALTERNATING_1: {
        let totalDiag = 0;
        return nDiag => {
          const pastOdd = totalDiag % 2;
          const nEven = ~~(nDiag * 0.5) + pastOdd;
          totalDiag += nDiag;
          return (nDiag + nEven) * diagonalDist;
        };
      }

      case D.ALTERNATING_2: {
        let totalDiag = 0;
        return nDiag => {
          // Adjust if the past total puts us on an even square
          const pastOdd = totalDiag % 2;
          const nOdd = Math.ceil(nDiag * 0.5) - pastOdd;
          totalDiag += nDiag;
          return (nDiag + nOdd) * diagonalDist;
        };

      }
      default: return nDiag => nDiag * diagonalDist;
    }
  }

  /**
   * Determine what multiplier to use when handling diagonal grid movement.
   * @returns {number}
   */
  static #diagonalDistanceMultiplier() {
    if ( canvas.grid.isHexagonal || canvas.grid.isGridless ) return Math.SQRT2;
    const D = CONST.GRID_DIAGONALS;
    switch ( canvas.grid.grid.diagonals ) {
      case D.EQUIDISTANT: return 1;
      case D.EXACT: return Math.SQRT2;
      case D.APPROXIMATE: return 1.5;
      case D.RECTILINEAR: return 2;
      case D.ILLEGAL: return 2;  // Move horizontal + vertical for every diagonal
      default: return 1;
    }
  }

  /**
   * Count the number of horizontal, vertical, diagonal, elevation grid moves.
   * Adjusts vertical and diagonal for elevation.
   * @param {GridCoordinates3d} a                   Starting point for the segment
   * @param {GridCoordinates3d} b                   Ending point for the segment
   * @returns {object} Counts of changes: none, vertical, horizontal, diagonal, elevation
   */
  static sumGridMoves(a, b) {
    const pts = this.gridUnder3dLine(a, b);
    const totalChangeCount = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };
    let prevGridCoords = pts[0];
    const nPts = pts.length;
    for ( let i = 1; i < nPts; i += 1 ) {
      const currGridCoords = pts[i];
      const movementChange = this.gridChangeType3d(prevGridCoords, currGridCoords);
      Object.keys(totalChangeCount).forEach(key => totalChangeCount[key] += movementChange[key]);
    }
    return totalChangeCount;
  }

  /**
   * Type of change between two grid coordinates.
   * @param {number[2]} prevGridCoord
   * @param {number[2]} nextGridCoord
   * @returns {CHANGE}
   */
  static gridChangeType(prevGridCoord, nextGridCoord) {
    const xChange = (prevGridCoord.j !== nextGridCoord.j) || (prevGridCoord.x !== nextGridCoord.x);
    const yChange = (prevGridCoord.i !== nextGridCoord.i) || (prevGridCoord.y !== nextGridCoord.y);
    return CHANGE[((xChange * 2) + yChange)];
  }

  /**
   * Type of change between two 3d grid coordinates.
   * @param {number[2]} prevGridCoord
   * @param {number[2]} nextGridCoord
   * @returns {CHANGE}
   */
  static gridChangeType3d(prevGridCoord, nextGridCoord) {
    const zChange = (prevGridCoord.k !== nextGridCoord.k) || (prevGridCoord.z !== nextGridCoord.z);
    const res = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };
    res[this.gridChangeType(prevGridCoord, nextGridCoord)] = 1;
    if ( zChange ) res.E = 1;
    return res;
  }

  /**
   * Get the grid coordinates for a segment between origin and destination.
   * Supplies coordinates in 3 dimensions.
   * @param {GridCoordinates3d} origin        Origination point
   * @param {GridCoordinates3d} destination   Destination point
   * @returns {GridCoordinates3d[]} Array containing each grid point under the line.
   */
  static gridUnder3dLine(origin, destination) {
    // If no elevation change, return the 2d version.
    const originK = unitElevationFromCoordinates(origin);
    const destK = unitElevationFromCoordinates(destination);
    const elevSign = Math.sign(destK - originK);
    if ( !elevSign ) return this.gridUnder2dLine(origin, destination).map(pt => {
      pt.k = originK;
      return pt;
    });

    // Retrieve iterator for the 2d canvas points and the elevation representation from the projection.
    const pts2dIter = this.gridUnder2dLine(origin, destination).values();
    const projPtsIter = this.projectedGridUnder3dLine(origin, destination).values();

    // Link the pts to the projected point movement.
    // If vertical projection, increment elevation only.
    // If diagonal or horizontal, increment both elevation and grid step.
    // Flip horizontal/vertical for hex rows.
    const diagAllowed = canvas.grid.grid.diagonals !== CONST.GRID_DIAGONALS.ILLEGAL;
    const [elevOnlyMove, canvasOnlyMove] = isHexRow() ? ["H", "V"] : ["V", "H"];
    let prevProjPt = projPtsIter.next().value;
    let prevPt = pts2dIter.next().value;

    // Start by adding the origin point at the origin elevation.
    prevPt.k = originK;
    const resPts = [prevPt];

    const elevationOnlyStep = () => {
      prevPt = {...prevPt};
      prevPt.k += elevSign;
      resPts.push(prevPt);
    };

    const canvasStep = (elevStep = 0) => {
      const currPt2d = pts2dIter.next().value;
      if ( !currPt2d ) {
        if ( elevStep ) elevationOnlyStep();
        return false;
      }
      currPt2d.k = prevPt.k + elevStep;
      resPts.push(currPt2d);
      prevPt = currPt2d;
      return true;
    };

    const dualStep = diagAllowed
      ? () => canvasStep(elevSign)
      : () => {
        canvasStep(0);
        elevationOnlyStep();
      };

    // Cycle through each elevation change. If moving both elevation and 2d, or just 2d,
    // increment to the next 2d point. Otherwise add an interval point with the elevation-only change.
    for ( const nextProjPt of projPtsIter ) {
      const elevChangeType = this.gridChangeType(prevProjPt, nextProjPt);
      switch ( elevChangeType ) {
        case elevOnlyMove: elevationOnlyStep(); break;
        case canvasOnlyMove: canvasStep(0); break;
        case "NONE": console.warn("gridUnder3dLine|unexpected elevOnlyMoveType === NONE"); break;
        default: dualStep(); break;
      }
      prevProjPt = nextProjPt;
    }

    // Add in remaining 2d moves, if any.
    while ( canvasStep(0) ) { } // eslint-disable-line no-empty

    return resPts;
  }

  /*
   * Get the grid coordinates for a 3d segment projected to 2d.
   * Projected in a specific manner such that a straight line move represents elevation-only travel.
   * For hex rows, this is a horizontal move. For hex columns or squares, this is a vertical move.
   * @param {GridCoordinates} origin       Origination point
   * @param {GridCoordinates} destination  Destination point
   * @returns {GridCoordinates[]} Array containing each grid point under the line.
   */
  static projectedGridUnder3dLine(origin, destination) {
    // Determine the number of elevation steps.
    const cOrigin = getCenterPoint3d(origin);
    const cDest = getCenterPoint3d(destination);
    const zElev = cDest.z - cOrigin.z;

    // Projected distance.
    const dist2d = PIXI.Point.distanceBetween(cOrigin, cDest);
    const b = isHexRow()
      ? { x: cOrigin.x + zElev, y: cOrigin.y + dist2d }
      : { x: cOrigin.x + dist2d, y: cOrigin.y + zElev };
    return this.gridUnder2dLine(cOrigin, b);
  }

  /*
   * Get the grid coordinates for a segment between origin and destination.
   * @param {GridCoordinates} origin       Origination point
   * @param {GridCoordinates} destination  Destination point
   * @returns {GridCoordinates[]} Array containing each grid point under the line.
   *   For gridless, returns the GridCoordinates of the origin and destination.
   */
  static gridUnder2dLine(origin, destination) {
    return canvas.grid.getDirectPath([origin, destination]);
  }
}

// Store the flipped key/values. And lock the keys.
const CHANGE = MeasurePhysicalDistanceGridded.CHANGE;
Object.entries(CHANGE).forEach(([key, value]) => CHANGE[value] = key);
Object.freeze(CHANGE);

// ----- NOTE: Helper functions ----- //

/**
 * @returns {boolean} True if the grid is a row hex.
 */
function isHexRow() {
  return canvas.grid.type === CONST.GRID_TYPES.HEXODDR
    || canvas.grid.type === CONST.GRID_TYPES.HEXEVENR;
}
