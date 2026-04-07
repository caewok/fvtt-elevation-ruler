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
import { benchTokenPath, testPathfinding } from "./pathfinding/benchmark.js";

import { AbstractPathfinder } from "./pathfinding/AbstractPathfinder.js";
import {
  BFSGraph,
  UniformCostGraph,
  GreedyBestFirstGraph,
  AStarGraph,
} from "./pathfinding/PathAlgorithms.js";
import { GraphPathfinder } from "./pathfinding/GraphPathfinding.js";

// Gridded collision pathfinding
import { GriddedCollisionPathfinder, worldBuilderGriddedCollision } from "./pathfinding/GriddedCollisionPathfinding.js";

// ClockwiseSweep pathfinding
import { ObstacleSweep, ClockwiseCornerSweep, ClockwiseCornerEdgeSweep, offsetVCornersForEdges } from "./pathfinding/ClockwiseSweep.js";
import { ClockwiseSweepPathfinder, worldBuilderClockwise, ClockwiseSweepPathfindingNode } from "./pathfinding/ClockwiseSweepPathfinding.js";

// WebGPU pathfinding
import { WebGPUPathfinder } from "./pathfinding/WebGPUPathfinding.js";

// Scene graph
import { EdgeGraph } from "./EdgeGraph.js";

// Path cleaning
import {
  optimizeGridPath,
  dropIntermediatePoints,
  pathIsValid,
  removeDuplicatePoints,
  straightenPath,
} from "./pathfinding/path_cleaning.js";
import { snapPathToGrid } from "./pathfinding/snap_to_grid.js";

// Load the geometry library.
import "./geometry/registration.js";

/**
 * If quench is present, register tests.
 */
Hooks.on("quenchReady", async (quench) => {
  try {
    const { registerTests } = await import(`/modules/${MODULE_ID}/scripts/tests/index.js`);
    registerTests(quench);
  } catch(err) {
    console.error("Failed to load Quench tests:", err);
  }
});

Hooks.once("init", function() {
  // Configuration
  CONFIG[MODULE_ID] = {

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
     * More refined options of what type of tokens block if the tokens block setting
     * is chosen for pathfinding.
     * @type {TokenBlockingConfig}
     */
    tokensBlock: {
      dead: true,
      live: true,
      prone: true,
    },

    /** @type {object} */
    graphPathfinding: {
      algorithm: "astar",   // @type {"astar"|"greedy"|"breadth"|"uniform"}
      use3d: false,         // @type {true|false}. TODO: Currently non-functional.
      cost: "terrain",      // @type {"manhattan"|"euclidean"|"foundry"|"terrain"}
      heuristic: "euclidean", // @type {"manhattan"|"euclidean"|"foundry"|"terrain"}
      neighborFilter: "clockwiseSweep",    // @type{"clockwiseSweep"|"occlusion"|"sceneGraph"}
      idleYield: 100,          // @type {number} Number of iterations to yield. 0 means do not yield for idle.
    },

    /**
     * How to offset the corners for the clockwise sweep pathfinding.
     * v: Offset using the V created by corners
     * edge: Offset by moving away from the corner in the direction of the edge creating the shadow.
     * @type {"v"|"edge"}
     */
    clockwiseSweepPathfinding: {
      cost: "terrain",         // @type {"manhattan"|"euclidean"|"foundry"|"terrain"}
      heuristic: "euclidean",  // @type {"manhattan"|"euclidean"|"foundry"|"terrain"}
      use3d: false,         // @type {true|false}. TODO: Currently non-functional.
      /**
       * How to offset the corners for the clockwise sweep pathfinding.
       * v: Offset using the V created by corners
       * edge: Offset by moving away from the corner in the direction of the edge creating the shadow.
       * @type {"v"|"edge"}
       */
      cornerGapType: "v",
      idleYield: 50,           // @type {number} Number of iterations to yield. 0 means do not yield for idle.
    },

    clockwiseSweepCornerGapType: "v",

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
      benchTokenPath,
      testPathfinding,

      AbstractPathfinder,
      BFSGraph,
      UniformCostGraph,
      GreedyBestFirstGraph,
      AStarGraph,
      GraphPathfinder,

      WebGPUPathfinder,
      GriddedCollisionPathfinder,
      ClockwiseSweepPathfinder,

      worldBuilderGriddedCollision,
      worldBuilderClockwise,

      ObstacleSweep,
      ClockwiseCornerSweep,
      ClockwiseCornerEdgeSweep,
      ClockwiseSweepPathfindingNode,
      offsetVCornersForEdges,
    },

    pathCleaning: {
      snapPathToGrid,
      pathIsValid,
      optimizeGridPath,
      dropIntermediatePoints,
      straightenPath,
      removeDuplicatePoints,
    },

    EdgeGraph,
    Settings
  };

  foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES)).then(_value => log("Templates loaded."));
});

// Setup is after init; before ready.
// setup is called after settings and localization have been initialized,
// but before entities, packs, UI, canvas, etc. has been initialized
Hooks.once("setup", function() {
  Settings.registerKeybindings(); // Should go before registering settings, so hotkey group is defined
  Settings.registerAll();
  initializePatching();
});

Hooks.on("canvasReady", function() {
  // Placeable Geometry for collision testing.
  const geometryTracking = CONFIG.GeometryLib.lib.placeableGeometryTracking;
  const geometryTypes = [
    "Tile",
    "Wall",
    "Token",
    "Region",
  ];
  for ( const type of geometryTypes ) {
    const cl = geometryTracking[`${type}GeometryTracker`];
    cl.registerHooks();
    cl.registerExistingPlaceables();
    cl.activate();
  }

  Settings.pathfinderReady = true;
  Settings.initializePathfinding();

  CONFIG[MODULE_ID].sceneGraph = EdgeGraph.buildFromCanvas({
    useWalls: true,
    useTokens: false,
  });
});

Hooks.on("canvasTearDown", function() {
  CONFIG[MODULE_ID].sceneGraph = null;

  Settings.pathfinderReady = false;

  // Placeable Geometry for collision testing.
  const geometryTracking = CONFIG.GeometryLib.lib.placeableGeometryTracking;
  const geometryTypes = [
    "Tile",
    "Wall",
    "Token",
    "Region",
  ];
  for ( const type of geometryTypes ) {
    const cl = geometryTracking[`${type}GeometryTracker`];
    const watcher = cl.create();
    watcher.deactivate();
    watcher.deRegisterExistingPlaceables();
  }
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
  if ( !canvas.scene ) return;
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
  if ( controls.control.name !== "token" ) return;
  const toggle = controls.tokens.tools[PATHFINDING_CONTROL.name];
  if ( toggle ) await Settings.set(Settings.KEYS.CONTROLS.PATHFINDING, toggle.active);
});

export function updatePathfindingControl(enable) {
  enable ??= Settings.get(Settings.KEYS.CONTROLS.PATHFINDING);
  PATHFINDING_CONTROL.active = enable;

  // Do in the hook instead to avoid repetition: ui.controls.render(true);
}

