/* globals
game,
CONST,
canvas
*/
"use strict";

import { MODULE_ID, MODULES_ACTIVE, SPEED } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";

const SETTINGS = {
  CONTROLS: {
    PATHFINDING: "pathfinding-control",
    PREFER_TOKEN_ELEVATION: "prefer-token-elevation",
    PREFER_TOKEN_ELEVATION_CURRENT_VALUE: "prefer-token-elevation-current-value"
  },

  USE_EV: "enable-elevated-vision-elevation",
  USE_TERRAIN: "enable-enhanced-terrain-elevation",
  USE_LEVELS: "enable-levels-elevation",
  USE_LEVELS_LABEL: "levels-use-floor-label",
  LEVELS_LABELS: {
    NEVER: "levels-labels-never",
    UI_ONLY: "levels-labels-ui",
    ALWAYS: "levels-labels-always"
  },
  NO_MODS: "no-modules-message",
  TOKEN_RULER: {
    ENABLED: "enable-token-ruler",
    SPEED_HIGHLIGHTING: "token-ruler-highlighting",
    SPEED_PROPERTY: "token-speed-property",
    TOKEN_MULTIPLIER: "token-terrain-multiplier"
  }
};

const KEYBINDINGS = {
  INCREMENT: "incrementElevation",
  DECREMENT: "decrementElevation",
  TOKEN_RULER: {
    ADD_WAYPOINT: "addWaypointTokenRuler",
    REMOVE_WAYPOINT: "removeWaypointTokenRuler"
  }
};


export class Settings extends ModuleSettingsAbstract {
  /** @type {object} */
  static KEYS = SETTINGS;

  /** @type {object} */
  static KEYBINDINGS = KEYBINDINGS;

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, register, localize } = this;

    if ( !MODULES_ACTIVE.ELEVATED_VISION
      && !MODULES_ACTIVE.ENHANCED_TERRAINLAYER
      && !MODULES_ACTIVE.LEVELS ) {
      register(KEYS.NO_MODS, {
        name: localize(`${KEYS.NO_MODS}.name`),
        hint: localize(`${KEYS.NO_MODS}.hint`),
        scope: "world",
        config: true,
        enabled: false,
        default: true,
        type: Boolean
      });
    }

    register(KEYS.USE_EV, {
      name: localize(`${KEYS.USE_EV}.name`),
      hint: localize(`${KEYS.USE_EV}.hint`),
      scope: "world",
      config: MODULES_ACTIVE.ELEVATED_VISION,
      default: MODULES_ACTIVE.ELEVATED_VISION,
      type: Boolean
    });

    register(KEYS.USE_TERRAIN, {
      name: localize(`${KEYS.USE_TERRAIN}.name`),
      hint: localize(`${KEYS.USE_TERRAIN}.hint`),
      scope: "world",
      config: MODULES_ACTIVE.ENHANCED_TERRAIN_LAYER,
      default: MODULES_ACTIVE.ENHANCED_TERRAIN_LAYER,
      type: Boolean
    });

    register(KEYS.USE_LEVELS, {
      name: localize(`${KEYS.USE_LEVELS}.name`),
      hint: localize(`${KEYS.USE_LEVELS}.hint`),
      scope: "world",
      config: MODULES_ACTIVE.LEVELS,
      default: MODULES_ACTIVE.LEVELS,
      type: Boolean
    });

    register(KEYS.USE_LEVELS_LABEL, {
      name: localize(`${KEYS.USE_LEVELS_LABEL}.name`),
      hint: localize(`${KEYS.USE_LEVELS_LABEL}.hint`),
      scope: "world",
      config: MODULES_ACTIVE.LEVELS,
      default: KEYS.LEVELS_LABELS.ALWAYS,
      type: String,
      choices: {
        [KEYS.LEVELS_LABELS.NEVER]: game.i18n.localize(`${KEYS.LEVELS_LABELS.NEVER}`),
        [KEYS.LEVELS_LABELS.UI_ONLY]: game.i18n.localize(`${KEYS.LEVELS_LABELS.UI_ONLY}`),
        [KEYS.LEVELS_LABELS.ALWAYS]: game.i18n.localize(`${KEYS.LEVELS_LABELS.ALWAYS}`)
      }
    });

    register(KEYS.CONTROLS.PREFER_TOKEN_ELEVATION, {
      name: localize(`${KEYS.CONTROLS.PREFER_TOKEN_ELEVATION}.name`),
      hint: localize(`${KEYS.CONTROLS.PREFER_TOKEN_ELEVATION}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false,
      onChange: reloadTokenControls
    });

    register(KEYS.CONTROLS.PREFER_TOKEN_ELEVATION_CURRENT_VALUE, {
      scope: "user",
      config: false,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.CONTROLS.PATHFINDING, {
      scope: "user",
      config: false,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    // ----- NOTE: Token ruler ----- //
    register(KEYS.TOKEN_RULER.ENABLED, {
      name: localize(`${KEYS.TOKEN_RULER.ENABLED}.name`),
      hint: localize(`${KEYS.TOKEN_RULER.ENABLED}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.TOKEN_RULER.SPEED_HIGHLIGHTING, {
      name: localize(`${KEYS.TOKEN_RULER.SPEED_HIGHLIGHTING}.name`),
      hint: localize(`${KEYS.TOKEN_RULER.SPEED_HIGHLIGHTING}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.TOKEN_RULER.SPEED_PROPERTY, {
      name: localize(`${KEYS.TOKEN_RULER.SPEED_PROPERTY}.name`),
      hint: localize(`${KEYS.TOKEN_RULER.SPEED_PROPERTY}.hint`),
      scope: "world",
      config: true,
      default: SPEED.ATTRIBUTE,
      type: String,
      onChange: value => this.setSpeedProperty(value)
    });

    register(KEYS.TOKEN_RULER.TOKEN_MULTIPLIER, {
      name: localize(`${KEYS.TOKEN_RULER.TOKEN_MULTIPLIER}.name`),
      hint: localize(`${KEYS.TOKEN_RULER.TOKEN_MULTIPLIER}.hint`),
      scope: "world",
      config: true,
      default: 1,
      type: Number,
      range: {
        max: 10,
        min: 0,
        step: 0.1
      }
    });

    // Initialize the Token Ruler.
    this.setSpeedProperty(this.get(KEYS.TOKEN_RULER.SPEED_PROPERTY));
  }

  static registerKeybindings() {
    game.keybindings.register(MODULE_ID, KEYBINDINGS.DECREMENT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.hint`),
      editable: [
        { key: "BracketLeft" }
      ],
      onDown: () => canvas.controls.ruler.decrementElevation(),
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.INCREMENT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.INCREMENT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.INCREMENT}.hint`),
      editable: [
        { key: "BracketRight" }
      ],
      onDown: () => canvas.controls.ruler.incrementElevation(),
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.TOKEN_RULER.ADD_WAYPOINT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.ADD_WAYPOINT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.ADD_WAYPOINT}.hint`),
      editable: [
        { key: "=" }
      ],
      onDown: context => toggleTokenRulerWaypoint(context, true),
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.TOKEN_RULER.REMOVE_WAYPOINT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.REMOVE_WAYPOINT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.REMOVE_WAYPOINT}.hint`),
      editable: [
        { key: "-" }
      ],
      onDown: context => toggleTokenRulerWaypoint(context, false),
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });
  }

  static setSpeedProperty(value) { SPEED.ATTRIBUTE = value; }
}

/**
 * Force a reload of token controls layer.
 * Used to force the added control to appear/disappear.
 */
function reloadTokenControls() {
  if ( !canvas.tokens.active ) return;
  canvas.tokens.deactivate();
  canvas.tokens.activate();
}

/**
 * Add or remove a waypoint to the ruler, only if we are using the Token Ruler.
 * @param {KeyboardEventContext} context          The context data of the event
 * @param {boolean} [add=true]                    Whether to add or remove the waypoint
 */
let MOVE_TIME = 0;
function toggleTokenRulerWaypoint(context, add = true) {
  const position = canvas.mousePosition;
  const ruler = canvas.controls.ruler;
  if ( !canvas.tokens.active || !ruler || !ruler.active ) return;
  // console.debug(`${add ? "add" : "remove"}TokenRulerWaypoint`);

  // Keep track of when we last added/deleted a waypoint.
  const now = Date.now();
  const delta = now - MOVE_TIME;
  if ( delta < 100 ) return true; // Throttle keyboard movement once per 100ms
  MOVE_TIME = now;

  // console.debug(`${add ? "adding" : "removing"}TokenRulerWaypoint`);
  if ( add ) ruler._addWaypoint(position);
  else if ( ruler.waypoints.length > 1 ) ruler._removeWaypoint(position); // Removing the last waypoint throws errors.
}

