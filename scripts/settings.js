/* globals
game,
CONST,
canvas
*/
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { log } from "./util.js";
import { SCENE_GRAPH } from "./pathfinding/WallTracer.js";
import { Pathfinder } from "./pathfinding/pathfinding.js";
import { PATCHER } from "./patching.js";
import { BorderEdge } from "./pathfinding/BorderTriangle.js";

const SETTINGS = {
  CONTROLS: {
    PATHFINDING: "pathfinding-control",
    PREFER_TOKEN_ELEVATION: "prefer-token-elevation",
    PREFER_TOKEN_ELEVATION_CURRENT_VALUE: "prefer-token-elevation-current-value"
  },

  PATHFINDING: {
    TOKENS_BLOCK: "pathfinding_tokens_block",
    TOKENS_BLOCK_CHOICES: {
      NO: "pathfinding_tokens_block_no",
      HOSTILE: "pathfinding_tokens_block_hostile",
      ALL: "pathfinding_tokens_block_all"
    },
    LIMIT_TOKEN_LOS: "pathfinding_limit_token_los"
  },

  USE_LEVELS_LABEL: "levels-use-floor-label",
  LEVELS_LABELS: {
    NEVER: "levels-labels-never",
    UI_ONLY: "levels-labels-ui",
    ALWAYS: "levels-labels-always"
  },

  NO_MODS: "no-modules-message",
  TOKEN_RULER: {
    ENABLED: "enable-token-ruler",
    ROUND_TO_MULTIPLE: "round-to-multiple",
    SPEED_HIGHLIGHTING: "token-ruler-highlighting",
    TOKEN_MULTIPLIER: "token-terrain-multiplier",
    COMBAT_HISTORY: "token-ruler-combat-history"
  },

  GRID_TERRAIN: {
    ALGORITHM: "grid-terrain-algorithm",
    CHOICES: {
      CENTER: "grid-terrain-choice-center-point",
      PERCENT: "grid-terrain-choice-percent-area",
      EUCLIDEAN: "grid-terrain-choice-euclidean"
    },
    AREA_THRESHOLD: "grid-terrain-area-threshold"
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

    register(KEYS.USE_LEVELS_LABEL, {
      name: localize(`${KEYS.USE_LEVELS_LABEL}.name`),
      hint: localize(`${KEYS.USE_LEVELS_LABEL}.hint`),
      scope: "world",
      config: MODULES_ACTIVE.LEVELS,
      default: KEYS.LEVELS_LABELS.ALWAYS,
      type: String,
      choices: {
        [KEYS.LEVELS_LABELS.NEVER]: localize(`${KEYS.LEVELS_LABELS.NEVER}`),
        [KEYS.LEVELS_LABELS.UI_ONLY]: localize(`${KEYS.LEVELS_LABELS.UI_ONLY}`),
        [KEYS.LEVELS_LABELS.ALWAYS]: localize(`${KEYS.LEVELS_LABELS.ALWAYS}`)
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

    // ----- NOTE: Pathfinding ----- //

    register(KEYS.CONTROLS.PATHFINDING, {
      scope: "user",
      config: false,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.PATHFINDING.TOKENS_BLOCK, {
      name: localize(`${KEYS.PATHFINDING.TOKENS_BLOCK}.name`),
      hint: localize(`${KEYS.PATHFINDING.TOKENS_BLOCK}.hint`),
      scope: "user",
      config: true,
      default: KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.NO,
      type: String,
      requiresReload: false,
      choices: {
        [KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.NO]: localize(`${KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.NO}`),
        [KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.HOSTILE]: localize(`${KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.HOSTILE}`),
        [KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.ALL]: localize(`${KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.ALL}`)
      },
      onChange: value => this.toggleTokenBlocksPathfinding(value)
    });

    register(KEYS.PATHFINDING.LIMIT_TOKEN_LOS, {
      name: localize(`${KEYS.PATHFINDING.LIMIT_TOKEN_LOS}.name`),
      hint: localize(`${KEYS.PATHFINDING.LIMIT_TOKEN_LOS}.hint`),
      scope: "world",
      config: true,
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

    register(KEYS.TOKEN_RULER.COMBAT_HISTORY, {
      name: localize(`${KEYS.TOKEN_RULER.COMBAT_HISTORY}.name`),
      hint: localize(`${KEYS.TOKEN_RULER.COMBAT_HISTORY}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE, {
      name: localize(`${KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE}.name`),
      hint: localize(`${KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE}.hint`),
      scope: "world",
      config: true,
      default: 0,
      type: Number
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

    // ----- NOTE: Grid Terrain Measurement ----- //
    register(KEYS.GRID_TERRAIN.ALGORITHM, {
      name: localize(`${KEYS.GRID_TERRAIN.ALGORITHM}.name`),
      hint: localize(`${KEYS.GRID_TERRAIN.ALGORITHM}.hint`),
      scope: "world",
      config: true,
      default: KEYS.GRID_TERRAIN.CHOICES.CENTER,
      type: String,
      choices: {
        [KEYS.GRID_TERRAIN.CHOICES.CENTER]: localize(`${KEYS.GRID_TERRAIN.CHOICES.CENTER}`),
        [KEYS.GRID_TERRAIN.CHOICES.PERCENT]: localize(`${KEYS.GRID_TERRAIN.CHOICES.PERCENT}`),
        [KEYS.GRID_TERRAIN.CHOICES.EUCLIDEAN]: localize(`${KEYS.GRID_TERRAIN.CHOICES.EUCLIDEAN}`)
      }
    });

    register(KEYS.GRID_TERRAIN.AREA_THRESHOLD, {
      name: localize(`${KEYS.GRID_TERRAIN.AREA_THRESHOLD}.name`),
      hint: localize(`${KEYS.GRID_TERRAIN.AREA_THRESHOLD}.hint`),
      scope: "world",
      config: true,
      default: 0.5,
      type: Number,
      range: {
        min: 0.1,
        max: 1,
        step: 0.1
      }
    });
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

  static toggleTokenBlocksPathfinding(blockSetting) {
    const C = this.KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES;
    blockSetting ??= Settings.get(Settings.KEYS.PATHFINDING.TOKENS_BLOCK);
    if ( blockSetting === C.NO ) { // Disable
      PATCHER.deregisterGroup("PATHFINDING_TOKENS");
      SCENE_GRAPH.tokenIds.forEach(id => SCENE_GRAPH.removeToken(id));
    } else { // Enable
      PATCHER.registerGroup("PATHFINDING_TOKENS");
      for ( const token of canvas.tokens.placeables ) SCENE_GRAPH.addToken(token);
    }
    BorderEdge.tokenBlockType = this._tokenBlockType(blockSetting);
    Pathfinder.dirty = true;
  }

  static _tokenBlockType(blockSetting) {
    const C = this.KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES;
    const D = CONST.TOKEN_DISPOSITIONS;
    blockSetting ??= this.get(this.KEYS.PATHFINDING.TOKENS_BLOCK);
    return blockSetting === C.NO ? D.NEUTRAL
      : blockSetting === C.HOSTILE ? D.HOSTILE
        : D.SECRET;
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
  log(`${add ? "add" : "remove"}TokenRulerWaypoint`);

  // Keep track of when we last added/deleted a waypoint.
  const now = Date.now();
  const delta = now - MOVE_TIME;
  if ( delta < 100 ) return true; // Throttle keyboard movement once per 100ms
  MOVE_TIME = now;

  log(`${add ? "adding" : "removing"}TokenRulerWaypoint`);
  if ( add ) ruler._addWaypoint(position);
  else if ( ruler.waypoints.length > 1 ) ruler._removeWaypoint(position); // Removing the last waypoint throws errors.
}

