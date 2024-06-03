/* globals
Color,
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
  MOVEMENT_PENALTY: "movementPenalty"
};

export const MODULES_ACTIVE = { API: {} };

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.LEVELS = game.modules.get("levels")?.active;
  MODULES_ACTIVE.ELEVATED_VISION = game.modules.get("elevatedvision")?.active;
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
 * Below Taken from Drag Ruler
 */
/*
MIT License

Copyright (c) 2021 Manuel Vögele

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * @typedef {object} SpeedCategory
 *
 * Object that stores the name, multiplier, and color of a given speed category.
 * Custom properties are permitted. The SpeedCategory is passed to SPEED.maximumCategoryDistance,
 * which in turn can be defined to use custom properties to calculate the maximum distance for the category.
 *
 * @prop {Color} color          Color used with ruler highlighting
 * @prop {string} name          Unique name of the category (relative to other SpeedCategories)
 * @prop {number} [multiplier]  This times the token movement equals the distance for this category
 */

const WalkSpeedCategory = {
  name: "Walk",
  color: Color.from(0x00ff00),
  multiplier: 1
};

const DashSpeedCategory = {
  name: "Dash",
  color: Color.from(0xffff00),
  multiplier: 2
};

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
  CATEGORIES: [WalkSpeedCategory, DashSpeedCategory],

  /**
   * Color to use once all SpeedCategory distances have been exceeded.
   * @type {Color}
   */
  MAXIMUM_COLOR: Color.from(0xff0000),

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

export const MaximumSpeedCategory = {
  name: "Maximum",
  multiplier: Number.POSITIVE_INFINITY
};

Object.defineProperty(MaximumSpeedCategory, "color", {
  get: () => SPEED.MAXIMUM_COLOR
});

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

// Avoid testing for the system id each time.
Hooks.once("init", function() {
  SPEED.ATTRIBUTES.WALK = defaultWalkAttribute();
  SPEED.ATTRIBUTES.BURROW = defaultBurrowAttribute();
  SPEED.ATTRIBUTES.FLY = defaultFlyAttribute();
  DashSpeedCategory.multiplier = defaultDashMultiplier();
});


/* eslint-disable no-multi-spaces */
export function defaultHPAttribute() {
  switch ( game.system.id ) {
    case "dnd5e":         return "actor.system.attributes.hp.value";
    case "dragonbane":    return "actor.system.hitpoints.value";
    case "twodsix":       return "actor.system.hits.value";
    default:              return "actor.system.attributes.hp.value";
  }
}

export function defaultWalkAttribute() {
  switch ( game.system.id ) {
    case "CoC7":          return "actor.system.attribs.mov.value";
    case "dcc":           return "actor.system.attributes.speed.value";
    case "sfrpg":         return "actor.system.attributes.speed.value";
    case "dnd4e":         return "actor.system.movement.walk.value";
    case "dnd5e":         return "actor.system.attributes.movement.walk";
    case "lancer":        return "actor.system.derived.speed";

    case "pf1":
    case "D35E":          return "actor.system.attributes.speed.land.total";
    case "shadowrun5e":   return "actor.system.movement.walk.value";
    case "swade":         return "actor.system.stats.speed.adjusted";
    case "ds4":           return "actor.system.combatValues.movement.total";
    case "splittermond":  return "actor.derivedValues.speed.value";
    case "wfrp4e":        return "actor.system.details.move.walk";
    case "crucible":      return "actor.system.movement.stride";
    case "dragonbane":    return "actor.system.movement";
    case "twodsix":       return "actor.system.movement.walk";
    default:              return "";
  }
}

export function defaultFlyAttribute() {
  switch ( game.system.id ) {
    // Missing attribute case "CoC7":
    // Missing attribute case "dcc":
    case "sfrpg":         return "actor.system.attributes.flying.value";
    // Missing attribute case "dnd4e":
    case "dnd5e":         return "actor.system.attributes.movement.fly";
    // Missing attribute case "lancer":
    case "pf1":
    case "D35E":          return "actor.system.attributes.speed.fly.total";
    // Missing attribute case "shadowrun5e":
    // Missing attribute case "swade":
    // Missing attribute case "ds4":
    // Missing attribute case "splittermond":
    // Missing attribute case "wfrp4e":
    // Missing attribute case "crucible":
    // Missing attribute case "dragonbane":
    case "twodsix":       return "actor.system.movement.fly";
    default:              return "";
  }
}

export function defaultBurrowAttribute() {
  switch ( game.system.id ) {
    // Missing attribute case "CoC7":
    // Missing attribute case "dcc":
    case "sfrpg":         return "actor.system.attributes.burrowing.value";
    // Missing attribute case "dnd4e":
    case "dnd5e":         return "actor.system.attributes.movement.burrow";
    // Missing attribute case "lancer":
    case "pf1":
    case "D35E":          return "actor.system.attributes.speed.burrow.total";
    // Missing attribute case "shadowrun5e":
    // Missing attribute case "swade":
    // Missing attribute case "ds4":
    // Missing attribute case "splittermond":
    // Missing attribute case "wfrp4e":
    // Missing attribute case "crucible":
    // Missing attribute case "dragonbane":
    case "twodsix":       return "actor.system.movement.burrow";
    default:              return "";
  }
}

export function defaultDashMultiplier() {
  switch ( game.system.id ) {
    case "dcc":
    case "dnd4e":
    case "dnd5e":
    case "lancer":
    case "pf1":
    case "D35E":
    case "sfrpg":
    case "shadowrun5e":
    case "dragonbane":
    case "twodsix":
    case "ds4":           return 2;

    case "CoC7":          return 5;
    case "splittermond":  return 3;
    case "wfrp4e":        return 2;

    case "crucible":
    case "swade":         return 0;
    default:              return 0;
  }
}

/* eslint-enable no-multi-spaces */

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
