/* globals
game,
CONST,
canvas,
Ruler,
ui
*/
"use strict";

import { MODULE_ID, OTHER_MODULES } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { log } from "./util.js";
import { Pathfinder } from "./pathfinding/pathfinding.js";
import { PATCHER } from "./patching.js";
import { BorderEdge } from "./pathfinding/BorderTriangle.js";
import { updatePathfindingControl } from "./module.js";
import { registerSceneGraph, deRegisterSceneGraph } from "./geometry/registration.js";

const SETTINGS = {
  CONTROLS: {
    PATHFINDING: "pathfinding-control"
  },

  PATHFINDING: {
    ENABLE: "pathfinding_enable",
    TOKENS_BLOCK: "pathfinding_tokens_block",
    TOKENS_BLOCK_CHOICES: {
      NO: "pathfinding_tokens_block_no",
      HOSTILE: "pathfinding_tokens_block_hostile",
      ALL: "pathfinding_tokens_block_all"
    },
    LIMIT_TOKEN_LOS: "pathfinding_limit_token_los",
    SNAP_TO_GRID: "pathfinding_snap_to_grid"
  },

  LABELING: {
    HIDE_ELEVATION: "hide-elevation-ruler",
    ROUND_TO_MULTIPLE: "round-to-multiple",
    USE_LEVELS_LABEL: "levels-use-floor-label",
    LEVELS_LABELS: {
      NEVER: "levels-labels-never",
      UI_ONLY: "levels-labels-ui",
      ALWAYS: "levels-labels-always"
    },
    CUSTOMIZED: "customized-labels",
    SCALE_TEXT: "scale-text"
  },

  MEASURING: {
    EUCLIDEAN_GRID_DISTANCE: "euclidean-grid-distance",
    AUTO_MOVEMENT_TYPE: "automatic-movement-type",
    COMBAT_HISTORY: "token-ruler-combat-history",
    FORCE_GRID_PENALTIES: "force-grid-penalties",
    TOKEN_MULTIPLIER: "token-terrain-multiplier",
    TOKEN_MULTIPLIER_FLAT: "token-terrain-multiplier-flat"
  },

  NO_MODS: "no-modules-message",
  TOKEN_RULER: {
    ENABLED: "enable-token-ruler",
    HIDE_GM: "hide-gm-ruler",

  },

  SPEED_HIGHLIGHTING: {
    DEPRECATED_ENABLED: "token-ruler-highlighting", // Old boolean setting for whether to enable speed highlighting.
    CHOICE: "speed-highlighting-choice", // New multiple-choice for enabling speed highlighting.
    NO_HOSTILES: "speed-highlighting-no-hostiles",
    CHOICES: {
      NEVER: "speed-highlighting-choice-never",
      COMBAT: "speed-highlighting-choice-combat",
      ALWAYS: "speed-highlighting-choice-always"
    }
  },

  //   GRID_TERRAIN: {
  //     ALGORITHM: "grid-terrain-algorithm",
  //     CHOICES: {
  //       CENTER: "grid-terrain-choice-center-point",
  //       PERCENT: "grid-terrain-choice-percent-area",
  //       EUCLIDEAN: "grid-terrain-choice-euclidean"
  //     },
  //     AREA_THRESHOLD: "grid-terrain-area-threshold"
  //   },

};

const KEYBINDINGS = {
  INCREMENT: "incrementElevation",
  DECREMENT: "decrementElevation",
  ADD_WAYPOINT: "addWaypoint",
  REMOVE_WAYPOINT: "removeWaypoint",
  TOKEN_RULER: {
    ADD_WAYPOINT: "addWaypointTokenRuler",
    REMOVE_WAYPOINT: "removeWaypointTokenRuler"
  },
  TOGGLE_PATHFINDING: "togglePathfinding",
  FORCE_TO_GROUND: "forceToGround",
  TELEPORT: "teleport"
};


export class Settings extends ModuleSettingsAbstract {
  /** @type {object} */
  static KEYS = SETTINGS;

  /** @type {object} */
  static KEYBINDINGS = KEYBINDINGS;

  /** @type {boolean} */
  static FORCE_TOGGLE_PATHFINDING = false;

  /** @type {boolean} */
  static FORCE_TO_GROUND = false;

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, register, localize } = this;

    register(KEYS.LABELING.USE_LEVELS_LABEL, {
      name: localize(`${KEYS.LABELING.USE_LEVELS_LABEL}.name`),
      hint: localize(`${KEYS.LABELING.USE_LEVELS_LABEL}.hint`),
      scope: "world",
      config: OTHER_MODULES.LEVELS.ACTIVE,
      default: KEYS.LABELING.LEVELS_LABELS.ALWAYS,
      type: String,
      choices: {
        [KEYS.LABELING.LEVELS_LABELS.NEVER]: localize(`${KEYS.LABELING.LEVELS_LABELS.NEVER}`),
        [KEYS.LABELING.LEVELS_LABELS.UI_ONLY]: localize(`${KEYS.LABELING.LEVELS_LABELS.UI_ONLY}`),
        [KEYS.LABELING.LEVELS_LABELS.ALWAYS]: localize(`${KEYS.LABELING.LEVELS_LABELS.ALWAYS}`)
      }
    });

    // ----- NOTE: Pathfinding ----- //

    register(KEYS.CONTROLS.PATHFINDING, {
      scope: "user",
      config: false,
      default: true,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.PATHFINDING.ENABLE, {
      name: localize(`${KEYS.PATHFINDING.ENABLE}.name`),
      hint: localize(`${KEYS.PATHFINDING.ENABLE}.hint`),
      scope: "user",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false,
      onChange: value => this.togglePathfinding(value)
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
      onChange: value => this.setTokenBlocksPathfinding(value)
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

    register(KEYS.PATHFINDING.SNAP_TO_GRID, {
      name: localize(`${KEYS.PATHFINDING.SNAP_TO_GRID}.name`),
      hint: localize(`${KEYS.PATHFINDING.SNAP_TO_GRID}.hint`),
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

    register(KEYS.TOKEN_RULER.HIDE_GM, {
      name: localize(`${KEYS.TOKEN_RULER.HIDE_GM}.name`),
      hint: localize(`${KEYS.TOKEN_RULER.HIDE_GM}.hint`),
      scope: "world",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    // Previously SPEED_HIGHLIGHTING was a boolean. If false, set to Never. Otherwise set to always.
    const prevSpeedHighlightSetting = this._getStorageValue(KEYS.SPEED_HIGHLIGHTING.DEPRECATED_ENABLED, "client");
    const speedHighlightingDefault = prevSpeedHighlightSetting === "false"
      ? KEYS.SPEED_HIGHLIGHTING.CHOICES.NEVER : KEYS.SPEED_HIGHLIGHTING.CHOICES.ALWAYS;

    register(KEYS.SPEED_HIGHLIGHTING.CHOICE, {
      name: localize(`${KEYS.SPEED_HIGHLIGHTING.CHOICE}.name`),
      hint: localize(`${KEYS.SPEED_HIGHLIGHTING.CHOICE}.hint`),
      scope: "user",
      config: true,
      default: speedHighlightingDefault,
      type: String,
      choices: {
        [KEYS.SPEED_HIGHLIGHTING.CHOICES.NEVER]: localize(`${KEYS.SPEED_HIGHLIGHTING.CHOICES.NEVER}`),
        [KEYS.SPEED_HIGHLIGHTING.CHOICES.COMBAT]: localize(`${KEYS.SPEED_HIGHLIGHTING.CHOICES.COMBAT}`),
        [KEYS.SPEED_HIGHLIGHTING.CHOICES.ALWAYS]: localize(`${KEYS.SPEED_HIGHLIGHTING.CHOICES.ALWAYS}`)
      },
      requiresReload: false
    });

    register(KEYS.SPEED_HIGHLIGHTING.NO_HOSTILES, {
      name: localize(`${KEYS.SPEED_HIGHLIGHTING.NO_HOSTILES}.name`),
      hint: localize(`${KEYS.SPEED_HIGHLIGHTING.NO_HOSTILES}.hint`),
      scope: "world",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.MEASURING.COMBAT_HISTORY, {
      name: localize(`${KEYS.MEASURING.COMBAT_HISTORY}.name`),
      hint: localize(`${KEYS.MEASURING.COMBAT_HISTORY}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    if ( game.system.id === "dnd5e" ) {
      register(KEYS.MEASURING.AUTO_MOVEMENT_TYPE, {
        name: localize(`${KEYS.MEASURING.AUTO_MOVEMENT_TYPE}.name`),
        hint: localize(`${KEYS.MEASURING.AUTO_MOVEMENT_TYPE}.hint`),
        scope: "user",
        config: true,
        default: true,
        type: Boolean,
        requiresReload: false
      });
    }

    register(KEYS.MEASURING.EUCLIDEAN_GRID_DISTANCE, {
      name: localize(`${KEYS.MEASURING.EUCLIDEAN_GRID_DISTANCE}.name`),
      hint: localize(`${KEYS.MEASURING.EUCLIDEAN_GRID_DISTANCE}.hint`),
      scope: "world",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.LABELING.SCALE_TEXT, {
      name: localize(`${KEYS.LABELING.SCALE_TEXT}.name`),
      hint: localize(`${KEYS.LABELING.SCALE_TEXT}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.LABELING.CUSTOMIZED, {
      name: localize(`${KEYS.LABELING.CUSTOMIZED}.name`),
      hint: localize(`${KEYS.LABELING.CUSTOMIZED}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.LABELING.HIDE_ELEVATION, {
      name: localize(`${KEYS.LABELING.HIDE_ELEVATION}.name`),
      hint: localize(`${KEYS.LABELING.HIDE_ELEVATION}.hint`),
      scope: "user",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    register(KEYS.LABELING.ROUND_TO_MULTIPLE, {
      name: localize(`${KEYS.LABELING.ROUND_TO_MULTIPLE}.name`),
      hint: localize(`${KEYS.LABELING.ROUND_TO_MULTIPLE}.hint`),
      scope: "world",
      config: true,
      default: 0.1,
      type: Number
    });

    register(KEYS.MEASURING.TOKEN_MULTIPLIER, {
      name: localize(`${KEYS.MEASURING.TOKEN_MULTIPLIER}.name`),
      hint: localize(`${KEYS.MEASURING.TOKEN_MULTIPLIER}.hint`),
      scope: "world",
      config: true,
      default: 1,
      type: Number
    });

    register(KEYS.MEASURING.TOKEN_MULTIPLIER_FLAT, {
      name: localize(`${KEYS.MEASURING.TOKEN_MULTIPLIER_FLAT}.name`),
      hint: localize(`${KEYS.MEASURING.TOKEN_MULTIPLIER_FLAT}.hint`),
      scope: "world",
      config: true,
      default: true,
      type: Boolean
    });

    register(KEYS.MEASURING.FORCE_GRID_PENALTIES, {
      name: localize(`${KEYS.MEASURING.FORCE_GRID_PENALTIES}.name`),
      hint: localize(`${KEYS.MEASURING.FORCE_GRID_PENALTIES}.hint`),
      scope: "user",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false
    });

    // ----- NOTE: Grid Terrain Measurement ----- //
    //     register(KEYS.GRID_TERRAIN.ALGORITHM, {
    //       name: localize(`${KEYS.GRID_TERRAIN.ALGORITHM}.name`),
    //       hint: localize(`${KEYS.GRID_TERRAIN.ALGORITHM}.hint`),
    //       scope: "world",
    //       config: true,
    //       default: KEYS.GRID_TERRAIN.CHOICES.CENTER,
    //       type: String,
    //       choices: {
    //         [KEYS.GRID_TERRAIN.CHOICES.CENTER]: localize(`${KEYS.GRID_TERRAIN.CHOICES.CENTER}`),
    //         [KEYS.GRID_TERRAIN.CHOICES.PERCENT]: localize(`${KEYS.GRID_TERRAIN.CHOICES.PERCENT}`),
    //         [KEYS.GRID_TERRAIN.CHOICES.EUCLIDEAN]: localize(`${KEYS.GRID_TERRAIN.CHOICES.EUCLIDEAN}`)
    //       }
    //     });
    //
    //     register(KEYS.GRID_TERRAIN.AREA_THRESHOLD, {
    //       name: localize(`${KEYS.GRID_TERRAIN.AREA_THRESHOLD}.name`),
    //       hint: localize(`${KEYS.GRID_TERRAIN.AREA_THRESHOLD}.hint`),
    //       scope: "world",
    //       config: true,
    //       default: 0.5,
    //       type: Number,
    //       range: {
    //         min: 0.1,
    //         max: 1,
    //         step: 0.1
    //       }
    //     });
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

    game.keybindings.register(MODULE_ID, KEYBINDINGS.ADD_WAYPOINT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.ADD_WAYPOINT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.ADD_WAYPOINT}.hint`),
      editable: [
        { key: "Equal" }
      ],
      onDown: context => {
        if ( canvas.controls?.ruler && !canvas.controls.ruler._isTokenRuler ) toggleTokenRulerWaypoint(context, true);
      },
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.REMOVE_WAYPOINT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.REMOVE_WAYPOINT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.REMOVE_WAYPOINT}.hint`),
      editable: [
        { key: "Minus" }
      ],
      onDown: context => {
        if ( canvas.controls?.ruler && !canvas.controls.ruler._isTokenRuler ) toggleTokenRulerWaypoint(context, false);
      },
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.TOKEN_RULER.ADD_WAYPOINT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.ADD_WAYPOINT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.ADD_WAYPOINT}.hint`),
      editable: [
        { key: "Equal" }
      ],
      onDown: context => {
        if ( canvas.controls?.ruler._isTokenRuler ) toggleTokenRulerWaypoint(context, true);
      },
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.TOKEN_RULER.REMOVE_WAYPOINT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.REMOVE_WAYPOINT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOKEN_RULER.REMOVE_WAYPOINT}.hint`),
      editable: [
        { key: "Minus" }
      ],
      onDown: context => {
        if ( canvas.controls?.ruler._isTokenRuler ) toggleTokenRulerWaypoint(context, false);
      },
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.TOGGLE_PATHFINDING, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOGGLE_PATHFINDING}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TOGGLE_PATHFINDING}.hint`),
      editable: [
        { key: "KeyP" }
      ],
      onDown: () => {
        this.FORCE_TOGGLE_PATHFINDING ||= true;
        const ruler = canvas.controls.ruler;
        if ( ruler._state === Ruler.STATES.MEASURING ) ruler.measure(ruler.destination, { force: true });
      },
      onUp: () => {
        this.FORCE_TOGGLE_PATHFINDING &&= false;
        const ruler = canvas.controls.ruler;
        if ( ruler._state === Ruler.STATES.MEASURING ) ruler.measure(ruler.destination, { force: true });
      },
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.FORCE_TO_GROUND, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.FORCE_TO_GROUND}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.FORCE_TO_GROUND}.hint`),
      editable: [
        { key: "KeyG" }
      ],
      onDown: _context => {
        const ruler = canvas.controls.ruler;
        if ( !ruler.active ) return;
        this.FORCE_TO_GROUND = !this.FORCE_TO_GROUND;
        ruler.waypoints.at(-1)._forceToGround = this.FORCE_TO_GROUND;

        ruler.measure(ruler.destination, { force: true });
        ui.notifications.info(`Ruler measure to ground ${this.FORCE_TO_GROUND ? "enabled" : "disabled"}.`);
      },
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    game.keybindings.register(MODULE_ID, KEYBINDINGS.TELEPORT, {
      name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TELEPORT}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.TELEPORT}.hint`),
      editable: [
        { key: "KeyF" }
      ],
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });
  }

  static togglePathfinding(enable) {
    enable ??= Settings.get(Settings.KEYS.PATHFINDING.ENABLE);
    if ( enable ) this.#enablePathfinding();
    else this.#disablePathfinding();
    updatePathfindingControl();
    ui.controls.render(true);
  }

  static #enablePathfinding() {
    const t0 = performance.now();
    registerSceneGraph(MODULE_ID, { tokens: this.useTokensInPathfinding });
    PATCHER.registerGroup("PATHFINDING");
    this.setTokenBlocksPathfinding();
    const t1 = performance.now();

    // Use the scene graph to initialize Pathfinder triangulation.
    Pathfinder.dirty = true;
    Pathfinder.initialize();
    const t2 = performance.now();

    console.group(`${MODULE_ID}|Initialized scene graph and pathfinding.`);
    console.debug(`${MODULE_ID}|Constructed scene graph in ${t1 - t0} ms.`);
    console.debug(`${MODULE_ID}|Tracked ${SCENE_GRAPH.wallIds.size} walls.`);
    console.debug(`Tracked ${SCENE_GRAPH.tokenIds.size} tokens.`);
    console.debug(`Located ${SCENE_GRAPH.edges.size} distinct edges.`);
    console.debug(`${MODULE_ID}|Initialized pathfinding in ${t2 - t1} ms.`);
    console.groupEnd();
  }

  static #disablePathfinding() {
    PATCHER.deregisterGroup("PATHFINDING_TOKENS");
    PATCHER.deregisterGroup("PATHFINDING");
    deRegisterSceneGraph(MODULE_ID);
    Pathfinder.dirty = true;
  }

  static setTokenBlocksPathfinding(blockSetting) {
    blockSetting ??= Settings.get(Settings.KEYS.PATHFINDING.TOKENS_BLOCK);
    BorderEdge.tokenBlockType = this._tokenBlockType(blockSetting);
    if ( !Settings.get(Settings.KEYS.PATHFINDING.ENABLE) ) return;

    registerSceneGraph(MODULE_ID, { tokensOnly: this.useTokensInPathfinding });
    if ( this.useTokensInPathfinding ) PATCHER.registerGroup("PATHFINDING_TOKENS");
    else PATCHER.deregisterGroup("PATHFINDING_TOKENS");
    Pathfinder.dirty = true;
  }

  static get useTokensInPathfinding() {
    return Settings.get(Settings.KEYS.PATHFINDING.TOKENS_BLOCK) !== this.KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES.NO;
  }

  static _tokenBlockType(blockSetting) {
    const C = this.KEYS.PATHFINDING.TOKENS_BLOCK_CHOICES;
    const D = CONST.TOKEN_DISPOSITIONS;
    blockSetting ??= this.get(this.KEYS.PATHFINDING.TOKENS_BLOCK);
    return blockSetting === C.NO ? D.NEUTRAL
      : blockSetting === C.HOSTILE ? D.HOSTILE
        : D.SECRET;
  }

  /**
   * Determine if speed highlighting should be enabled for this user and this token.
   * If no hostiles, then user can see the speed if they have Observer or greater permissions
   * or token is not hostile. GMs always see speed if enabled.
   * @param {Token} token     Token whose speed would be displayed
   * @returns {boolean} True if speed highlighting should be used.
   */
  static useSpeedHighlighting(token) {
    if ( !token || !token.actor ) return false;
    const SH = this.KEYS.SPEED_HIGHLIGHTING;
    const choice = this.get(SH.CHOICE);
    if ( choice === SH.CHOICES.NEVER
      || (choice === SH.CHOICES.COMBAT && !game.combat?.started) ) return false;
    if ( game.user.isGM || !this.get(SH.NO_HOSTILES) ) return true;

    // For hostiles, true if Observer or token is not hostile.
    if ( token.actor.testUserPermission(game.user, "OBSERVER") ) return true;
    if ( token.document.disposition < 0 ) return false;
    return true;
  }

  static useAutoMoveDetection() { return game.system.id === "dnd5e" && this.get(this.KEYS.MEASURING.AUTO_MOVEMENT_TYPE); }
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

