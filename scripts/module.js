/* globals
canvas,
game,
CONFIG,
Hooks,
loadTemplates,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "./settings.js";
import { initializePatching, PATCHER } from "./patching.js";
import { MODULE_ID, TEMPLATES } from "./const.js";
import { log, gridShape } from "./util.js";

// Pathfinding
import { BorderTriangle, BorderEdge } from "./pathfinding/BorderTriangle.js";
import { Pathfinder } from "./pathfinding/pathfinding.js";
import { BreadthFirstPathSearch, UniformCostPathSearch, GreedyPathSearch, AStarPathSearch } from "./pathfinding/algorithms.js";
import { PriorityQueue } from "./pathfinding/PriorityQueue.js";
import { benchPathfinding } from "./pathfinding/benchmark.js";

import { AbstractPathfinder } from "./pathfinding/AbstractPathfinder.js";
import {
  BFSPathfinder,
  UniformCostPathfinder,
  GreedyBestFirstPathfinder,
  AStarPathfinder,
} from "./pathfinding/SimplePathfinding.js";
import { worldBuilder } from "./pathfinding/GriddedPathfindingWorld.js";

// WebGPU Pathfinding
import { Terrain, WebGPUPathfinder, GPUTerrainMap, WebGPUPathfinderWorker } from "./pathfinding/WebGPUPathfinding.js";

// Load the geometry library.
import "./geometry/registration.js";

// Wall updates for pathfinding
import { SCENE_GRAPH, WallTracer, WallTracerEdge, WallTracerVertex } from "./pathfinding/WallTracer.js";

Hooks.once("init", function() {
  WebGPUPathfinder.initializeDevice(); // Async.


  // Configuration
  CONFIG[MODULE_ID] = {

    /**
     * Account for terrains/tokens in pathfinding.
     * Can be a serious performance hit.
     * @type {boolean}
     */
    pathfindingCheckTerrains: false,

    /**
     * ID of Token statuses to ignore when pathfinding.
     * @type {Set<string>}
     */
    pathfindingIgnoreStatuses: new Set([
      "dead",
      "ethereal",
      "incapacitated",
      "invisible",
      "paralyzed",
      "petrified",
      "restrained",
      "sleeping",
      "unconscious"
    ]),

    /**
     * Amount, in pixels, to pad the token shape that is used when pathfinding around tokens.
     * Negative amounts allow the pathfinding to move through outer border of the token.
     * Positive amounts make tokens larger than they appear, creating a buffer.
     * @type {number}
     */
    tokenPathfindingBuffer: -1,


    /**
     * Use pathfinding in 3d, which can be slow.
     * @type {boolean}
     */
    use3dPathfinding: false,

    /**
     * @type {
     * manhattan
     * manhattan3d
     * euclidean
     * euclidean3d
     * foundry
     * foundryTokenCost
     * occlusion
     * }
     */
    simplePathfinding: {
      algorithm: "astar",   // @type {"astar"|"greedy"|"breadth"|"uniform"}
      use3d: false,         // @type {true|false}
      cost: "foundry",      // @type {"manhattan"|"euclidean"|"foundry"|"terrain"}
      heuristic: "foundry", // @type {"manhattan"|"euclidean"|"foundry"|"terrain"}
      pt3d: false,          // @type {true|false} Will be true if use3d is true;
      neighborFilter: "clockwiseSweep",    // @type{"clockwiseSweep"|"occlusion"}
    },

    /**
     * Enable certain debug console logging and tests.
     * @type {boolean}
     */
    debug: false,

  };

  game.modules.get(MODULE_ID).api = {
    gridShape,
    PATCHER,

    pathfinding: {
      BorderTriangle,
      BorderEdge,
      Pathfinder,
      BreadthFirstPathSearch,
      UniformCostPathSearch,
      GreedyPathSearch,
      AStarPathSearch,
      PriorityQueue,
      benchPathfinding,
      SCENE_GRAPH,

      AbstractPathfinder,
      BFSPathfinder,
      UniformCostPathfinder,
      GreedyBestFirstPathfinder,
      AStarPathfinder,

      worldBuilder,

      Terrain,
      WebGPUPathfinder,
      GPUTerrainMap,
      WebGPUPathfinderWorker,
    },

    WallTracer, WallTracerEdge, WallTracerVertex,

    Settings
  };

  loadTemplates(Object.values(TEMPLATES)).then(_value => log("Templates loaded."));
});

// Setup is after init; before ready.
// setup is called after settings and localization have been initialized,
// but before entities, packs, UI, canvas, etc. has been initialized
Hooks.once("setup", function() {
  Settings.registerKeybindings(); // Should go before registering settings, so hotkey group is defined
  Settings.registerAll();
  initializePatching();
});

Hooks.once("canvasReady", function() {
  // Need geometry tracking to test collisions when pathfinding.
  const tracking = CONFIG.GeometryLib.lib.placeableGeometryTracking;
  tracking.TileGeometryTracker.registerPlaceableHooks();
  tracking.TileGeometryTracker.registerExistingPlaceables();

  tracking.WallGeometryTracker.registerPlaceableHooks();
  tracking.WallGeometryTracker.registerExistingPlaceables();

  tracking.TokenGeometryTracker.registerPlaceableHooks();
  tracking.TokenGeometryTracker.registerExistingPlaceables();

  tracking.RegionGeometryTracker.registerPlaceableHooks();
  tracking.RegionGeometryTracker.registerExistingPlaceables();

  Settings.pathfinderReady = true;
  Settings.updateTokensPathfinder();

  // Track token and region geometry for use with terrain difficulty.
});

// For https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});


// Add pathfinding button to token controls.
const PATHFINDING_CONTROL = {
  name: Settings.KEYS.CONTROLS.PATHFINDING,
  title: `${MODULE_ID}.controls.${Settings.KEYS.CONTROLS.PATHFINDING}.name`,
  icon: "fa-solid fa-route",
  toggle: true,
  order: 0,
};

// Render the pathfinding control.
// Render the prefer token control if that setting is enabled.
Hooks.on("getSceneControlButtons", (controls, _html, _data) => {
  if ( !canvas.scene || !Settings.get(Settings.KEYS.PATHFINDING.ENABLE) ) return;
  PATHFINDING_CONTROL.order = 0;
  Object.values(controls.tokens.tools)
    .forEach(tool => PATHFINDING_CONTROL.order = Math.max(tool.order + 1, PATHFINDING_CONTROL.order));
  controls.tokens.tools[PATHFINDING_CONTROL.name] = PATHFINDING_CONTROL;
});

Hooks.on("canvasInit", function(_canvas) {
  updatePathfindingControl();
  ui.controls.render(true);
});

Hooks.on("renderSceneControls", async function(controls, _html, _data) {
  // Monitor enabling/disabling of custom controls.
  if ( controls.activeControl !== "token" ) return;
  const toggle = controls.tokens.tools[PATHFINDING_CONTROL.name];
  if ( toggle ) await Settings.set(Settings.KEYS.CONTROLS.PATHFINDING, toggle.active);
});

export function updatePathfindingControl(enable) {
  if ( !Settings.get(Settings.KEYS.PATHFINDING.ENABLE) ) return;
  enable ??= Settings.get(Settings.KEYS.CONTROLS.PATHFINDING);
  PATHFINDING_CONTROL.active = enable;

  // Do in the hook instead to avoid repetition: ui.controls.render(true);
}

