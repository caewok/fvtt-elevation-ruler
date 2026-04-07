/* globals
game,
CONFIG,
CONST,
canvas,
foundry,
Ruler,
ui
*/
"use strict";

import { MODULE_ID, PATHFINDING_ID } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { log } from "./util.js";
import { PATCHER } from "./patching.js";
import { updatePathfindingControl } from "./module.js";
import { WebGPUPathfinder } from "./pathfinding/WebGPUPathfinding.js";
import { ClockwiseSweepPathfinder } from "./pathfinding/ClockwiseSweepPathfinding.js";
import { GriddedCollisionPathfinder } from "./pathfinding/GriddedCollisionPathfinding.js";

const SETTINGS = {
  CONTROLS: {
    PATHFINDING: "pathfinding-control"
  },

  PATHFINDING: {
    // ENABLE: "pathfinding_enable", // Deprecated, at least until other features present
    TOKENS_BLOCK: "pathfinding_tokens_block",
    TOKENS_BLOCK_CHOICES: {
      NO: "pathfinding_tokens_block_no",
      HOSTILE: "pathfinding_tokens_block_hostile",
      ALL: "pathfinding_tokens_block_all"
    },
    TOKEN_DIFFICULTY: {
      FRIENDLY: "pathfinding_difficulty_friendly",
      HOSTILE: "pathfinding_difficulty_hostile",
    },

    LIMIT_TOKEN_LOS: "pathfinding_limit_token_los",
    SNAP_TO_GRID: "pathfinding_snap_to_grid",
    ALGORITHM: "pathfinding-algorithm",
    ALGORITHM_CHOICES: {
      COLLISION: "pathfinding-algorithm-collision",
      CLOCKWISE_SWEEP: "pathfinding-algorithm-cwsweep",
      WEBGPU: "pathfinding-algorithm-webgpu",
      // TRIANGLEMESH: pathfinding-algorithm-trianglemesh,
      // POLYMESH: "pathfinding-algorithm-polymesh",
      // NAVMESH: "pathfinding-algorithm-navmesh", // recast-detour library
      // WEBGPU: "pathfinding-algorithm-webgpu",
    }
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
    const PF = KEYS.PATHFINDING;

    // ----- NOTE: Pathfinding ----- //

    register(KEYS.CONTROLS.PATHFINDING, {
      scope: "user",
      config: false,
      type: new foundry.data.fields.BooleanField({ initial: true }),
      requiresReload: false
    });

    const pathfindingAlgChoices = {};
    Object.values(PF.ALGORITHM_CHOICES).forEach(alg => pathfindingAlgChoices[alg] = localize(alg));
    if ( !WebGPUPathfinder.supportsWebGPU ) delete pathfindingAlgChoices[PF.ALGORITHM_CHOICES.WEBGPU];

    register(PF.ALGORITHM, {
      name: localize(`${PF.ALGORITHM}.name`),
      // Currently unused hint: localize(`${PF.ALGORITHM}.hint`),
      scope: "user",
      config: true,
      type: new foundry.data.fields.StringField({
        required: true,
        blank: false,
        initial: PF.ALGORITHM_CHOICES.COLLISION,
        choices: pathfindingAlgChoices,
      }),
      requiresReload: false,
      onChange: value => this.updateTokensPathfinder({ algorithm: value }), // TODO: Initialize the pathfinding algorithm?
    });

    const choices = new Set(Object.keys(pathfindingAlgChoices));
    if ( !choices.has(this.get(PF.ALGORITHM)) ) {
      this.set(PF.ALGORITHM, PF.ALGORITHM_CHOICES.COLLISION);
    }

    register(PF.TOKENS_BLOCK, {
      name: localize(`${PF.TOKENS_BLOCK}.name`),
      hint: localize(`${PF.TOKENS_BLOCK}.hint`),
      scope: "world",
      config: true,
      type: new foundry.data.fields.StringField({
        required: true,
        blank: false,
        initial: PF.TOKENS_BLOCK_CHOICES.NO,
        choices: {
          [PF.TOKENS_BLOCK_CHOICES.NO]: localize(`${PF.TOKENS_BLOCK_CHOICES.NO}`),
          [PF.TOKENS_BLOCK_CHOICES.HOSTILE]: localize(`${PF.TOKENS_BLOCK_CHOICES.HOSTILE}`),
          [PF.TOKENS_BLOCK_CHOICES.ALL]: localize(`${PF.TOKENS_BLOCK_CHOICES.ALL}`),
        }
      }),
      requiresReload: false,
      onChange: value => this.setTokenBlocksPathfinding(value)
    });

    register(PF.TOKEN_DIFFICULTY.FRIENDLY, {
      name: localize(`${PF.TOKEN_DIFFICULTY.FRIENDLY}.name`),
      hint: localize(`${PF.TOKEN_DIFFICULTY.FRIENDLY}.hint`),
      scope: "world",
      config: true,
      type: new foundry.data.fields.NumberField({ nullable: false, min: 1, initial: 1 }),
    });

    register(PF.TOKEN_DIFFICULTY.HOSTILE, {
      name: localize(`${PF.TOKEN_DIFFICULTY.HOSTILE}.name`),
      hint: localize(`${PF.TOKEN_DIFFICULTY.HOSTILE}.hint`),
      scope: "world",
      config: true,
      type: new foundry.data.fields.NumberField({ nullable: false, min: 1, initial: 1 }),
    });


    register(PF.LIMIT_TOKEN_LOS, {
      name: localize(`${PF.LIMIT_TOKEN_LOS}.name`),
      hint: localize(`${PF.LIMIT_TOKEN_LOS}.hint`),
      scope: "world",
      config: true,
      type: new foundry.data.fields.BooleanField({ initial: false }),
      requiresReload: false
    });

    register(PF.SNAP_TO_GRID, {
      name: localize(`${PF.SNAP_TO_GRID}.name`),
      hint: localize(`${PF.SNAP_TO_GRID}.hint`),
      scope: "world",
      config: true,
      type: new foundry.data.fields.BooleanField({ initial: false }),
      onChange: value => this.toggleSnapToGrid(value),
      requiresReload: false,
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

        // Force a path recalculation.
        canvas.tokens.controlled.forEach(t => t.recalculatePlannedMovementPath());
      },
      onUp: () => {
        this.FORCE_TOGGLE_PATHFINDING &&= false;

        // Force a path recalculation.
        canvas.tokens.controlled.forEach(t => t.recalculatePlannedMovementPath());
      },
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    /* TODO: Fix or remove.
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
    */
  }

  static async initializePathfinding(algorithm) {
    // Destroy prior pathfinding.
    await WebGPUPathfinder.destroy();

    // Initialize pathfinding.
    const PF = Settings.KEYS.PATHFINDING;
    algorithm ??= Settings.get(PF.ALGORITHM);
    if ( Settings.get(PF.ALGORITHM) === PF.ALGORITHM_CHOICES.WEBGPU ) await WebGPUPathfinder.initialize();

    // Set up pathfinding for each token on the canvas.
    this.updateTokensPathfinder({ algorithm });
  }

  static async toggleSnapToGrid(enable) {
    const PF = Settings.KEYS.PATHFINDING;
    if ( Settings.get(PF.ALGORITHM) === PF.ALGORITHM_CHOICES.WEBGPU ) await WebGPUPathfinder.initialize();
  }

  static togglePathfinding(enable) {
    updatePathfindingControl(enable);
    ui.controls.render(true);
  }

  static pathfindingActive() {
    return ui.controls.tools[SETTINGS.CONTROLS.PATHFINDING].active;
  }

  // TODO: Update.
  static setTokenBlocksPathfinding(blockSetting) {
  // Still needed?
  //     blockSetting ??= Settings.get(Settings.KEYS.PATHFINDING.TOKENS_BLOCK);
  //     BorderEdge.tokenBlockType = this._tokenBlockType(blockSetting);
  //
  //     registerSceneGraph(MODULE_ID, { tokensOnly: this.useTokensInPathfinding });
  //     if ( this.useTokensInPathfinding ) PATCHER.registerGroup("PATHFINDING_TOKENS");
  //     else PATCHER.deregisterGroup("PATHFINDING_TOKENS");
  //     Pathfinder.dirty = true;
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

  static pathfinderReady = false;

  static updateTokensPathfinder({ tokens, algorithm } = {}) {
    if ( !this.pathfinderReady ) return;
    tokens ??= canvas.tokens.placeables;
    algorithm ??= this.get(this.KEYS.PATHFINDING.ALGORITHM);
    const cl = pathfinderClass(algorithm);
    tokens.forEach(token => this.updateTokenPathfinder(token, { algorithm, cl }));
  }

  static updateTokenPathfinder(token, { cl, algorithm } = {}) {
    if ( !this.pathfinderReady ) return;
    if ( !cl ) {
      algorithm ??= this.get(this.KEYS.PATHFINDING.ALGORITHM);
      cl = pathfinderClass(algorithm);
    }
    const obj = token[MODULE_ID] ??= {};
    const pf = obj[PATHFINDING_ID];
    if ( pf && pf.constructor === cl ) return;
    obj[PATHFINDING_ID] = new cl(token);
  }

  static get doPathfinding() {
    const pathfindingActive = ui.controls.controls.tokens.tools?.[Settings.KEYS.CONTROLS.PATHFINDING]?.active;
    return pathfindingActive ^ this.FORCE_TOGGLE_PATHFINDING;
  }
}

function pathfinderClass(algorithm) {
  const ALG = Settings.KEYS.PATHFINDING.ALGORITHM_CHOICES;
  algorithm ??= Settings.get(Settings.KEYS.PATHFINDING.ALGORITHM);
  switch ( algorithm ) {
    case ALG.WEBGPU: return WebGPUPathfinder;
    case ALG.COLLISION: return GriddedCollisionPathfinder;
    case ALG.CLOCKWISE_SWEEP: return ClockwiseSweepPathfinder;
    default: throw Error("Pathfinder class not recognized.");
  }
}

