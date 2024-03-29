/* globals
Color,
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

export const DIAGONAL_RULES = {
  EUCL: 0,
  555: 1,
  5105: 2,
  MANHATTAN: 3
};


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

export const SPEED = {
  ATTRIBUTES: { WALK: "", BURROW: "", FLY: ""},
  MULTIPLIER: 0,
  TYPES: {
    WALK: 0,
    DASH: 1,
    MAXIMUM: -1
  },
  COLORS: {
    WALK: Color.from(0x00ff00),
    DASH: Color.from(0xffff00),
    MAXIMUM: Color.from(0xff0000)
  },

  // Use Font Awesome font unicode instead of basic unicode for displaying terrain symbol.
  useFontAwesome: false, // Set to true to use Font Awesome unicode
  terrainSymbol: "🥾"  // For Font Awesome, https://fontawesome.com/icons/bolt?f=classic&s=solid would be "\uf0e7".
};

// Add the inversions for lookup
SPEED.COLORS[SPEED.TYPES.WALK] = SPEED.COLORS.WALK;
SPEED.COLORS[SPEED.TYPES.DASH] = SPEED.COLORS.DASH;
SPEED.COLORS[SPEED.TYPES.MAXIMUM] = SPEED.COLORS.MAXIMUM;

// Avoid testing for the system id each time.
Hooks.once("init", function() {
  SPEED.ATTRIBUTES.WALK = defaultWalkAttribute();
  SPEED.ATTRIBUTES.BURROW = defaultBurrowAttribute();
  SPEED.ATTRIBUTES.FLY = defaultFlyAttribute();
  SPEED.MULTIPLIER = defaultDashMultiplier();
});

export function defaultWalkAttribute() {
  switch (game.system.id) {
    case "CoC7":
      return "actor.system.attribs.mov.value";
    case "dcc":
      return "actor.system.attributes.speed.value";
    case "sfrpg":
      return "actor.system.attributes.speed.value";
    case "dnd4e":
      return "actor.system.movement.walk.value";
    case "dnd5e":
      return "actor.system.attributes.movement.walk";
    case "lancer":
      return "actor.system.derived.speed";
    case "pf1":
    case "D35E":
      return "actor.system.attributes.speed.land.total";
    case "shadowrun5e":
      return "actor.system.movement.walk.value";
    case "swade":
      return "actor.system.stats.speed.adjusted";
    case "ds4":
      return "actor.system.combatValues.movement.total";
    case "splittermond":
      return "actor.derivedValues.speed.value";
    case "wfrp4e":
      return "actor.system.details.move.walk";
    case "crucible":
      return "actor.system.movement.stride";
  }
  return "";
}

export function defaultFlyAttribute() {
  switch (game.system.id) {
    // Missing attribute case "CoC7":
    // Missing attribute case "dcc":
    case "sfrpg":
      return "actor.system.attributes.flying.value";
    // Missing attribute case "dnd4e":
    case "dnd5e":
      return "actor.system.attributes.movement.fly";
    // Missing attribute case "lancer":
    case "pf1":
    case "D35E":
      return "actor.system.attributes.speed.fly.total";
    // Missing attribute case "shadowrun5e":
    // Missing attribute case "swade":
    // Missing attribute case "ds4":
    // Missing attribute case "splittermond":
    // Missing attribute case "wfrp4e":
    // Missing attribute case "crucible":
  }
  return "";
}

export function defaultBurrowAttribute() {
  switch (game.system.id) {
    // Missing attribute case "CoC7":
    // Missing attribute case "dcc":
    case "sfrpg":
      return "actor.system.attributes.burrowing.value";
    // Missing attribute case "dnd4e":
    case "dnd5e":
      return "actor.system.attributes.movement.burrow";
    // Missing attribute case "lancer":
    case "pf1":
    case "D35E":
      return "actor.system.attributes.speed.burrow.total";
    // Missing attribute case "shadowrun5e":
    // Missing attribute case "swade":
    // Missing attribute case "ds4":
    // Missing attribute case "splittermond":
    // Missing attribute case "wfrp4e":
    // Missing attribute case "crucible":
  }
  return "";
}

export function defaultDashMultiplier() {
  switch (game.system.id) {
    case "dcc":
    case "dnd4e":
    case "dnd5e":
    case "lancer":
    case "pf1":
    case "D35E":
    case "sfrpg":
    case "shadowrun5e":
    case "ds4":
      return 2;
    case "CoC7":
      return 5;
    case "splittermond":
      return 3;
    case "wfrp4e":
      return 2;
    case "crucible":
    case "swade":
      return 0;
  }
  return 0;
}
