/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Ruler class
export const PATCHES = {};
PATCHES.BASIC = {};




/**
 * Modified Ruler
 * Measure elevation change at each waypoint and destination.
 * Modify distance calculation accordingly.
 * Display current elevation change and change at each waypoint.
 */

/**
 * Typical Ruler workflow:
 * - clear when drag starts
 * - create initial waypoint
 * - measure (likely multiple)
 * - add'l waypoints (optional)
 * - possible token movement
 * - clear when drag abandoned
 */

/* Ruler measure workflow
- Update destination
- _getMeasurementSegments
  --> Create new array of segments
  * ER assigns elevation value to each segment based on user increments: `elevateSegments`
  * ER either uses pathfinding or TM's region path to expand the segments

- _computeDistance
  --> iterates over each segment
  --> calculates totalDistance and totalCost by iterating over segments.
  --> uses `canvas.grid.measurePath` for each with the _getCostFunction
  --> calculates distance, cost, cumulative distance, and cumulative cost for each segment
  * ER uses `_computeSegmentDistances` to calculate 3d distance with move penalty
  * ER adds segment properties used for labeling
- _broadcastMeasurement
- _drawMeasuredPath
  --> Iterates over each segment, assigning a label to each using _getSegmentLabel
    * ER adds elevation and move penalty label information
- _highlightMeasurementSegments
  * ER splits the highlighting at move breaks if speed highlighting is set
*/

/* Elevation measurement

Each waypoint has added properties:
- _userElevationIncrements: Elevation shifts up or down at this point due to user input
- _terrainElevation: Ground/terrain elevation at this location, calculated as needed
- elevation: The calculated elevation of this waypoint, which is the previous waypoint elevation
  plus changes due to user increments, terrain

*/

// ----- NOTE: Ruler broadcasting ----- //


// ----- NOTE: Waypoints, origin, destination ----- //

/**
 * Wrap Ruler.prototype._removeWaypoint
 * Remove elevation increments.
 * Remove calculated path.
 */
function _removeWaypoint(wrapper, point, { snap = true } = {}) {
  if ( this._pathfindingSegmentMap ) this._pathfindingSegmentMap.delete(this.waypoints.at(-1));
  wrapper(point, { snap });
}

// ----- NOTE: Segments ----- //

/**
 * Mixed wrap of  Ruler.prototype._getMeasurementSegments
 * Add elevation information to the segments.
 * Add pathfinding segments.
 * Add segments for traversing regions.
 */
function _getMeasurementSegments(wrapped) {

  // No segments are present if dragging back to the origin point.
  const segments = wrapped();

  return segments;

  /*
  const segmentMap = this._pathfindingSegmentMap ??= new Map();
  if ( !segments.length ) {
    segmentMap.clear();
    return segments;
  }

  // Add z value (elevation in pixel units) to the segments.
  elevateSegments(this, segments);

  // If no movement token, then no region paths or pathfinding.
  const token = this.token;
  if ( !token ) return segments;

  const usePathfinding = Settings.get(Settings.KEYS.CONTROLS.PATHFINDING) ^ Settings.FORCE_TOGGLE_PATHFINDING;
  let pathPoints = [];
  const t0 = performance.now();
  const lastSegment = segments.at(-1);
  if ( CONFIG[MODULE_ID].debug ) console.groupCollapsed(`${MODULE_ID}|_getMeasurementSegments`);
  if ( usePathfinding ) {
    // If currently pathfinding, set path for the last segment, overriding any prior path.
    // Pathfinding when: the pathfinding icon is enabled or the temporary toggle key is held.
    // TODO: Pathfinding should account for region elevation changes and handle flying/burrowing.
    pathPoints = calculatePathPointsForSegment(lastSegment, token);
  }

  if ( OTHER_MODULES.TERRAIN_MAPPER.ACTIVE ) {
    const t0 = performance.now();
    // For now, determine movement type for each of the path points. PathPoints are {x, y} objects.
    // If no path points, use the segments.
    const initialPath = pathPoints.map(pt => RegionMovementWaypoint3d.fromObject(pt));

    // For now, set the initial path to the elevation of the last segment.
    if ( initialPath.length ) {
      initialPath.forEach(pt => pt.z = lastSegment.ray.A.z);
      initialPath.at(-1).z = lastSegment.ray.B.z;
    } else initialPath.push(
      RegionMovementWaypoint3d.fromObject(lastSegment.ray.A),
      RegionMovementWaypoint3d.fromObject(lastSegment.ray.B)
    );

    // Determine the region path.
    pathPoints.length = 0;
    const ElevationHandler = OTHER_MODULES.TERRAIN_MAPPER.API.ElevationHandler;
    let prevPt = initialPath[0];
    pathPoints.push(prevPt);
    for ( let i = 1, n = initialPath.length; i < n; i += 1 ) {
      const nextPt = initialPath[i];
      const movementTypeStart = movementTypeForTokenAt(token, prevPt);
      const endGround = terrainElevationAtLocation(nextPt, nextPt.elevation);
      const movementTypeEnd = MOVEMENT_TYPES.forCurrentElevation(nextPt.elevation, endGround);
      const flying = movementTypeStart === MOVEMENT_TYPES.FLY || movementTypeEnd === MOVEMENT_TYPES.FLY;
      const burrowing = movementTypeStart === MOVEMENT_TYPES.BURROW || movementTypeEnd === MOVEMENT_TYPES.BURROW;
      const subPath = ElevationHandler.constructPath(prevPt, nextPt, { flying, burrowing, token });
      log(`Subpath ${prevPt.x},${prevPt.y},${prevPt.z} -> ${nextPt.x},${nextPt.y},${nextPt.z}. Flying: ${flying}; burrowing: ${burrowing}.`, subPath);
      subPath.shift(); // Remove prevPt from the array.
      pathPoints.push(...subPath);
      prevPt = nextPt;
    }
    const t1 = performance.now();
    log(`Found terrain path with ${pathPoints.length} points in ${t1-t0} ms.`, initialPath, pathPoints);
  }
  const t1 = performance.now();
  const key = `${lastSegment.ray.A.key}|${lastSegment.ray.B.key}`;
  if ( pathPoints.length > 2 ) {
    segmentMap.set(key, pathPoints);
    log(`Found path with ${pathPoints.length} points in ${t1-t0} ms.`, pathPoints);
  } else segmentMap.delete(key);

  // For each segment, replace with path sub-segment if pathfinding or region paths were used for that segment.
  const t2 = performance.now();
  const newSegments = constructPathfindingSegments(segments, segmentMap);
  const t3 = performance.now();
  log(`${newSegments.length} segments processed in ${t3-t2} ms.`);
  if ( CONFIG[MODULE_ID].debug ) console.groupEnd(`${MODULE_ID}|_getMeasurementSegments`);
  return newSegments;
  */
}

// PATCHES.BASIC.WRAPS = {
//   // _removeWaypoint,
// };

// PATCHES.BASIC.MIXES = {
//   _getMeasurementSegments,
// };

