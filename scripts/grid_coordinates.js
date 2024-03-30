/* globals
canvas,
CONFIG,
CONST,
game,
isNewerVersion,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Helper functions to handle GridCoordinates and v11 alternatives.

import { Point3d } from "./geometry/3d/Point3d.js";
import { iterateGridUnderLine } from "./util.js";
import { GRID_DIAGONALS } from "./const.js";

// ----- NOTE: Conversion functions to handle v11 and v12 ----- //

/**
 * Get the grid (i,j) coordinates for a given point.
 * @param {GridCoordinates} coords    Grid (i,j) offset or x,y coordinates
 * @returns {i, j}
 */
function getGridPosition(coords) {
  if ( Object.hasOwn(coords, "i") ) return coords;
  return arrayToCoordsIJ(canvas.grid.grid.getGridPositionFromPixels(coords.x, coords.y));
}

function arrayToCoordsXY(arr) { return { x: arr[0], y: arr[1] }; }

function arrayToCoordsIJ(arr) { return { i: arr[0], j: arr[1] }; }

/**
 * Get the top left point on the grid for a given set of coordinates.
 * @param {GridCoordinates} coords    Grid (i,j) offset or x,y coordinates
 * @returns {Point}
 */
export function getTopLeftPoint(coords) {
  if ( isNewerVersion(game.version, 12) ) return canvas.grid.grid.getTopLeftPoint(coords);

  const arr = Object.hasOwn(coords, "i")
    ? canvas.grid.grid.getPixelsFromGridPosition(coords.i, coords.j)
    : canvas.grid.grid.getTopLeft(coords.x, coords.y);
  return arrayToCoordsXY(arr);
}

/**
 * Get the center point on the grid for a given set of coordinates.
 * @param {GridCoordinates} coords    Grid (i,j) offset or x,y coordinates
 * @returns {Point}
 */
export function getCenterPoint(coords) {
  if ( isNewerVersion(game.version, 12) ) return canvas.grid.grid.getCenterPoint(coords);

  if ( Object.hasOwn(coords, "i") ) coords = getTopLeftPoint(coords);
  const arr = canvas.grid.grid.getCenter(coords.x, coords.y);
  return arrayToCoordsXY(arr);
}

/**
 * Get the grid coordinates between two points. Uses Bresenham's algorithm.
 * @param {GridCoordinates} startCoords    Grid (i,j) offset or x,y coordinates
 * @param {GridCoordinates} endCoords    Grid (i,j) offset or x,y coordinates
 * @returns {GridCoordinates[]} An array of [i,j] coordinates
 */
export function getDirectPath(startCoords, endCoords) {
  if ( isNewerVersion(game.version, 12) ) return canvas.grid.grid.getDirectPath([startCoords, endCoords]);

  // Closest parallel to v12 getDirectPath is probably iterateGridUnderLine.
  startCoords = Object.hasOwn(startCoords, "i") ? getCenterPoint(startCoords) : startCoords;
  endCoords = Object.hasOwn(endCoords, "i") ? getCenterPoint(endCoords) : endCoords;
  const offsets = [...iterateGridUnderLine(startCoords, endCoords)];
  return offsets.map(o => arrayToCoordsIJ(o));
}

// ----- NOTE: Grid diagonals ----- //

/**
 * Retrieve the current diagonal rule.
 * @returns {GRID_DIAGONALS}
 */
export function diagonalRule() {
  if ( isNewerVersion(game.version, 12) ) return canvas.grid.grid.diagonals;

  switch ( canvas.grid.diagonalRule ) {
    case "555": return GRID_DIAGONALS.EQUIDISTANT;
    case "5105": return GRID_DIAGONALS.ALTERNATING_1;
    case "EUCL": return GRID_DIAGONALS.EXACT;
    case "MANHATTAN": return GRID_DIAGONALS.RECTILINEAR;
    default: return GRID_DIAGONALS.APPROXIMATE;
  }
}


// ----- NOTE: Grid shape ----- //

/**
 * Helper to get the grid shape for given grid type.
 * @param {GridCoordinates} coords    Grid (i,j) offset or x,y coordinates
 * @returns {null|PIXI.Rectangle|PIXI.Polygon}
 */
export function gridShape(coords) {
  const { GRIDLESS, SQUARE } = CONST.GRID_TYPES;
  switch ( canvas.grid.type ) {
    case GRIDLESS: return null;
    case SQUARE: return squareGridShape(coords);
    default: return hexGridShape(coords);
  }
}

/**
 * Return a rectangle for a given grid square.
 * @param {GridCoordinates} coords      Grid (i,j) offset or x,y coordinates
 * @returns {PIXI.Rectangle}
 */
export function squareGridShape(coords) {
  const { x, y } = getTopLeftPoint(coords);
  const sizeX = canvas.grid.sizeX || canvas.grid.size; // V12 || v11
  const sizeY = canvas.grid.sizeY || canvas.grid.size; // V12 || v11
  return new PIXI.Rectangle(x, y, sizeX, sizeY);
}

/**
 * Return a polygon for a given grid hex.
 * @param {GridCoordinates} coords      Grid (i,j) offset or x,y coordinates
 * @returns {PIXI.Polygon}
 */
export function hexGridShape(coords) {
  if ( isNewerVersion(game.version, 12) ) return new PIXI.Polygon(...canvas.grid.grid.getVertices(coords));
  const { x, y } = getTopLeftPoint(coords);
  const points = canvas.grid.grid.getBorderPolygon(1, 1, 0); // Width = 1, height = 1
  const pointsTranslated = [];
  const ln = points.length;
  for ( let i = 0; i < ln; i += 2) pointsTranslated.push(points[i] + x, points[i+1] + y);
  return new PIXI.Polygon(pointsTranslated);
}

// ----- NOTE: GridCoordinates3d ----- //

/**
 * Row, column, elevation coordinates of a grid space. Follows from GridOffset
 * The vertical assumes the grid cubes are stacked upon one another.
 * @typedef {object} GridOffset3d
 * @property {number} i     The row coordinate
 * @property {number} j     The column coordinate
 * @property {number} k     The elevation, where 0 is at the scene elevation, negative is below the scene.
 *   k * canvas.scene.dimensions.distance === elevation in grid units.
 */


/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset3d|Point3d} GridCoordinates3d
 */

/**
 * Get the grid (i,j, k) coordinates for a given point.
 * @param {GridCoordinates3d} coords    Grid (i,j,k) offset or x,y,z coordinates
 * @returns {i, j}
 */
export function getGridPosition3d(coords) {
  const out = getGridPosition(coords);
  out.k = unitElevationFromCoordinates(coords);
  return out;
}

/**
 * Get the center point for a given GridCoordinates3d
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {Point3d} The center point
 */
export function getCenterPoint3d(coords) {
  const center = Point3d.fromObject(getCenterPoint(coords));
  center.z = canvasElevationFromCoordinates(coords);
  return center;
}

/**
 * Get a point from grid coordinates.
 * @param {GridCoordinates3d} coords
 * @returns {Point3d}
 *   - If i,j,k present, returns the center point
 *   - Otherwise returns the point at x,y,z
 */
export function pointFromGridCoordinates(coords) {
  const z = canvasElevationFromCoordinates(coords);
  coords = Object.hasOwn(coords, "i") ? getCenterPoint(coords) : coords;
  return new Point3d(coords.x, coords.y, z);
}

/**
 * Calculate the canvas elevation for a given set of coordinates.
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {number} Elevation in canvas pixel units.
 */
export function canvasElevationFromCoordinates(coords) {
  return CONFIG.GeometryLib.utils.gridUnitsToPixels(gridElevationFromCoordinates(coords)) || 0;
}

/**
 * Calculate the grid elevation for a given set of coordinates.
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {number} Elevation in grid units.
 */
export function gridElevationFromCoordinates(coords) {
  const k = coords.k;
  if ( typeof k === "undefined" ) return CONFIG.GeometryLib.utils.pixelsToGridUnits(coords.z) || 0;
  return k * canvas.scene.dimensions.distance;
}

/**
 * Calculate the unit elevation for a given set of coordinates.
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {number} Elevation in number of grid steps.
 */
export function unitElevationFromCoordinates(coords) {
  const k = coords.k;
  if ( typeof k !== "undefined" ) return k;
  const z = coords.z;
  if ( typeof z === "undefined" ) return 0;
  return Math.round(CONFIG.GeometryLib.utils.pixelsToGridUnits(z) / canvas.scene.dimensions.distance);
}
