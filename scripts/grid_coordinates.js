/* globals
canvas,
CONFIG,
CONST,
Drawing,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Helper functions to handle GridCoordinates and v11 alternatives.

/**
 * Get the top left point on the grid for a given set of coordinates.
 * @param {GridCoordinates} coords    Grid (i,j) offset or x,y coordinates
 * @returns {Point}
 */
function getTopLeftPoint(coords) {
  if ( isNewerVersion(game.version, 12) ) return canvas.grid.grid.getTopLeftPoint(coords);
  if ( Object.hasOwn(coords, "i") ) {
    return canvas.grid.grid.getPixelsFromGridPosition(coords.i, coords.j);
  }
  return canvas.grid.grid.getTopLeft(coords.x, coords.y);
}


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
  const { x, y } = canvas.grid.grid.getTopLeftPoint(coords);
  const { sizeX, sizeY } = canvas.grid;
  return new PIXI.Rectangle(x, y, sizeX, sizeY);
}

/**
 * Return a polygon for a given grid hex.
 * @param {GridCoordinates} coords      Grid (i,j) offset or x,y coordinates
 * @returns {PIXI.Polygon}
 */
export function hexGridShape(coords) {
  return new PIXI.Polygon(...canvas.grid.grid.getVertices(coords));
}


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
 * Get the center point for a given GridCoordinates3d
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {Point3d} The center point
 */
export function getCenterPoint3d(coords) {
  const center = Point3d.fromObject(canvas.grid.getCenterPoint(coords));
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
  const z  = canvasElevationFromCoordinates(coords);
  if ( Object.hasOwn(coords, "i") ) {
    const pt = canvas.grid.getCenterPoint(coords);
    return new Point3d(pt.x, pt.y, z);
  }
  const pt = Point3d.fromObject(coords);
  pt.z = z;
  return pt;
}

/**
 * Calculate the canvas elevation for a given set of coordinates.
 * @param {GridCoordinates3d} coords    The coordinates
 * @returns {number} Elevation in canvas pixel units.
 */
export function canvasElevationFromCoordinates(coords) {
  return CONFIG.GeometryLib.utils.gridUnitsToPixels(gridElevationFromCoordinates(coords));
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