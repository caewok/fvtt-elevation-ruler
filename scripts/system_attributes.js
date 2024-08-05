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
  const moveCategoryFn = SPECIALIZED_SPEED_CATEGORIES[game.system.id];
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
    case "gurps":         return "actor.system.HP.value";
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
    case "gurps":         return "actor.system.currentmove";
    case "pf1":
    case "D35E":          return "actor.system.attributes.speed.land.total";
    case "shadowrun5e":   return "actor.system.movement.walk.value";
    case "swade":         return "actor.system.stats.speed.adjusted";
    case "ds4":           return "actor.system.combatValues.movement.total";
    case "splittermond":  return "actor.derivedValues.speed.value";
    case "wfrp4e":        return "actor.system.details.move.walk";
    case "crucible":      return "actor.system.movement.stride";
    case "dragonbane":    return "actor.system.movement.value";
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
    case "gurps":         return "actor.system.currentflight";
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
    case "gurps":         return 1.2;

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
function a5eSpeedCategories() {
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
function sfrpgSpeedCategories() {
  WalkSpeedCategory.name = "sfrpg.speeds.walk";
  DashSpeedCategory.name = "sfrpg.speeds.dash";
  const RunSpeedCategory = {
    name: "sfrpg.speeds.run",
    color: Color.from(0xff8000),
    multiplier: 4
  }
  SPEED.CATEGORIES = [WalkSpeedCategory, DashSpeedCategory, RunSpeedCategory, MaximumSpeedCategory];
}

/**
 * pf2e
 * See https://github.com/7H3LaughingMan/pf2e-elevation-ruler/blob/main/scripts/module.js
 */
function pf2eSpeedCategories() {
  const SingleAction = {
      name: "Single Action",
      color: Color.from("#3222C7"),
      multiplier: 1
  }

  const DoubleAction = {
      name: "Double Action",
      color: Color.from("#FFEC07"),
      multiplier: 2
  }

  const TripleAction = {
      name: "Triple Action",
      color: Color.from("#C033E0"),
      multiplier: 3
  }

  const QuadrupleAction = {
      name: "Quadruple Action",
      color: Color.from("#1BCAD8"),
      multiplier: 4
  }

  const Unreachable = {
      name: "Unreachable",
      color: Color.from("#FF0000"),
      multiplier: Number.POSITIVE_INFINITY
  }

  SPEED.CATEGORIES = [SingleAction, DoubleAction, TripleAction, QuadrupleAction, Unreachable];
}


const SPECIALIZED_SPEED_CATEGORIES = {
  a5e: a5eSpeedCategories,
  sfrpg: sfrpgSpeedCategories,
  pf2e: pf2eSpeedCategories
};

// ----- Specialized token speed by system ----- //

/**
 * sfrpg
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

/**
 * pf2e
 * See https://github.com/7H3LaughingMan/pf2e-elevation-ruler/blob/main/scripts/module.js
 * Finds walk, fly, burrow values.
 * @param {Token} token                   Token whose speed is required
 * @returns {number|null} Distance, in grid units. Null if no speed provided for that category.
 */
function pf2eTokenSpeed(token) {
  const tokenSpeed = token.actor.system.attributes.speed;
  let speed = null;
  switch (token.movementType) {
    case 'WALK': speed = tokenSpeed.total; break;
    case 'FLY': {
      const flySpeed = tokenSpeed.otherSpeeds.find(x => x.type == "fly");
      if ( typeof flySpeed !== "undefined" ) speed = flySpeed.total;
      break;
    }
    case 'BURROW': {
      const burrowSpeed = tokenSpeed.otherSpeeds.find(x => x.type == "burrow");
      if ( typeof burrowSpeed !== "undefined" ) speed = burrowSpeed.total;
      break;
    }
  };
  if (speed === null) return null;
  return Number(speed);
}

const SPECIALIZED_TOKEN_SPEED = {
  sfrpg: sfrpgTokenSpeed,
  pf2e: pf2eTokenSpeed
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

/**
 * Warhammer 4e (wfrpg43)
 * See https://github.com/caewok/fvtt-elevation-ruler/issues/113
 * Use the system-calculated run value.
 * @param {Token} token                   Token whose speed should be used
 * @param {SpeedCategory} speedCategory   Category for which the maximum distance is desired
 * @param {number} [tokenSpeed]           Optional token speed to avoid repeated lookups
 * @returns {number}
 */
function wfrp4eCategoryDistance(token, speedCategory, tokenSpeed) {
  if ( speedCategory.name === "Dash" ) return foundry.utils.getProperty(token, "actor.system.details.move.run");
  return tokenSpeed;
}

/**
 * Pathfinder 2e (pf2e)
 * See https://github.com/7H3LaughingMan/pf2e-elevation-ruler/blob/main/scripts/module.js
 * Speed is based on action count in pf2e.
 * @param {Token} token                   Token whose speed should be used
 * @param {SpeedCategory} speedCategory   Category for which the maximum distance is desired
 * @param {number} [tokenSpeed]           Optional token speed to avoid repeated lookups
 * @returns {number}
 */
function pf2eCategoryDistance(token, speedCategory, tokenSpeed) {
  tokenSpeed ??= SPEED.tokenSpeed(token);
  const actionCount = getActionCount(token);
  switch (speedCategory.name) {
    case "Single Action": return ((actionCount >= 1) ? speedCategory.multiplier * tokenSpeed : 0);
    case "Double Action": return ((actionCount >= 2) ? speedCategory.multiplier * tokenSpeed : 0);
    case "Triple Action": return ((actionCount >= 3) ? speedCategory.multiplier * tokenSpeed : 0);
    case "Quadruple Action": return ((actionCount >= 4) ? speedCategory.multiplier * tokenSpeed : 0);
  }
  return Number.POSITIVE_INFINITY;
}

const SPECIALIZED_CATEGORY_DISTANCE = {
  sfrpg: sfrpgCategoryDistance,
  wfrp4e: wfrp4eCategoryDistance,
  pf2e: pf2eCategoryDistance
};


// ----- NOTE: Helper functions ----- //
/**
 * Pathfinder 2e (pf2e)
 * See https://github.com/7H3LaughingMan/pf2e-elevation-ruler/blob/main/scripts/action.js
 * Determine how many actions the token has remaining.
 * @param {Token} token
 * @returns {number}
 */
function getActionCount(token) {
  // Get the token's actor
  const actor = token.actor;
  if ( !actor ) return 0;

  // Check to see if the actor is immobilized, paralyzed, petrified, or unconscious. If so they have 0 actions.
  if ( actor.hasCondition("immobilized", "paralyzed", "petrified", "unconscious") ) return 0;

  // Determine the actor's maximum number of actions.
  const maxActions = (actor.traits?.has("minion") ? 2 : 3) + (actor.hasCondition("quickened") ? 1 : 0);

  // Check to see if there is an encounter, if that encounter is active, and if the token is in that encounter
  if ( game.combat == null
    || !game.combat.active
    || (game.combat.turns.find(x => x.tokenId == token.id) == null) ) return maxActions;

  // Check to see if the actor is stunned or slowed, and if so the value
  const stunned = actor.getCondition("stunned")?.value ?? 0;
  const slowed = actor.getCondition("slowed")?.value ?? 0;

  // This is for PF2e Workbench, used to store how much stun is auto reduced by
  // Check to see if PF2e Workbench is active and if Auto Reduce Stunned is enabled
  let reduction = 0;
  if ( game.modules.get("xdy-pf2e-workbench")?.active && game.settings.get("xdy-pf2e-workbench", "autoReduceStunned") ) {
      const stunReduction = actor.getFlag("xdy-pf2e-workbench", "stunReduction");

      // Make sure we actually got something and the combat matches.
      if ( stunReduction &&  stunReduction.combat == game.combat.id ) {
        // We are going to check to see if the combatant's last round matches the stun reduction round
        // Note - A combatant's last round is updated at the start of their turn
        const combatant = game.combat.turns.find(x => x.tokenId == token.id);
        if ( combatant && combatant.roundOfLastTurn == stunReduction.round ) reduction = stunReduction.reducedBy;
      }
  }

  // Return the token's maximum number of actions minus the greater of their stunned, slowed, or stun reduction.
  // If it's below 0 we will return 0
  return Math.max(maxActions - Math.max(stunned, slowed, reduction), 0);
}

// ----- NOTE: Licenses / Credits ----- //

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

/* PF2e Elevation Ruler
MIT License

Copyright (c) 2024 7H3LaughingMan

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
