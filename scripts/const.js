/* globals
foundry,
game,
Hooks
*/
"use strict";

export const MODULE_ID = "elevationruler";
export const EPSILON = 1e-08;

export const TEMPLATES = {
  DRAWING_CONFIG: `modules/${MODULE_ID}/templates/drawing-config.html`
};

export const FLAGS = {
  MOVEMENT_SELECTION: "selectedMovementType",
  MOVEMENT_PENALTY: "movementPenalty",
  SCENE: {
    BACKGROUND_ELEVATION: "backgroundElevation"
  }
};

export const MODULES_ACTIVE = { API: {} };

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.LEVELS = game.modules.get("levels")?.active;
  MODULES_ACTIVE.TERRAIN_MAPPER = game.modules.get("terrainmapper")?.active;
});

// API not necessarily available until ready hook. (Likely added at init.)
Hooks.once("ready", function() {
  if ( MODULES_ACTIVE.TERRAIN_MAPPER ) MODULES_ACTIVE.API.TERRAIN_MAPPER = game.modules.get("terrainmapper").api;
});

export const MOVEMENT_TYPES = {
  AUTO: -1,
  BURROW: 0,
  WALK: 1,
  FLY: 2
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
  useFontAwesome: false, // Set to true to use Font Awesome unicode

  /**
   * Terrain icon.
   * If using Font Awesome, e.g, https://fontawesome.com/icons/bolt?f=classic&s=solid would be "\uf0e7".
   * @type {string}
   */
  terrainSymbol: "🥾"
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
 * Given a token, retrieve its base speed.
 * @param {Token} token                   Token whose speed is required
 * @returns {number|null} Distance, in grid units. Null if no speed provided for that category.
 *   (Null will disable speed highlighting.)
 */
SPEED.tokenSpeed = function(token) {
  const speed = foundry.utils.getProperty(token, SPEED.ATTRIBUTES[token.movementType]);
  if ( speed === null ) return null;
  return Number(speed);
};

/**
 * From Foundry v12
 * The different rules to define and measure diagonal distance/cost in a square grid.
 * The description of each option refers to the distance/cost of moving diagonally relative
 * to the distance/cost of a horizontal or vertical move.
 * @enum {number}
 */
export const GRID_DIAGONALS = {
  /**
   * The diagonal distance is 1. Diagonal movement costs the same as horizontal/vertical movement.
   */
  EQUIDISTANT: 0,

  /**
   * The diagonal distance is √2. Diagonal movement costs √2 times as much as horizontal/vertical movement.
   */
  EXACT: 1,

  /**
   * The diagonal distance is 1.5. Diagonal movement costs 1.5 times as much as horizontal/vertical movement.
   */
  APPROXIMATE: 2,

  /**
   * The diagonal distance is 2. Diagonal movement costs 2 times as much as horizontal/vertical movement.
   */
  RECTILINEAR: 3,

  /**
   * The diagonal distance alternates between 1 and 2 starting at 1.
   * The first diagonal movement costs the same as horizontal/vertical movement
   * The second diagonal movement costs 2 times as much as horizontal/vertical movement.
   * And so on...
   */
  ALTERNATING_1: 4,

  /**
   * The diagonal distance alternates between 2 and 1 starting at 2.
   * The first diagonal movement costs 2 times as much as horizontal/vertical movement.
   * The second diagonal movement costs the same as horizontal/vertical movement.
   * And so on...
   */
  ALTERNATING_2: 5,

  /**
   * The diagonal distance is ∞. Diagonal movement is not allowed/possible.
   */
  ILLEGAL: 6
};
