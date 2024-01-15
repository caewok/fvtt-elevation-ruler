/* globals
canvas,
PolygonEdge,
PIXI
*/
"use strict";

// Functions related to creating random shapes, for testing and benchmarking

export function randomUniform(min = 0, max = 1) {
  let num = Math.random();
  num *= max - min; // Stretch to fill range
  num += min; // Offset to min
  return num;
}

/**
 * Normal distribution of random numbers
 * https://stackoverflow.com/questions/25582882/javascript-math-random-normal-distribution-gaussian-bell-curve
 * @param {Number}  min   Minimum value
 * @param {Number}  max   Maximum value
 * @param {Number}  skew  Skew the peak left (skew > 1) or right (skew < 1). Should be greater than 0.
 * @return {Number}   Normally distributed random number between min and max
 *
 * @example
 * Array.fromRange(1000).map(() => randNormal())
 */
export function randomNormal(min = 0, max = 1, skew = 1) {
  let num = (rand_bm() / 10.0) + 0.5; // Translate to (0, 1)
  while ( num > 1 || num < 0 ) {
    num = (rand_bm() / 10.0) + 0.5; // Resample if more than 3.6 SD away ( < 0.02% chance )
  }
  num = Math.pow(num, skew); // Skew
  num *= max - min; // Stretch to fill range
  num += min; // Offset to min

  return num;
}

/**
 * Helper that creates a normally distributed number using Box-Muller.
 */
function rand_bm() {
  let u = 0;
  let v = 0;
  while ( u === 0 ) u = Math.random(); // Converting [0,1) to (0,1)
  while ( v === 0 ) v = Math.random();
  return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
}

/**
 * Construct a random point with integer coordinates between 0 and max_coord.
 * @param {Number}  max_x   Maximum x-coordinate value.
 * @param {Number}  max_y   Maximum y-coordinate value.
 * @return {Point}  Constructed random point.
 */
export function randomPoint(max_x = canvas.dimensions.width, max_y = canvas.dimensions.height) {
  return { x: Math.floor(Math.random() * max_x),
           y: Math.floor(Math.random() * max_y) }; // eslint-disable-line indent
}


/**
 * Test if two points are nearly equal.
 * @param {Point} p1
 * @param {Point} p2
 * @return {Boolean} True if equal or within a small epsilon of equality.
 */
export function pointsEqual(p1, p2) { return (p1.x.almostEqual(p2.x) && p1.y.almostEqual(p2.y)); }

/**
 * Construct a random segment. Will check that the segment has distance greater than 0.
 * @param {Number}  max_x   Maximum x-coordinate value.
 * @param {Number}  max_y   Maximum y-coordinate value.
 * @return {PolygonEdge}  Constructed random segment.
 */
export function randomSegment(max_x = canvas.dimensions.width, max_y = canvas.dimensions.height) {
  let a = randomPoint(max_x, max_y);
  let b = randomPoint(max_x, max_y);
  while (pointsEqual(a, b)) {
    // Don't create lines of zero length
    a = randomPoint(max_x, max_y);
    b = randomPoint(max_x, max_y);
  }
  return new PolygonEdge(a, b);
}


/**
 * Construct a rectangle at a random origin with normally distributed width, height.
 * @param {Point}   origin    Random if not defined. Left corner x,y
 * @param {Number}  minWidth  Minimum width.
 * @param {Number}  maxWidth  Maximum width.
 * @param {Number}  minHeight Minimum height.
 * @param {Number}  maxHeight Maximum height.
 * @return {PIXI.Rectangle}
 */
export function randomRectangle({
  origin = randomPoint(),
  minWidth = 100,
  maxWidth = minWidth * 2,
  minHeight = minWidth,
  maxHeight = minWidth * 2 } = {}) {

  // Safety dance!
  if ( minWidth <= 0 ) { minWidth = 1; }
  if ( maxWidth <= 0 ) { maxWidth = minWidth * 2; }
  if ( minHeight <= 0 ) { minHeight = 1; }
  if ( maxHeight <= 0 ) { maxHeight = minHeight * 2; }

  const width = randomNormal(minWidth, maxWidth);
  const height = randomNormal(minHeight, maxHeight);
  return new PIXI.Rectangle(origin.x, origin.y, width, height);
}
