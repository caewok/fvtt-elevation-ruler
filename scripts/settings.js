/* globals
game,
CONST,
canvas
*/
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { PATCHER } from "./patching.js";

const SETTINGS = {
  PREFER_TOKEN_ELEVATION: "prefer-token-elevation",
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
  PREFER_TOKEN_ELEVATION_CURRENT_VALUE: "prefer-token-elevation-current-value",
  TOKEN_RULER: {
    ENABLED: "enable-token-ruler",
    RANGE_COLORS: "enable-token-ruler-colors"
  }
};

const KEYBINDINGS = {
  INCREMENT: "incrementElevation",
  DECREMENT: "decrementElevation"
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

    register(KEYS.PREFER_TOKEN_ELEVATION, {
      name: localize(`${KEYS.PREFER_TOKEN_ELEVATION}.name`),
      hint: localize(`${KEYS.PREFER_TOKEN_ELEVATION}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false,
      onChange: reloadTokenControls
    });

    register(KEYS.PREFER_TOKEN_ELEVATION_CURRENT_VALUE, {
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
      requiresReload: false,
      onChange: value => this.toggleTokenRuler(value)
    });

    // Initialize the Token Ruler.
    if ( this.get(KEYS.TOKEN_RULER.ENABLED) ) this.toggleTokenRuler(true);

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
  }

  static toggleTokenRuler(value) {
    if ( value ) PATCHER.registerGroup("TOKEN_RULER");
    else PATCHER.deregisterGroup("TOKEN_RULER");
  }
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
