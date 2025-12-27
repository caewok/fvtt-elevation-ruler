/* globals
game,
CONST,
canvas,
Ruler,
ui
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { log } from "./util.js";
import { SCENE_GRAPH } from "./pathfinding/WallTracer.js";
import { Pathfinder } from "./pathfinding/pathfinding.js";
import { PATCHER } from "./patching.js";
import { BorderEdge } from "./pathfinding/BorderTriangle.js";
import { updatePathfindingControl } from "./module.js";

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

  NO_MODS: "no-modules-message",
};

const KEYBINDINGS = {
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
  }

  static registerKeybindings() {
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
    PATCHER.registerGroup("PATHFINDING");

    const t0 = performance.now();
    SCENE_GRAPH._reset();
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
    SCENE_GRAPH.clear();
    Pathfinder.dirty = true;
  }


  static setTokenBlocksPathfinding(blockSetting) {
    blockSetting ??= Settings.get(Settings.KEYS.PATHFINDING.TOKENS_BLOCK);
    BorderEdge.tokenBlockType = this._tokenBlockType(blockSetting);
    if ( !Settings.get(Settings.KEYS.PATHFINDING.ENABLE) ) return;

    if ( this.useTokensInPathfinding ) {
      PATCHER.registerGroup("PATHFINDING_TOKENS");
      for ( const token of canvas.tokens.placeables ) SCENE_GRAPH.addToken(token);
    } else {
      PATCHER.deregisterGroup("PATHFINDING_TOKENS");
      SCENE_GRAPH.tokenIds.forEach(id => SCENE_GRAPH.removeToken(id));
    }

    Pathfinder.dirty = true;
    const res = SCENE_GRAPH._checkInternalConsistency();
    if ( !res.allConsistent ) {
      log("WallTracer|setTokenBlocksPathfinding resulted in inconsistent graph.", SCENE_GRAPH, res);
      SCENE_GRAPH._reset();
    }
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
}
