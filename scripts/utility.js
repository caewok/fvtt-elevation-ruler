/* globals
canvas,
CONST,
game,
Ray
*/
"use strict";

import { log } from "./module.js";

/**
 * Convert elevation grid coordinate to elevation units
 * @param {number} e    elevation coordinate
 * @returns {number}
 */
export function elevationCoordinateToUnit(e) {
  const { size, distance } = canvas.dimensions;
  const gridMultiplier = distance / size;
  return e * gridMultiplier;
}

/**
 * Convert elevation unit to grid coordinate
 * @param {number} e    elevation unit
 * @returns {number}
 */
export function elevationUnitToCoordinate(e) {
  const { size, distance } = canvas.dimensions;
  const gridMultiplier = size / distance;
  return e * gridMultiplier;
}

/**
 * Measure the distance squared between two 2d points.
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
export function distance2dSquared(a, b) {
  return Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2);
}

/**
 * Test if two 2d points are nearly equal.
 * @param {Point} a
 * @param {Point} b
 * @param {number} epsilon    Error margin
 * @returns {boolean}
 */
function points2dAlmostEqual(a, b, epsilon = 1e-8) {
  return a.x.almostEqual(b.x, epsilon) && a.y.almostEqual(b.y, epsilon);
}

/*
 * Generator to iterate grid points under a line.
 * This version handles lines in 3d.
 *   It assumes elevation movement by the set grid distance.
 * @param {x: Number, y: Number, z: Number} origin Origination point
 * @param {x: Number, y: Number, z: Number} destination Destination point
 * @return Iterator, which in turn
 *   returns [row, col, elevation] for each grid point under the line.
 */
export function * iterateGridUnder3dLine(generator, origin, destination) {
  let prior_elevation = origin.z || 0;
  const end_elevation = destination.z || 0;
  const direction = prior_elevation <= end_elevation ? 1 : -1;
  const elevation_increment = canvas.scene.data.gridDistance * canvas.scene.data.grid;
  log(`elevation: ${prior_elevation}[prior], ${end_elevation}[end], ${direction}[direction], ${elevation_increment}[increment]`);
  let last_row;
  let last_col;

  for (const res of generator ) {
    // Step down in elevation if necessary
    log(res);
    const [row, col] = res;
    [last_row, last_col] = res;

    if ( prior_elevation !== end_elevation ) {
      const remainder = Math.abs(prior_elevation - end_elevation);
      const step_elevation = Math.min(remainder, elevation_increment);
      prior_elevation += step_elevation * direction;

    }
    yield [row, col, prior_elevation];
  }

  // More elevation? increment straight down.
  const MAX_ITERATIONS = 1000; // To avoid infinite loops
  let iteration = 0;
  while ( prior_elevation !== end_elevation && iteration < MAX_ITERATIONS ) {
    iteration += 1;
    const remainder = Math.abs(prior_elevation - end_elevation);
    const step_elevation = Math.min(remainder, elevation_increment);
    log(`elevation: ${prior_elevation}[prior], ${end_elevation}[end], ${step_elevation}[step]`);
    prior_elevation += step_elevation * direction;

    yield [last_row, last_col, prior_elevation];
  }
}

// Needed for libWrapper
export function iterateGridUnder3dLine_wrapper(wrapped, origin, destination) {
  log("iterateGrid origin, destination", origin, destination);
  return iterateGridUnder3dLine(wrapped(origin, destination), origin, destination);
}

/*
* Calculate a new point by projecting the elevated point back onto the 2-D surface
* If the movement on the plane is represented by moving from point A to point B,
*   and you also move 'height' distance orthogonal to the plane, the distance is the
*   hypotenuse of the triangle formed by A, B, and C, where C is orthogonal to B.
*   Project by rotating the vertical triangle 90º, then calculate the new point C.
* For gridded maps, project A such that A <-> projected_A is straight on the grid.
* @param {{x: number, y: number, z: number}} A
* @param {{x: number, y: number, z: number}} B
*/
export function projectElevatedPoint(A, B) {
  if ( points2dAlmostEqual(A, B) ) { return [{ x: A.x, y: A.y }, { x: B.x, y: B.y }]; }
  if ( typeof B.z === "undefined" || isNaN(B.z) ) { B.z = A.z; }
  if ( typeof A.z === "undefined" || isNaN(A.z) ) { A.z = B.z; }
  if ( A.z === B.z ) { return [{ x: A.x, y: A.y }, { x: B.x, y: B.y }]; }
  if ( A.z.almostEqual(B.z) ) { return [{ x: A.x, y: A.y }, { x: B.x, y: B.y }]; }

  switch ( canvas.grid.type ) {
    case CONST.GRID_TYPES.GRIDLESS: return projectGridless(A, B);
    case CONST.GRID_TYPES.SQUARE: return projectSquareGrid(A, B);
    case CONST.GRID_TYPES.HEXODDR:
    case CONST.GRID_TYPES.HEXEVENR: return projectEast(A, B);
    case CONST.GRID_TYPES.HEXODDQ:
    case CONST.GRID_TYPES.HEXEVENQ: return projectSouth(A, B);
  }

  // Catch-all
  return projectGridless(A, B);
}

/**
 * Project A and B in a square grid.
 * move A vertically or horizontally by the total height different
 * If the points are already on a line, don't change B.
 * So if B is to the west or east, set A to the south.
 * Otherwise, set A to the east and B to the south.
 * Represents the 90º rotation of the right triangle from height
 */
function projectSquareGrid(A, B) {
  // If the points are already on a line, don't change B.
  // Otherwise, set A to the east and B to the south
  // Represents the 90º rotation of the right triangle from height
  const height = Math.abs(A.z - B.z);
  let projected_A;
  let projected_B;

  if ( A.x.almostEqual(B.x) ) {
    // Points are on vertical line
    // Set A to the east
    // B is either north or south from A
    // (quicker than calling projectEast b/c no distance calc req'd)
    projected_A = {x: A.x + height, y: A.y}; // East
    projected_B = {x: B.x, y: B.y};
  } else if ( A.y.almostEqual(B.y) ) {
    // Points are on horizontal line
    // B is either west or east from A
    // Set A to the south
    // (quicker than calling projectSouth b/c no distance calc req'd)
    projected_A = {x: A.x, y: A.y + height}; // South
    projected_B = {x: B.x, y: B.y};
  } else {
    // Set B to point south, A pointing east
    [projected_A, projected_B] = projectEast(A, B, height);
  }

  log(`Projecting Square: A: (${A.x}, ${A.y}, ${A.z})->(${projected_A.x}, ${projected_A.y}); B: (${B.x}, ${B.y}, ${B.z})->(${projected_B.x}, ${projected_B.y})`);

  return [projected_A, projected_B];
}

function projectSouth(A, B, height, distance) {
  if ( typeof height === "undefined" ) height = A.z - B.z;
  if ( typeof distance === "undefined" ) distance = gridDistance(A, B);

  // Set A pointing south; B pointing west
  const projected_A = {x: A.x, y: A.y + height};
  const projected_B = {x: A.x - distance, y: A.y};

  log(`Projecting South: A: (${A.x}, ${A.y}, ${A.z})->(${projected_A.x}, ${projected_A.y}); B: (${B.x}, ${B.y}, ${B.z})->(${projected_B.x}, ${projected_B.y})`);

  return [projected_A, projected_B];
}

/*
 * Calculate the distance between two points in {x,y} dimensions.
 * @param {PIXI.Point} a   Point in {x, y} format.
 * @param {PIXI.Point} b   Point in {x, y} format.
 * @return The distance between the two points.
 */
function calculate2dDistance(a, b, epsilon = 1e-6) {
  // Could use pointsAlmostEqual function but this avoids double-calculating
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if ( dy < epsilon && dx < epsilon ) { return 0; }
  if ( dy < epsilon ) { return dx; }
  if ( dx < epsilon ) { return dy; }

  return Math.hypot(dy, dx);
}

function projectEast(A, B, height, distance) {
  if ( typeof height === "undefined" ) height = A.z - B.z;
  if ( typeof distance === "undefined" ) distance = gridDistance(A, B);

  // Set A pointing east; B pointing south
  const projected_A = {x: A.x + height, y: A.y};
  const projected_B = {x: A.x, y: A.y + distance};

  log(`Projecting East: A: (${A.x}, ${A.y}, ${A.z})->(${projected_A.x}, ${projected_A.y}); B: (${B.x}, ${B.y}, ${B.z})->(${projected_B.x}, ${projected_B.y})`);

  return [projected_A, projected_B];
}

function gridDistance(A, B) {
  const use_grid = canvas.grid.diagonalRule === "555"
    || canvas.grid.diagonalRule === "5105"
    || game.system.id === "pf2e";

  if ( use_grid ) {
    const distance_segments = [{ray: new Ray(A, B)}];
    const distances = canvas.grid.measureDistances(distance_segments, { gridSpaces: true });
    const sum = distances.reduce((acc, d) => acc + d, 0);
    return elevationUnitToCoordinate(sum); // Revert to pixel distance
  }

  return calculate2dDistance({x: A.x, y: A.y}, {x: B.x, y: B.y});
}


/**
 * Calculate a new point by projecting the elevated point back onto the 2-D surface
 * If the movement on the plane is represented by moving from point A to point B,
 *   and you also move 'height' distance orthogonal to the plane, the distance is the
 *   hypotenuse of the triangle formed by A, B, and C, where C is orthogonal to B.
 *   Project by rotating the vertical triangle 90º, then calculate the new point C.
 *
 * Cx = { height * (By - Ay) / dist(A to B) } + Bx
 * Cy = { height * (Bx - Ax) / dist(A to B) } + By
 * @param {{x: number, y: number}} A
 * @param {{x: number, y: number}} B
 */
export function projectGridless(A, B, height, distance) {
  if ( typeof height === "undefined" ) height = A.z - B.z;
  if ( typeof distance === "undefined" ) distance = calculate2dDistance({x: A.x, y: A.y}, {x: B.x, y: B.y});

  const projected_x = A.x + ((height / distance) * (B.y - A.y));
  const projected_y = A.y - ((height / distance) * (B.x - A.x));

  log(`Projecting Gridless: A: (${A.x}, ${A.y}, ${A.z})->(${projected_x}, ${projected_y}); B: (${B.x}, ${B.y}, ${B.z})->(${B.x}, ${B.y})`);

  return [{ x: projected_x, y: projected_y }, { x: B.x, y: B.y }];
}

/**
 * Calculate the distance between two points in {x,y,z} dimensions.
 * @param {PIXI.Point} A   Point in {x, y, z} format.
 * @param {PIXI.Point} B   Point in {x, y, z} format.
 * @return The distance between the two points.
 */
export function calculate3dDistance(wrapped, A, B, epsilon = 1e-6) {
  if ( typeof A.z === "undefined" ) A.z = 0;
  if ( typeof B.z === "undefined" ) B.z = 0;

  const dz = Math.abs(B.z - A.z);
  if ( dz < epsilon ) return wrapped(A, B, epsilon);

  const dy = Math.abs(B.y - A.y);
  if ( dy < epsilon ) return wrapped({x: A.x, y: A.z}, {x: B.x, y: B.z}, epsilon);

  const dx = Math.abs(B.x - A.x);
  if ( dx < epsilon ) return wrapped({x: A.z, y: A.y}, {x: B.z, y: B.y}, epsilon);

  return Math.hypot(dz, dy, dx);
}


/**
 * Test if two points are almost equal, given a small error window.
 * @param {PIXI.Point} p1  Point in {x, y, z} format. z optional
 * @param {PIXI.Point} p2  Point in {x, y, z} format.
 * @return {Boolean} True if the points are within the error of each other
 */
export function points3dAlmostEqual(wrapped, p1, p2, epsilon = 1e-6) {
  const equal2d = wrapped(p1, p2, epsilon);
  if ( !equal2d ) return false;

  if ( typeof p1.z === "undefined"
    || typeof p2.z === "undefined"
    || p1.z.isNaN()
    || p2.z.isNaN() ) return true;

  return p1.z.almostEqual(p2.z, epsilon);
}
