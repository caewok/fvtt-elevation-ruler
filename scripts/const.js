/* globals
foundry,
game,
Hooks
*/
"use strict";

export const MODULE_ID = "elevationruler";
export const EPSILON = 1e-08;

export const TEMPLATES = {
  DRAWING_CONFIG: `modules/${MODULE_ID}/templates/drawing-config.html`,
  COMBAT_TRACKER: `modules/${MODULE_ID}/templates/combat-tracker.html`
};

export const FLAGS = {
  MOVEMENT_SELECTION: "selectedMovementType",
  MOVEMENT_PENALTY: "movementPenalty",
  MOVEMENT_PENALTY_FLAT: "flatMovementPenalty",
  SCENE: {
    BACKGROUND_ELEVATION: "backgroundElevation"
  },
  MOVEMENT_HISTORY: "movementHistory"
};

// Track certain modules that complement features of this module.
export const OTHER_MODULES = {
  TERRAIN_MAPPER: { KEY: "terrainmapper" },
  LEVELS: { KEY: "levels" },
  WALL_HEIGHT: { KEY: "wall-height" }
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  for ( const obj of Object.values(OTHER_MODULES) ) obj.ACTIVE = game.modules.get(obj.KEY)?.active;
});

// API not necessarily available until ready hook. (Likely added at init.)
Hooks.once("ready", function() {
  const tm = OTHER_MODULES.TERRAIN_MAPPER;
  if ( tm.ACTIVE ) tm.API = game.modules.get(tm.KEY).api;
});


export const MOVEMENT_TYPES = {
  AUTO: -1,
  BURROW: 0,
  WALK: 1,
  FLY: 2,

  /**
   * Get the movement type for a given ground versus current elevation.
   * @param {number} currElev     Elevation in grid units
   * @param {number} groundElev   Ground elevation in grid units
   * @returns {MOVEMENT_TYPE}
   */
  forCurrentElevation: function(currElev, groundElev = 0) {
    return Math.sign(currElev - groundElev) + 1;
  }
};


export const MOVEMENT_BUTTONS = {
  [MOVEMENT_TYPES.AUTO]: "road-lock",
  [MOVEMENT_TYPES.BURROW]: "person-digging",
  [MOVEMENT_TYPES.WALK]: "person-walking-with-cane",
  [MOVEMENT_TYPES.FLY]: "dove"
};

/**
 * Properties related to token speed measurement
 * See system_attributes.js for Speed definitions for different systems.
 */
export const SPEED = {
  /**
   * Object of strings indicating where on the actor to locate the given attribute.
   * @type {object<key, string>}
   */
  ATTRIBUTES: { WALK: "", BURROW: "", FLY: ""},

  /**
   * Array of speed categories used for speed highlighting.
   * Array is in order, from highest priority to lowest. Only once the distance is surpassed
   * in the first category is the next category considered.
   * @type {SpeedCategory[]}
   */
  CATEGORIES: [],

  // Use Font Awesome font unicode instead of basic unicode for displaying terrain symbol.

  /**
   * If true, use Font Awesome font unicode instead of basic unicode for displaying terrain symbol.
   * @type {boolean}
   */
  useFontAwesome: true, // Set to true to use Font Awesome unicode

  /**
   * Terrain icon.
   * If using Font Awesome, e.g, https://fontawesome.com/icons/bolt?f=classic&s=solid would be "\uf0e7".
   * If not using Font Awesome, paste in unicode, e.g. "🥾" or "\u0xF0"
   * @type {string}
   */
  terrainSymbol: "\ue52f" // https://fontawesome.com/icons/mountain-sun?f=classic&s=solid
};

/**
 * Given a token, get the maximum distance the token can travel for a given type.
 * Distance measured from 0, so types overlap. E.g.
 *   WALK (x1): Token speed 25, distance = 25.
 *   DASH (x2): Token speed 25, distance = 50.
 *
 * @param {Token} token                   Token whose speed should be used
 * @param {SpeedCategory} speedCategory   Category for which the maximum distance is desired
 * @param {number} [tokenSpeed]           Optional token speed to avoid repeated lookups
 * @returns {number}
 */
SPEED.maximumCategoryDistance = function(token, speedCategory, tokenSpeed) {
  tokenSpeed ??= SPEED.tokenSpeed(token);
  return speedCategory.multiplier * tokenSpeed;
};

/**
 * Get the key for a given object value. Presumes unique values, otherwise returns first.
 */
function keyForValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

/**
 * Given a token, retrieve its base speed.
 * @param {Token} token                     Token whose speed is required
 * @param {MOVEMENT_TYPES} [movementType]   Type of movement; if omitted automatically determined
 * @returns {number|null} Distance, in grid units. Null if no speed provided for that category.
 *   (Null will disable speed highlighting.)
 */
SPEED.tokenSpeed = function(token, movementType) {
  movementType ??= token.movementType;
  const speed = foundry.utils.getProperty(token, SPEED.ATTRIBUTES[keyForValue(MOVEMENT_TYPES, movementType)]);
  if ( speed === null ) return null;
  return Number(speed);
};
