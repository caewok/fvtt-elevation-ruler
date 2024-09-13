/* globals
canvas,
CONFIG,
CONST,
game,
PIXI
*/
"use strict";

import { SPEED } from "./const.js";
import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { gridShape } from "./util.js";
import { MovePenalty } from "./measurement/MovePenalty.js";
import { GridCoordinates3d } from "./geometry/3d/GridCoordinates3d.js";

// Functions used to determine token speed colors.

/**
 * Provides a function to track movement speed for a given group of segments.
 * The returned function assumes each segment will be passed in order.
 * @param {Ruler} ruler   Reference to the ruler
 * @param {Token} token   Movement token
 * @returns {function} Call this function to get the colors for this segment
 *   - @param {RulerMeasurementSegment} segment     The next segment for the token move
 *   - @returns {RulerMeasurementSegment[]} The split segments, with colors identified for each
 */
export function tokenSpeedSegmentSplitter(ruler, token) {
  const defaultColor = ruler.color;

  // Other constants
  const gridless = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;

  // Variables changed in the loop
  let totalCombatMoveDistance = 0;
  let minDistance = 0;
  let numPrevDiagonal = game.combat?.started ? (token?._combatMoveData?.numDiagonal ?? 0) : 0;

  // Precalculate the token speed.
  // We need the speed without the terrains. Use the MovePenalty to determine.
  const mp = ruler._movePenaltyInstance ??= new MovePenalty(token);
  const tokenSpeed = mp._tokenCloneSpeed; // SPEED.tokenSpeed(token);

  // Progress through each speed attribute in turn.
  const categoryIter = [...SPEED.CATEGORIES].values();
  let speedCategory = categoryIter.next().value;
  let maxDistance = SPEED.maximumCategoryDistance(token, speedCategory, tokenSpeed);

  return segment => {
    if ( !tokenSpeed ) {
      segment.speed = defaultColor;
      const a = GridCoordinates3d.fromObject(segment.ray.A);
      const b = GridCoordinates3d.fromObject(segment.ray.B);
      numPrevDiagonal += GridCoordinates3d.numDiagonal(a, b);
      return [segment];
    }

    const processed = [];
    const unprocessed = [segment];
    while ( (segment = unprocessed.pop()) ) {
      // Skip speed categories that do not provide a distance larger than the last.
      while ( speedCategory && maxDistance <= minDistance ) {
        speedCategory = categoryIter.next().value;
        maxDistance = SPEED.maximumCategoryDistance(token, speedCategory, tokenSpeed);
      }
      if ( !speedCategory ) speedCategory = SPEED.CATEGORIES.at(-1);
      segment.speed = speedCategory;

      // If we have exceeded maxDistance, determine if a split is required.
      const newDistance = totalCombatMoveDistance + segment.cost;
      if ( newDistance > maxDistance || newDistance.almostEqual(maxDistance ) ) {
        if ( newDistance > maxDistance ) {
          // Split the segment, inserting the latter portion in the queue for future iteration.
          const splitDistance = maxDistance - totalCombatMoveDistance;
          const breakpoint = locateSegmentBreakpoint(segment, splitDistance, { mp, token, gridless, numPrevDiagonal });
          if ( breakpoint ) {
            if ( breakpoint.almostEqual(segment.ray.A) ) {
              // Switch to next category.
              minDistance = maxDistance;
              unprocessed.push(segment);
              continue;
            } else if ( breakpoint.almostEqual(segment.ray.B) ) {
              // Do nothing.
            } else {
              // Split the segment
              const segments = _splitSegmentAt(segment, breakpoint, mp, numPrevDiagonal);
              unprocessed.push(segments[1]);
              segment = segments[0];
            }
          }
        }

        // Increment to the next speed category.
        // Next category will be selected in the while loop above: first category to exceed minDistance.
        minDistance = maxDistance;
      }

      // Increment totals.
      processed.push(segment);
      totalCombatMoveDistance += segment.cost;
      const a = GridCoordinates3d.fromObject(segment.ray.A);
      const b = GridCoordinates3d.fromObject(segment.ray.B);
      numPrevDiagonal += GridCoordinates3d.numDiagonal(a, b);
    }
    return processed;
  };
}

/**
 * Determine the specific point at which to cut a ruler segment such that the first subsegment
 * measures a specific incremental move distance.
 * @param {RulerMeasurementSegment} segment       Segment, with ray property, to split
 * @param {number} incrementalMoveDistance        Distance, in grid units, of the desired first subsegment move distance
 * @param {Token} token                           Token to use when measuring move distance
 * @returns {Point3d|null}
 *   If the incrementalMoveDistance is less than 0, returns null.
 *   If the incrementalMoveDistance is greater than segment move distance, returns null
 *   Otherwise returns the point at which to break the segment.
 */
function locateSegmentBreakpoint(segment, splitMoveDistance, { mp, gridless, numPrevDiagonal } = {}) {
  if ( splitMoveDistance <= 0 ) return null;
  if ( !segment.cost || splitMoveDistance > segment.cost ) return null;

  // Attempt to move the split distance and determine the split location.
  const { A, B } = segment.ray;
  let breakpoint = targetSplitForSegment(splitMoveDistance, A, B, mp, numPrevDiagonal);
  if ( !gridless ) {
    // We can get the end grid.
    // Use halfway between the intersection points for this grid shape.
    const halfIx = segmentGridHalfIntersection(breakpoint, A, B) ?? A;
    breakpoint = GridCoordinates3d.fromObject(halfIx);
    if ( breakpoint.equals(A) ) breakpoint.z = A.z;
    else if ( breakpoint.equals(B) ) breakpoint.z = B.z;
    else {
      // For gridded, we want the unit elevation along the segment.
      // This creates "steps", where as we move from A to B we step in unit elevations.
      const t = Point3d.distanceBetween(A, breakpoint) / Point3d.distanceBetween(A, B);
      breakpoint.z = A.z + ((B.z - A.z) * t);
      const elevation = GridCoordinates3d.elevationForUnit(breakpoint.k);
      const z = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);
      if ( z.between(A.z, B.z) ) breakpoint.z = z;
    }
  }
  return breakpoint;
}

/**
 * For a given segment and target cost, determine the best split for the segment
 * @param {number} targetCost
 * @param {Point3d} a
 * @param {Point3d} b
 * @param {number} [numPrevDiagonal=0]
 */
function targetSplitForSegment(targetCost, a, b, mp, numPrevDiagonal = 0) {
  // Assume linear cost increment.
  // So divide move in half each time.
  if ( splitCost(a, b, mp, 0, numPrevDiagonal) > targetCost ) return a;
  const totalDist = Point3d.distanceBetween(a, b);
  if ( splitCost(a, b, mp, totalDist, numPrevDiagonal) <= targetCost ) return b;

  // Now increment distance until we exceed the target cost.
  // Take 1/2 steps. So if the distance is nearly at the end, we would go 1/2 + 1/4 + 1/8...
  // Use pixel (integer) steps so the points are at integer bounds.
  const MAX_ITER = 100;
  let bestDist = 0;
  let step = Math.floor(totalDist);
  let iter = 0;
  while ( step > 1 && iter < MAX_ITER) {
    iter += 1;
    step = Math.floor(step * 0.5);
    const testDist = bestDist + step;
    if ( splitCost(a, b, mp, testDist, numPrevDiagonal) <= targetCost ) bestDist = testDist;
  }
  return a.towardsPoint(b, bestDist).roundDecimals();
}

/**
 * For a given segment, step distance, and target cost, determine if  the target cost is exceeded or not.
 * @param {number} targetCost
 * @param {Point3d} a
 * @param {Point3d} b
 * @param {number} [t0=1]
 * @param {number} [numPrevDiagonal=0]
 */
function splitCost(a, b, mp, stepDist = 1, numPrevDiagonal = 0) {
  b = a.towardsPoint(b, stepDist, Point3d._tmp);
  b.roundDecimals(); // Ensure b is on a pixel, so we don't inadvertently exceed the cost at a border.
  return mp.measureSegment(a, b, { numPrevDiagonal }).cost;
}

/**
 * Cut a ruler segment at a specified point.
 * Assumes without testing that the breakpoint lies on the segment between A and B.
 * @param {RulerMeasurementSegment} segment       Segment, with ray property, to split
 * @param {Point3d} breakpoint                    Point to use when splitting the segments
 * @returns [RulerMeasurementSegment, RulerMeasurementSegment]
 */
function _splitSegmentAt(segment, breakpoint, mp, numPrevDiagonal = 0) {
  const { A, B } = segment.ray;

  // Split the segment into two at the break point.
  const s0 = {...segment};
  const s1 = {...segment};

  s0.ray = new Ray3d(A, breakpoint);
  s1.ray = new Ray3d(breakpoint, B);

  const res0 = mp.measureSegment(s0.ray.A, s0.ray.B, { numPrevDiagonal });
  const res1 = mp.measureSegment(s1.ray.A, s1.ray.B, { numPrevDiagonal: numPrevDiagonal + res0.numDiagonal });

  s0.distance = res0.distance;
  s0.offsetDistance = res0.offsetDistance;
  s0.cost = res0.cost;

  s1.distance = res1.distance;
  s1.offsetDistance = res1.offsetDistance;
  s1.cost = res1.cost;

  s1.cumulativeCost = segment.cumulativeCost;
  s1.cumulativeDistance = segment.cumulativeDistance;
  s1.cumulativeOffsetDistance = segment.cumulativeOffsetDistance;

  s0.cumulativeCost = segment.cumulativeCost - s1.cost;
  s0.cumulativeDistance = segment.cumulativeDistance - s1.distance;
  s0.cumulativeOffsetDistance = segment.cumulativeOffsetDistance - s1.offsetDistance;

  // The s1 waypoint should equal the segment waypoint.
  s0.waypoint.distance = segment.waypoint.distance - s1.distance;
  s0.waypoint.offsetDistance = segment.waypoint.offsetDistance - s1.offsetDistance;
  s0.waypoint.cost = segment.waypoint.cost - s1.cost;
  s1.speed = null;

  if ( segment.first ) { s1.first = false; }
  if ( segment.last ) { s0.last = false; }
  return [s0, s1];
}

/**
 * For a given segment, locate its intersection at a grid shape.
 * The intersection point is on the segment, halfway between the two intersections for the shape.
 * @param {number[]} gridCoords
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {PIXI.Point|undefined} Undefined if no intersection. If only one intersection, the
 *   endpoint contained within the shape.
 */
function segmentGridHalfIntersection(gridCoords, a, b) {
  const shape = gridShape(gridCoords);
  const ixs = shape.segmentIntersections(a, b);
  if ( !ixs || ixs.length === 0 ) return null;
  if ( ixs.length === 1 ) return shape.contains(a.x, a.y) ? a : b;
  return PIXI.Point.midPoint(ixs[0], ixs[1]);
}


