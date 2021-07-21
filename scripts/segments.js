import { MODULE_ID, log } from "./module.js";

/*
 * Add flags to the segment specific to elevation:
 * - incremental elevation of the segment
 * - starting elevation of the segment 
 * - ending elevation of the segment 
 */
export function elevationRulerAddProperties(wrapped, ...args) {
  log(`elevationRulerAddProperties: this`, this);

  if(this.segment_num < 0) {
    console.error(`${MODULE_ID}|libRulerAddProperties: this.segment_num is less than zero`, this);
    return;
  }
  
  /*
UX goals:
1. Ruler origin elevation is the starting token elevation, if any, or the terrain elevation.
2. Dragging the ruler to the next space may cause it to drop if the token is elevated.
- This is probably fine? If flying while everyone else is on the ground, the default should
    account for that.
- A bit cumbersome if measuring straight across elevated terrain, but (a) use terrain layer and
    (b) other elevated tokens should change the destination elevation automatically. (see 3 below)
3. If the destination space is an elevated token or terrain, use that elevation for destination.
- So measuring that space will change the ruler elevation indicator accordingly.
- This will cause the elevation indicator to change without other user input. This is probably fine?
    User will be dragging the ruler, so that is appropriate feedback.
4. User can at any time increment or decrement. This is absolute, in that it is added on top of any
    default elevations from originating/destination tokens or terrain.
- Meaning, origination could be 0, user increments 5 and then drags to a terrain space of 50; ruler
    would go from 5 to 55. 
  */
  
  let elevation_increments = duplicate(this.ruler.getFlag(MODULE_ID, "elevation_increments"));
  if(!elevation_increments || elevation_increments.length < 1) {
    elevation_increments = [0];
  } 
  
  log(`${elevation_increments.length} elevation increments for ruler flag.`)
  
  const destination_elevation_increment = this.ruler.getFlag(MODULE_ID, "destination_elevation_increment") || 0;
  elevation_increments.push(destination_elevation_increment);
  log(`${this.ruler.getFlag(MODULE_ID, "elevation_increments").length} destination elevation increments for ruler flag.`);
  
  
  elevation_increments.shift(); //first increment is 0 for the origin waypoint
  
  
  let starting_elevation = 0;
  if(this.segment_num === 0) {
    // starting elevation equals the token elevation 
    // if no token, use elevation at the point. 
    starting_elevation = ElevationAtPoint(this.ray.A, this.ruler._getMovementToken(), 0) // 0 starting elevation otherwise
    log(`Starting elevation using origin ${this.ray.A.x}, ${this.ray.A.y}`, this.ruler._getMovementToken());

  } else {
    // starting elevation is the prior segment end elevation
    starting_elevation = this.prior_segment.getFlag(MODULE_ID, "ending_elevation");    
    log(`Current ending elevation is ${this.getFlag(MODULE_ID, "ending_elevation")}; Prior segment ending elevation is ${starting_elevation}`);
  }
  
  
  const incremental_elevation = toGridDistance(elevation_increments[this.segment_num]);
  const current_point_elevation = ElevationAtPoint(this.ray.B, undefined, starting_elevation); // no starting token; assume we are at the elevation from the last segment
  const ending_elevation = current_point_elevation + incremental_elevation;
  log(`Current elevation using point ${this.ray.B.x}, ${this.ray.B.y}`);
   
  log(`elevationRulerAddProperties segment ${this.segment_num}: ${starting_elevation}[start]; ${incremental_elevation}[incremental]; ${current_point_elevation}[current point]`);
  
  // Track whether any elevation change has been requested for ruler labeling.
  // Also track whether ruler elevation has changed due to a shift in terrain elevation or starting token elevation.
  let path_has_elevation_change = incremental_elevation !== 0 || starting_elevation !== ending_elevation;
  if("getFlag" in this.prior_segment) {
    path_has_elevation_change = path_has_elevation_change || this.prior_segment.getFlag(MODULE_ID, "path_has_elevation_change");
  }
  
  if(game.settings.get(MODULE_ID, "enable-levels-floor-label")) {
    const level_name = LevelNameAtPoint(this.ray.B, ending_elevation);
    log(`Level name for segment ${this.segment_num} is ${level_name}`);
  
    this.setFlag(MODULE_ID, "elevation_level_name", level_name); 
  } 
  this.setFlag(MODULE_ID, "starting_elevation", starting_elevation);
  this.setFlag(MODULE_ID, "ending_elevation", ending_elevation);
  this.setFlag(MODULE_ID, "incremental_elevation", incremental_elevation)
  this.setFlag(MODULE_ID, "path_has_elevation_change", path_has_elevation_change);
  
  return wrapped(...args);
}


/**
 * Check if point is within the controlled area of the token
 * (Recall that tokens may be wider than 1 square)
 */
function pointWithinToken(point, token) {
  return point.x >= token.x && 
         point.y >= token.y &&
         point.x <= (token.x + token.w) &&
         point.y <= (token.y + token.h); 
}

/**
 * Retrieve visible tokens
 * For GM, all will be visible unless 1 or more tokens are selected.
 * Combined vision for all tokens selected.
 */
function retrieveVisibleTokens() {
  return canvas.tokens.children[0].children.filter(c => c.visible);
}

/* 
 * Helper function to convert absolute increments to grid distance
 */
export function toGridDistance(increment) {
  return Math.round(increment * canvas.scene.data.gridDistance * 100) / 100;
}


export function elevationRulerConstructPhysicalPath(wrapped, ...args) {
  // elevate or lower the destination point in 3-D space
  // measure from the origin of the ruler movement, so that canvas = 0 and each segment
  // could in theory be connected in space
  //  --> this is done in AddProperties function
  log("Constructing the physical path.");
  const default_path = wrapped(...args);
  log("Default path", default_path);

  const starting_elevation = this.getFlag(MODULE_ID, "starting_elevation");
  const ending_elevation = this.getFlag(MODULE_ID, "ending_elevation");

  const starting_elevation_grid_units = starting_elevation / canvas.scene.data.gridDistance * canvas.scene.data.grid;
  const ending_elevation_grid_units = ending_elevation / canvas.scene.data.gridDistance * canvas.scene.data.grid;

  log(`Elevation start: ${starting_elevation}; end ${ending_elevation}.
            grid units: ${starting_elevation_grid_units}; end ${ending_elevation_grid_units}.`);

  // For origin and destination, provide an elevation proportional to the distance
  //   compared to the ruler segment distance.
  // This accommodates situations where the destination to measure does not equal segment
  //   destination
  // Need to apply canvas.scene.data.grid (140) and canvas.scene.data.gridDistance (5)
  // 7350 (x1) - 6930 (x0) = 420 (delta_x) / 140 * 5 = move in canvas units (e.g. 15')

  // will need to address later if there are multiple points in the physical path, rather
  // than just origin and destination...
  const elevation_delta = ending_elevation_grid_units - starting_elevation_grid_units; 
  const ruler_distance = this.ray.distance;
  
  // destination
  const simple_path_distance = CalculateDistance(default_path.origin, default_path.destination);
  const ratio = simple_path_distance / ruler_distance;
  default_path.destination.z =   starting_elevation_grid_units + elevation_delta * ratio;
  
  // origin
  default_path.origin.z = starting_elevation_grid_units;
  
  log("Default path", default_path);
  
  return default_path;
}

export function elevationRulerDistanceFunction(wrapped, physical_path) {
  // Project the 3-D path to 2-D canvas
  log(`Projecting physical_path from origin ${physical_path.origin.x}, ${physical_path.origin.y}, ${physical_path.origin.z} 
                                    to dest ${physical_path.destination.x}, ${physical_path.destination.y}, ${physical_path.destination.z}`);
  
  // for each of the points, construct a 2-D path and send to the underlying function
  // will need to address later if there are multiple points in the physical path, rather
  // than just origin and destination...
  
  physical_path.destination = ProjectElevatedPoint(physical_path.origin, physical_path.destination);
  delete physical_path.origin.z;
  delete physical_path.destination.z;
  
  // if we are using grid spaces, the destination needs to be re-centered to the grid.
  // otherwise, when a token moves in 2-D diagonally, the 3-D measure will be inconsistent
  // depending on cardinality of the move, as rounding will increase/decrease to the nearest gridspace
  if(this.measure_distance_options?.gridSpaces) {
    // canvas.grid.getCenter returns an array [x, y];
    const snapped = canvas.grid.getCenter(physical_path.destination.x, physical_path.destination.y);
    log(`Snapping ${physical_path.destination.x}, ${physical_path.destination.y} to ${snapped[0]}, ${snapped[1]}`);
    physical_path.destination = { x: snapped[0], y: snapped[1] };
  }
  
  
  log(`Projected physical_path from origin ${physical_path.origin.x}, ${physical_path.origin.y} 
                                     to dest ${physical_path.destination.x}, ${physical_path.destination.y}`);
                                     
  return wrapped(physical_path);
}

/* 
 * @param {number} segmentDistance
 * @param {number} totalDistance
 * @param {boolean} isTotal
 * @param {integer} segment_num The segment number, where 1 is the
 *    first segment between origin and the first waypoint (or destination),
 *    2 is the segment between the first and second waypoints.
 *
 *    The segment_num can also be considered the waypoint number, equal to the index 
 *    in the array this.waypoints.concat([this.destination]). Keep in mind that 
 *    the first waypoint in this.waypoints is actually the origin 
 *    and segment_num will never be 0.
 */ 
export function elevationRulerGetText(wrapped, ...args) {
  const orig_label = wrapped(...args);
  log(`Adding to segment label ${orig_label}`, this);
  
  const starting_elevation = this.getFlag(MODULE_ID, "starting_elevation");
  const ending_elevation = this.getFlag(MODULE_ID, "ending_elevation");
  //const incremental_elevation = this.getFlag(MODULE_ID, "incremental_elevation");

  
  // if no elevation change for any segment, then skip.
  const path_has_elevation_change = this.getFlag(MODULE_ID, "path_has_elevation_change");
  
  if(!path_has_elevation_change) { return orig_label; }
  
  let elevation_label = segmentElevationLabel(ending_elevation - starting_elevation, ending_elevation);
  if(game.settings.get(MODULE_ID, "enable-levels-floor-label")) {
    const level_name = this.getFlag(MODULE_ID, "elevation_level_name");
    log(`elevationRulerGetText: Level name is ${level_name}`);
    
    if(level_name) {
      elevation_label += `\n${level_name}`;
    }
  } 
 
  log(`elevation_label is ${elevation_label}`);
  return orig_label + "\n" + elevation_label;
}



/*
 * Construct a label to represent elevation changes in the ruler.
 * Waypoint version: 10 ft↑ [@10 ft]
 * Total version: 10 ft↑ [@ 20 ft]
 * @param {number} segmentElevationIncrement Incremental elevation for the segment.
 * @param {number} segmentCurrentElevation Total elevation for all segments to date.
 * @param {boolean} isTotal Whether this is the label for the final segment
 * @return {string}
 */
function segmentElevationLabel(segmentElevationIncrement, segmentCurrentElevation) {
  const segmentArrow = (segmentElevationIncrement > 0) ? "↑" :
                      (segmentElevationIncrement < 0) ? "↓" :
                      "";
  
  // Take absolute value b/c segmentArrow will represent direction
  // * 100 / 100 is used in _getSegmentLabel; not sure whys
  let label = `${Math.abs(Math.round(segmentElevationIncrement * 100) / 100)} ${canvas.scene.data.gridUnits}${segmentArrow}`;
  label += ` [@${Math.round(segmentCurrentElevation * 100) / 100} ${canvas.scene.data.gridUnits}]`;
 
  return label;
}

/*
 * Measure elevation at a given point.
 * Prioritize:
 *   1. Token object, if provided.
 *   2. Other token at point, if found.
 *   3. Levels, if any
 *   4. Terrain, if any
 * @param {PIXI.Point} p    Point to measure, in {x, y} format
 * @param {Object} token    Token to use, if any
 * @return {Number} Elevation for the given point.
 */
// also needed to move tokens in Ruler class
export function ElevationAtPoint(p, token, starting_elevation = 0) {
  if(token) { return getProperty(token, "data.elevation"); }
  
  // check for tokens; take the highest one at a given position
  let tokens = retrieveVisibleTokens();
  const max_token_elevation = tokens.reduce((total, t) => {
    // is the point within the token control area? 
    if(!pointWithinToken(p, t)) return total;
    return Math.max(t.data.elevation, total);
  }, Number.NEGATIVE_INFINITY) || Number.NEGATIVE_INFINITY;
  
  log(`calculateEndElevation: ${tokens.length} tokens with maximum elevation ${max_token_elevation}`);
  
  // use tokens rather than elevation if available
  if(isFinite(max_token_elevation)) { return max_token_elevation; }

  // try levels
  const levels_elevation = LevelsElevationAtPoint(p, starting_elevation);
  if(levels_elevation !== undefined) { return levels_elevation; }
  
  // try terrain
  const terrain_elevation = TerrainElevationAtPoint(p);
  if(terrain_elevation !== undefined) { return terrain_elevation; }
  
  // default to 0 elevation for the point
  return 0;
}
  

// ----- TERRAIN LAYER ELEVATION ----- //
/* 
 * Measure the terrain elevation at a given point. 
 * Elevation should be the maximum terrain elevation.
 * @param {PIXI.Point} p    Point to measure, in {x, y} format.
 * @return {Number|undefined} Point elevation or undefined if terrain layer is inactive or no terrain found.
 */
function TerrainElevationAtPoint(p) {
  if(!game.settings.get(MODULE_ID, "enable-terrain-elevation") || !game.modules.get("enhanced-terrain-layer")?.active) {
    return undefined;
  }
     
  const terrains = canvas.terrain.terrainFromPixels(p.x, p.y); 
  if(terrains.length === 0) return undefined; // no terrains found at the point.

  // get the maximum non-infinite elevation point using terrain max
  // must account for possibility of 
  // TO-DO: Allow user to ignore certain terrain types?
  let terrain_max_elevation = terrains.reduce((total, t) => {
   if(!isFinite(t.max)) return total;
   return Math.max(total, t.max);
  }, Number.NEGATIVE_INFINITY);

  // in case all the terrain maximums are infinite.
  terrain_max_elevation = isFinite(terrain_max_elevation) ? terrain_max_elevation : 0;

  log(`TerrainElevationAtPoint: Returning elevation ${terrain_max_elevation} for point ${p}`, terrains);

  return terrain_max_elevation;
}

// ----- LEVELS ELEVATION ----- //
// use cases:
// generally:
// - if over a level-enabled object, use the bottom of that level.
// - if multiple, use the bottom
// - if hole, use the bottom
// starting point of the ruler is a token: 
// - if the same level is present, stay at that level 
//   (elevation should be found from the token, so no issue)
// - if a hole, go to bottom of the hole
// - display level as labeled in the levels object flag?

/*
 * Measure the elevation of any levels tiles at the point.
 * If the point is within a hole, return the bottom of that hole.
 * If the point is within a level, return the bottom of the level.
 * @param {PIXI.Point} p    Point to measure, in {x, y} format.
 * @return {Number|undefined} Levels elevation or undefined if levels is inactive or no levels found.
 */
function LevelsElevationAtPoint(p, starting_elevation) {
  if(!game.settings.get(MODULE_ID, "enable-levels-elevation") || !game.modules.get("levels")?.active) {
    return undefined;
  }

  // if in a hole, use that
  const hole_elevation = checkForHole(p, starting_elevation);
  if(hole_elevation !== undefined) return hole_elevation;
  
  // use levels if found
  const levels_objects = _levels.getFloorsForPoint(p); // @returns {Object[]} returns an array of object each containing {tile,range,poly}
  log("LevelsElevationAtPoint levels_objects", levels_objects);
  return checkForLevel(p, starting_elevation); 
}

function LevelNameAtPoint(p, zz) {
  if(!game.settings.get(MODULE_ID, "enable-levels-elevation") || !game.modules.get("levels")?.active) {
    return undefined;
  }

  const floors = _levels.getFloorsForPoint(p);
  if(!floors || floors.length < 1) { return undefined; }
  
  const levels_data = canvas.scene.getFlag("levels", "sceneLevels") // array with [0]: bottom; [1]: top; [2]: name
  for(let l of levels_data) {
     if (zz <= l[1] && zz >= l[0])
       return l[2];
  }
  return undefined; 
}


// Check for level; return bottom elevation
function checkForLevel(intersectionPT, zz) {
  // poly undefined for tiles.
  const floors = _levels.getFloorsForPoint(intersectionPT); // @returns {Object[]} returns an array of object each containing {tile,range,poly} 
  log(`checkForLevel floors`, floors);
  //const floor_range = _levels.findCurrentFloorForElevation(zz, floors); // broken
  const floor_range = findCurrentFloorForElevation(zz, floors);
  log(`checkForLevel current floor range for elevation ${zz}: ${floor_range[0]} ${floor_range[1]}`);
  if(!floor_range) return undefined;
  return floor_range[0];
}

function findCurrentFloorForElevation(elevation, floors) {
   for(let floor of floors) {
     if (elevation <= floor.range[1] && elevation >= floor.range[0])
       return floor.range;
   }
   return false;
  }

// Check if a floor is hollowed by a hole
// Based on Levels function, modified to return bottom elevation of the hole.
function checkForHole(intersectionPT, zz) {
  for(let hole of _levels.levelsHoles) {
    const hbottom = hole.range[0];
    const htop = hole.range[1];
    if (zz > htop || zz < hbottom) continue;
    if (hole.poly.contains(intersectionPT.x, intersectionPT.y)) {
      return hbottom;
    }
  }
  return undefined;
}


// ----- MATH FOR MEASURING ELEVATION DISTANCE ----- //
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
export function ProjectElevatedPoint(A, B) {
  const height = A.z - B.z;
  const distance = CalculateDistance(A, B);
  const projected_x = A.x + ((height / distance) * (B.y - A.y));
  const projected_y = A.y - ((height / distance) * (B.x - A.x));

  return new PIXI.Point(projected_x, projected_y);
}

function CalculateDistance(A, B) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  return Math.hypot(dy, dx);
}

// console.log(Math.hypot(3, 4));
// // expected output: 5
// 
// console.log(Math.hypot(5, 12));
// // expected output: 13
// 
// let m;
// let o = {x:0, y:0}
// m = ProjectElevatedPoint(o, {x:1, y:0}, 1);
// CalculateDistance(o, m) // 1.414
// 
// m = ProjectElevatedPoint(o, {x:3, y:0}, 4);
// CalculateDistance(o, m) // 5
// 
// m = ProjectElevatedPoint(o, {x:0, y:3}, 4);
// CalculateDistance(o, m) // 5 
// 
// m = ProjectElevatedPoint(o, {x:0, y:3}, 4);

// m = distance
// n = height
// A = origin ()
// B = destination (1)
// C = destination with height (2)
// |Ay - By| / m = |Bx - Cx| / n
// |Ax - Bx| / m = |Cy - By| / n
// 
// |Bx - Cx| / n = |Ay - By| / m
// |Cy - By| / n = |Ax - Bx| / m
// 
// |Bx - Cx| = |Ay - By| * n/m
// |Cy - By| = |Ax - Bx| * n/m
// 
// Bx - Cx = ± n/m * (Ay - By)
// Cy - By = ± n/m * (Ax - Bx)
// 
// Cx = Bx ± n/m * (Ay - By)
// Cy = By ± n/m * (Ax - Bx)
