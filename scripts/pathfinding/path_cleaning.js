/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { PixelCache } from "../geometry/PixelCache.js";

// Assortment of functions used to clean generated paths.
// Straighten, snap-to-grid, fog test.

/**
 * Clean a set of grid path points by dropping intermediate points in the same direction.
 * So if moving diagonally NE, drop all points until direction changes.
 * @param {PIXI.Point[]} pathPoints
 * @returns {PIXI.Point[]}
 */
export function cleanGridPathPoints(pathPoints) {
  if ( pathPoints.length < 3 ) return pathPoints;
  let a = pathPoints[0];
  let b = pathPoints[1];
  const cleanedPts = [a];
  for ( let i = 2, n = pathPoints.length - 1; i < n; i += 1 ) {
    const c = pathPoints[i];
    const abDir = { x: b.x - a.x, y: b.y - a.y };
    const cbDir = { x: c.x - b.x, y: c.y - b.y};
    if ( !(abDir.x.almostEqual(cbDir.x) && abDir.y.almostEqual(cbDir.y)) ) cleanedPts.push(b);
    a = b;
    b = c;
  }
  cleanedPts.push(pathPoints.at(-1));
  return cleanedPts;
}

/**
 * Align the path to the grid.
 * Will only align path to the extent it does not collide with a wall.
 * @param {PIXI.Point[]} pathPoints
 * @returns {PIXI.Point[]}
 */
export function alignPathToGrid(pathPoints, token) {
  if ( pathPoints.length < 2 ) return pathPoints;

  // For each segment, retrieve the grid points that do not result in collisions.
  let gridPoints = new Array(pathPoints.length - 1);
  for ( let i = 0, n = pathPoints.length - 1; i < n; i += 1 ) {
    gridPoints[i] = alignSegmentToGrid(pathPoints[i], pathPoints[i + 1], token);
  }

  // Check dropping the connections between segments.
  const finalPoints = cleanSegmentGridConnections(gridPoints, token);

  // Deduplicate the remaining points, combining into single array.
  let prev = finalPoints[0];
  const deDupedPoints = [prev];
  for ( let i = 1, iMax = finalPoints.length; i < iMax; i += 1 ) {
    const potentialPt = finalPoints[i];
    if ( prev.almostEqual(potentialPt) ) continue;
    deDupedPoints.push(potentialPt);
    prev = potentialPt;
  }
  return deDupedPoints;
}

/**
 * Shorten connections between segments.
 * Grid points are [gridPt0,... gridPt1, a].
 * Next grid points are [a, gridPt0, ... gridPt1]
 * Connect the b's, dropping all duplicates and converting to grid centers unless collision is found.
 * @param {PIXI.Point[][]} gridPoints
 * @returns {PIXI.Point[]}
 */
export function cleanSegmentGridConnections(gridPoints, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;

  // Drop empty arrays.
  gridPoints = gridPoints.filter(arr => arr.length);

  // Store the final array of combined points.
  const finalPoints = gridPoints[0];

  // Compare two of the point arrays and attempt to combine.
  for ( let i = 1, n = gridPoints.length; i < n; i += 1 ) {
    const nextPts = gridPoints[i];

    // Examine 3 points into the segment at the linked ends.
    let a0 = finalPoints.at(-1);
    let b0 = finalPoints.at(-2); // 1, -2 may be undefined.
    let a1 = nextPts.at(0);
    let b1 = nextPts.at(1);

    // If a0 and a1 are equal, can remove a0.
    if ( !a0.x.almostEqual(a1.x) || !a0.y.almostEqual(a1.y) ) {
      // At this point, [...b0, a0], [a1, b1, ...].
      // Attempt to center each in turn.
      const a0c = a0.center;
      const a1c = a1.center;
      if ( !(sceneGraph.hasCollision(b0, a0c, a1) || sceneGraph.hasCollision(b0, a0, a1)) ) a0 = a0c;
      if ( !sceneGraph.hasCollision(a0, a1c, b1) ) a1 = a1c;
      if ( !a0.x.almostEqual(a1.x) || !a0.y.almostEqual(a1.y) ) {
        finalPoints.push(...nextPts);
        continue;
      }
    }
    finalPoints.pop(); // Remove a0.

    // If no collision between the next two points, can remove a1.
    if ( !b0 || !b1 || sceneGraph.hasCollision(b0, b1, token) ) {
      finalPoints.push(...nextPts);
      continue;
    }
    nextPts.shift(); // Remove a1.

    if ( !b0.x.almostEqual(b1.x) || !b0.y.almostEqual(b1.y) ) {
      // At this point, b0 --> b1.
      // Attempt to center each in turn.
      const b0c = b0.center;
      const b1c = b1.center;
      const prevPt = finalPoints.at(-2); // Points a0, a1 already removed, so [...prevPt, b0], [b1, nextPt,...]
      const nextPt = nextPts.at(1);
      if ( !(sceneGraph.hasCollision(prevPt, b0c, b1c) || sceneGraph.hasCollision(prevPt, b0c, b1)) ) b0 = b0c;
      if ( !sceneGraph.hasCollision(b0, b1c, nextPt) ) b1 = b1c;
      if ( !b0.x.almostEqual(b1.x) || !b0.y.almostEqual(b1.y) ) {
        finalPoints.push(...nextPts);
        continue;
      }
    }
    finalPoints.pop(); // Remove b0.
    finalPoints.push(...nextPts);
  }
  return finalPoints;
}


/**
 * Align a single segment of a path to the grid.
 * Keeps the a and b endpoints.
 */
export function alignSegmentToGrid(a, b, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  if ( sceneGraph.hasCollision(a, b, token) ) return [a, b];

  const gridPoints = canvas.grid.getDirectPath([a, b]);
  const allPoints = [
    GridCoordinates3d.fromObject(a),
    ...gridPoints.map(offset => GridCoordinates3d.fromOffset(offset)), GridCoordinates3d.fromObject(b)];
  const nPts = allPoints.length;
  if ( nPts < 3 ) return allPoints;

  // To maximize grid spaces, move from outside in at both ends of the segment.
  // Adjust points at either end, and walk to middle.
  // Test if a --> b has collision. If so, change a to the line.
  for ( let i = 1, j = nPts - 2; i <= j; i += 1, j -= 1 ) {
    const a0 = allPoints[i - 1];
    const a1 = allPoints[i];
    const a2 = allPoints[i + 1];
    if ( sceneGraph.hasCollision(a0, a1, token)
      || sceneGraph.hasCollision(a1, a2, token) ) {
      allPoints[i] = GridCoordinates3d.fromObject(foundry.utils.closestPointToSegment(a1, a, b));
    }

    if ( i === j ) break;
    const b0 = allPoints[j + 1];
    const b1 = allPoints[j];
    const b2 = allPoints[j - 1];
    if ( sceneGraph.hasCollision(b0, b1, token)
      || sceneGraph.hasCollision(b1, b2, token) ) {
      allPoints[j] = GridCoordinates3d.fromObject(foundry.utils.closestPointToSegment(b1, a, b));
    }
  }

  // For any non-centered points, check if we can move to an adjacent grid square. (Skip start and end.)
  for ( let i = 1, n = nPts - 2; i < n; i += 1 ) {
    const a1 = allPoints[i];
    const center = a1.center;
    if ( a1.almostEqual(center) ) continue;

    const a0 = allPoints[i - 1];
    const a2 = allPoints[i + 1];
    if ( sceneGraph.hasCollision(a0, center, token) || sceneGraph.hasCollision(a2, center, token) ) continue;
    allPoints[i] = center;
  }
  return allPoints;
}

/**
 * Reverse Ramer–Douglas–Peucker algorithm to straighten points.
 * Take start and end points. If no collisions, drop all points in between and end.
 * Find farthest point.
 *   a. start --> farthest. If no collisions, drop all points in between and break
 *   b. farthest --> end. If no collisions, drop all points in between and break
 * If (a), call again, finding farthest point between start --> old farthest.
 * If (b), call again, finding farthest point between old farthest --> end
 * If enabled, collisions include terrain collisions.
 * If start and end are the same or no points between, end.
 * @param {PIXI.Point[]} pathPoints
 * @param {Token} token               Move token, used when testing for some collisions
 * @returns {PIXI.Point[]}
 */
export function straightenPath(pathPoints, token, _depth = 0) {
  if ( pathPoints.length < 3 ) return pathPoints;

  if ( _depth > 1000 ) {
    console.warn("cleanGridPathRDP exceeded depth max", { pathPoints, token });
    return pathPoints;
  }

  // Test for collision between first and last points.
  const a = pathPoints.at(0);
  const b = pathPoints.at(-1);
  if ( !CONFIG[MODULE_ID].sceneGraph.hasCollision(a, b, token) ) return [a, b];

  // Locate the index of the farthest point from segment a|b.
  let farthestIndex = 0;
  let maxDist2 = -1;
  const nInterior = pathPoints.length - 2;
  for ( let i = 1; i < nInterior; i += 1 ) {
    const dist2 = distanceSquaredToSegment(a, b, pathPoints[i]);
    if ( dist2 > maxDist2 ) {
      maxDist2 = dist2;
      farthestIndex = i;
    }
  }
  // Adjust index by one to account for interior.
  farthestIndex += 1;

  // Test the two halves: a|farthest, farthest|b. Remember to not duplicate farthest when combining.
  const firstHalf = straightenPath(pathPoints.slice(0, farthestIndex + 1), token, _depth += 1);
  const secondHalf = straightenPath(pathPoints.slice(farthestIndex), token, _depth += 1);
  return [...firstHalf, ...secondHalf.slice(1)];
}

/**
 * Distance squared from point to a segment a|b.
 * If point is between a and b, this is the perpendicular distance squared.
 * Otherwise, it is the distance squared to the closer of a or b.
 * @param {Point} a
 * @param {Point} b
 * @param {Point} pt
 * @returns {number}
 */
function distanceSquaredToSegment(a, b, pt) {
  const closestPt = foundry.utils.closestPointToSegment(pt, a, b);
  return PIXI.Point.distanceSquaredBetween(pt, closestPt);
}

/**
 * Function factory to provide a means to test if a given canvas location is explored or unexplored.
 * Dependent on the scene having a fog exploration for that user.
 * Because fog will change over time, this should be called each time a new path is requested.
 * @returns {function} Function that checks whether a canvas position is explored
 *   - @param {number} x
 *   - @param {number} y
 *   - @returns {boolean}  True if explored, false if unexplored. If no fog, always true.
 */
export function fogIsExplored() {
  const tex = canvas.fog.exploration?.getTexture();
  if ( !tex || !tex.valid ) return undefined;

  const { width } = canvas.visibility.textureConfiguration;
  const pixelRes = PixelCache.extractPixelsFromTexture(tex);
  let pixels = PixelCache.extractPixelChannel(pixelRes.pixels, 0, 4);
  const cache = PixelCache.fromPixelArray(pixels, width);

  // TODO: Do we need to translate the fog for the scene or does it cover the entire canvas?
  return (x, y) => cache.pixelAtCanvas(x, y) > 128;
}
