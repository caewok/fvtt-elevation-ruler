/* globals
Color,
foundry,
game,
Hooks
*/
"use strict";

import { SPEED } from "./const.js";

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

const MaximumSpeedCategory = {
  name: "Maximum",
  color: Color.from(0xff0000),
  multiplier: Number.POSITIVE_INFINITY
}

Hooks.once("init", function() {
  // Set the default speed parameters for the given system.
  SPEED.ATTRIBUTES.WALK = defaultWalkAttribute();
  SPEED.ATTRIBUTES.BURROW = defaultBurrowAttribute();
  SPEED.ATTRIBUTES.FLY = defaultFlyAttribute();
  DashSpeedCategory.multiplier = defaultDashMultiplier();
  SPEED.CATEGORIES = [WalkSpeedCategory, DashSpeedCategory, MaximumSpeedCategory];

  // Add specialized system categories
  const moveCategoryFn = SPECIALIZED_MOVE_CATEGORIES[game.system.id];
  if ( moveCategoryFn ) moveCategoryFn();

  // Add specialized category distance function
  const categoryDistanceFn = SPECIALIZED_CATEGORY_DISTANCE[game.system.id];
  if ( categoryDistanceFn ) SPEED.maximumCategoryDistance = categoryDistanceFn;

  // Add specialized token speed function
  const tokenSpeedFn = SPECIALIZED_TOKEN_SPEED[game.system.id];
  if ( tokenSpeedFn ) SPEED.tokenSpeed = tokenSpeedFn;
});

// ----- NOTE: Attributes ----- //

/**
 * Some of below taken from Drag Ruler
 */

/**
 * Location of the HP attribute for a given system's actor.
 * @returns {string}
 */
export function defaultHPAttribute() {
  switch ( game.system.id ) {
    case "dnd5e":         return "actor.system.attributes.hp.value";
    case "dragonbane":    return "actor.system.hitpoints.value";
    case "twodsix":       return "actor.system.hits.value";
    case "ars":           return "actor.system.attributes.hp.value";
    case "a5e":           return "actor.system.attributes.hp.value";
    case "TheWitcherTRPG": return "actor.system.derivedStats.hp.value";
    default:              return "actor.system.attributes.hp.value";
  }
}

/**
 * Location of the walk attribute for a given system's actor.
 * @returns {string}
 */
export function defaultWalkAttribute() {
  switch ( game.system.id ) {
    case "a5e":           return "actor.system.attributes.movement.walk.distance";
    case "ars":           return "actor.movement";
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
    case "worldofdarkness": return "actor.system.movement.walk";
    case "TheWitcherTRPG": return "actor.system.stats.spd.current";
    default:              return "";
  }
}

/**
 * Location of the flying attribute for a given system's actor.
 * @returns {string}
 */
export function defaultFlyAttribute() {
  switch ( game.system.id ) {
    case "a5e":           return "actor.system.attributes.movement.fly.distance";
    case "sfrpg":         return "actor.system.attributes.flying.value";
    case "dnd5e":         return "actor.system.attributes.movement.fly";
    case "pf1":
    case "D35E":          return "actor.system.attributes.speed.fly.total";
    case "twodsix":       return "actor.system.movement.fly";
    case "worldofdarkness": return "actor.system.movement.fly";
    default:              return "";
  }
}

/**
 * Location of the burrow attribute for a given system's actor.
 * @returns {string}
 */
export function defaultBurrowAttribute() {
  switch ( game.system.id ) {
    case "a5e":           return "actor.system.attributes.movement.burrow.distance";
    case "sfrpg":         return "actor.system.attributes.burrowing.value";
    case "dnd5e":         return "actor.system.attributes.movement.burrow";
    case "pf1":
    case "D35E":          return "actor.system.attributes.speed.burrow.total";
    case "twodsix":       return "actor.system.movement.burrow";
    default:              return "";
  }
}

/**
 * How much faster is dashing than walking for a given system?
 * @returns {number}
 */
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
    case "a5e":
    case "ds4":           return 2;

    case "CoC7":          return 5;
    case "splittermond":  return 3;
    case "wfrp4e":        return 2;

    case "crucible":
    case "swade":         return 0;
    case "TheWitcherTRPG": return 3;
    default:              return 0;
  }
}

// ----- Specialized move categories by system ----- //
/**
 * Dnd5e Level Up (a5e)
 */
function a5eMoveCategories() {
  DashSpeedCategory.name = "Action Dash";
  const BonusDashCategory = {
    name: "Bonus Dash",
    color: Color.from(0xf77926),
    multiplier: 4
  }
  SPEED.CATEGORIES = [WalkSpeedCategory, DashSpeedCategory, BonusDashCategory, MaximumSpeedCategory];
}

/**
 * sfrpg
 */
function sfrpgMoveCategories() {
  WalkSpeedCategory.name = "sfrpg.speeds.walk";
  DashSpeedCategory.name = "sfrpg.speeds.dash";
  const RunSpeedCategory = {
    name: "sfrpg.speeds.run",
    color: Color.from(0xff8000),
    multiplier: 4
  }
  SPEED.CATEGORIES = [WalkSpeedCategory, DashSpeedCategory, RunSpeedCategory, MaximumSpeedCategory];
}

const SPECIALIZED_MOVE_CATEGORIES = {
  a5e: a5eMoveCategories,
  sfrpg: sfrpgMoveCategories
};

// ----- Specialized token speed by system ----- //

/**
 * Given a token, retrieve its base speed.
 * @param {Token} token                   Token whose speed is required
 * @returns {number|null} Distance, in grid units. Null if no speed provided for that category.
 *   (Null will disable speed highlighting.)
 */
function sfrpgTokenSpeed(token) {
  let speed = foundry.utils.getProperty(token, SPEED.ATTRIBUTES[token.movementType]);
  switch ( token.actor?.type ) {
    case "starship": speed = foundry.utils.getProperty(token, "actor.system.attributes.speed.value"); break;
    case "vehicle": speed = foundry.utils.getProperty(token, "actor.system.attributes.speed.drive"); break;
  }
  if ( speed == null ) return null;
  return Number(speed);
}

const SPECIALIZED_TOKEN_SPEED = {
  sfrpg: sfrpgTokenSpeed
};

// ----- Specialized category distances by system ----- //

/**
 * Starfinder (sfrpg)
 * Player Characters, Drones, and Non-player Characters:
 * There are three speed thresholds: single move (speed * 1), double move (speed *2), and run (speed *4)
 * Vehicles: There are three speed thresholds: drive speed, run over speed (drive speed *2), and full speed
 * Starships: There are two speed thresholds: normal speed, and full power (speed * 1.5)

 *
 * @param {Token} token                   Token whose speed should be used
 * @param {SpeedCategory} speedCategory   Category for which the maximum distance is desired
 * @param {number} [tokenSpeed]           Optional token speed to avoid repeated lookups
 * @returns {number}
 */
function sfrpgCategoryDistance(token, speedCategory, tokenSpeed) {
  // Set default speed.
  tokenSpeed ??= SPEED.tokenSpeed(token);
  const type = token.actor?.type;
  let speed = speedCategory.multiplier * tokenSpeed;

  // Override default speed for certain vehicles.
  switch ( speedCategory.name ) {
    case "sfrpg.speeds.dash": {
      if ( type === "starship" ) speed = tokenSpeed * 1.5;
      break;
    }

    case "sfrpg.speeds.run": {
      if ( type === "starship" ) speed = 0;
      if ( type === "vehicle" ) speed = foundry.utils.getProperty(token, "actor.system.attributes.speed.full");
      break;
    }
  }
  return speed;
}

const SPECIALIZED_CATEGORY_DISTANCE = {
  sfrpg: sfrpgCategoryDistance
};



// ----- Note: Licenses / Credits ----- //

/* Drag Ruler
https://github.com/manuelVo/foundryvtt-drag-ruler
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

/* sfrpg
https://github.com/J-Dawe/starfinder-drag-ruler/blob/main/scripts/main.js
MIT License

Copyright (c) 2021 J-Dawe

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
