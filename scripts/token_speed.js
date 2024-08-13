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
import { measureSegment } from "./segments.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { gridShape, pointFromGridCoordinates, canvasElevationFromCoordinates } from "./measurement/grid_coordinates.js";
import { MovePenalty } from "./MovePenalty.js";

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
  const tokenSpeed = SPEED.tokenSpeed(token);

  // Progress through each speed attribute in turn.
  const categoryIter = [...SPEED.CATEGORIES].values();
  let speedCategory = categoryIter.next().value;
  let maxDistance = SPEED.maximumCategoryDistance(token, speedCategory, tokenSpeed);

  // Determine which speed category we are starting with
  // Add in already moved combat distance and determine the starting category
  if ( game.combat?.started
    && Settings.get(Settings.KEYS.SPEED_HIGHLIGHTING.COMBAT_HISTORY) ) {

    totalCombatMoveDistance = token.lastMoveDistance;
    minDistance = totalCombatMoveDistance;
  }

  // Construct a move penalty instance that covers all the segments.
  const movePenaltyInstance = ruler._movePenaltyInstance ??= new MovePenalty(token);

  return segment => {
    if ( !tokenSpeed ) {
      segment.speed = defaultColor;
      return [segment];
    }

    const processed = [];
    const unprocessed = [segment]
    while ( (segment = unprocessed.pop()) ) {
      // Skip speed categories that do not provide a distance larger than the last.
      while ( speedCategory && maxDistance <= minDistance ) {
        speedCategory = categoryIter.next().value;
        maxDistance = SPEED.maximumCategoryDistance(token, speedCategory, tokenSpeed);
      }
      if ( !speedCategory ) speedCategory = SPEED.CATEGORIES.at(-1);

      segment.speed = speedCategory;
      let newPrevDiagonal = measureSegment(segment, token, movePenaltyInstance, numPrevDiagonal);

      // If we have exceeded maxDistance, determine if a split is required.
      const newDistance = totalCombatMoveDistance + segment.moveDistance;

      if ( newDistance > maxDistance || newDistance.almostEqual(maxDistance ) ) {
        if ( newDistance > maxDistance ) {
          // Split the segment, inserting the latter portion in the queue for future iteration.
          const splitDistance = maxDistance - totalCombatMoveDistance;
          const breakpoint = locateSegmentBreakpoint(segment, splitDistance, { token, gridless, numPrevDiagonal });
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
              const segments = _splitSegmentAt(segment, breakpoint);
              unprocessed.push(segments[1]);
              segment = segments[0];
              newPrevDiagonal = measureSegment(segment, token, movePenaltyInstance, numPrevDiagonal);
            }
          }
        }

        // Increment to the next speed category.
        // Next category will be selected in the while loop above: first category to exceed minDistance.
        minDistance = maxDistance;
      }

      // Increment totals.
      processed.push(segment);
      totalCombatMoveDistance += segment.moveDistance;
      numPrevDiagonal = newPrevDiagonal;
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
function locateSegmentBreakpoint(segment, splitMoveDistance, { token, gridless, numPrevDiagonal } = {}) {
  if ( splitMoveDistance <= 0 ) return null;
  if ( !segment.moveDistance || splitMoveDistance > segment.moveDistance ) return null;

  // Attempt to move the split distance and determine the split location.
  const { A, B } = segment.ray;
  const res = CONFIG.Canvas.rulerClass.measureMoveDistance(A, B,
    { token, gridless, useAllElevation: false, stopTarget: splitMoveDistance, numPrevDiagonal });

  let breakpoint = pointFromGridCoordinates(res.endGridCoords); // We can get the exact split point.
  if ( !gridless ) {
    // We can get the end grid.
    // Use halfway between the intersection points for this grid shape.
    breakpoint = Point3d.fromObject(segmentGridHalfIntersection(breakpoint, A, B) ?? A);
    if ( breakpoint.equals(A) ) breakpoint.z = A.z;
    else breakpoint.z = canvasElevationFromCoordinates(res.endGridCoords);
  }

  // if ( breakpoint.almostEqual(B) || breakpoint.almostEqual(A) ) return null;
  return breakpoint;
}

/**
 * Cut a ruler segment at a specified point. Does not remeasure the resulting segments.
 * Assumes without testing that the breakpoint lies on the segment between A and B.
 * @param {RulerMeasurementSegment} segment       Segment, with ray property, to split
 * @param {Point3d} breakpoint                    Point to use when splitting the segments
 * @returns [RulerMeasurementSegment, RulerMeasurementSegment]
 */
function _splitSegmentAt(segment, breakpoint) {
  const { A, B } = segment.ray;

  // Split the segment into two at the break point.
  const s0 = {...segment};
  s0.ray = new Ray3d(A, breakpoint);
  s0.distance = null;
  s0.moveDistance = null;
  s0.numDiagonal = null;

  const s1 = {...segment};
  s1.ray = new Ray3d(breakpoint, B);
  s1.distance = null;
  s1.moveDistance = null;
  s1.numPrevDiagonal = null;
  s1.numDiagonal = null;
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


