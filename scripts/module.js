/* globals
canvas,
game,
CONFIG,
Hooks,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "./settings.js";
import { initializePatching, PATCHER } from "./patching.js";
import { MODULE_ID, MOVEMENT_TYPES, SPEED, MOVEMENT_BUTTONS, defaultHPAttribute } from "./const.js";
import { registerGeometry } from "./geometry/registration.js";

// Grid coordinates
import { pointFromGridCoordinates, getCenterPoint3d, getGridPosition3d, gridShape } from "./grid_coordinates.js";

// Measure classes
import {
  PhysicalDistance,
  PhysicalDistanceGridless,
  PhysicalDistanceGridded } from "./PhysicalDistance.js";

import {
  MoveDistance,
  MoveDistanceGridless,
  MoveDistanceGridded } from "./MoveDistance.js";

import {
  MovePenalty,
  MovePenaltyGridless,
  MovePenaltyGridded,

  // For debugging
  TokenMovePenaltyGridless,
  TerrainMovePenaltyGridless,
  DrawingMovePenaltyGridless,

  TokenMovePenaltyGridded,
  DrawingMovePenaltyGridded,
  TerrainMovePenaltyGridded } from "./MovePenalty.js";

// Pathfinding
import { BorderTriangle, BorderEdge } from "./pathfinding/BorderTriangle.js";
import { Pathfinder } from "./pathfinding/pathfinding.js";
import { BreadthFirstPathSearch, UniformCostPathSearch, GreedyPathSearch, AStarPathSearch } from "./pathfinding/algorithms.js";
import { PriorityQueueArray } from "./pathfinding/PriorityQueueArray.js";
import { PriorityQueue } from "./pathfinding/PriorityQueue.js";
import { benchPathfinding } from "./pathfinding/benchmark.js";

// Wall updates for pathfinding
import { SCENE_GRAPH, WallTracer, WallTracerEdge, WallTracerVertex } from "./pathfinding/WallTracer.js";

Hooks.once("init", function() {
  registerGeometry();

  // Configuration
  CONFIG[MODULE_ID] = {
    /**
     * Configurations related to measuring token speed for ruler highlighting. See const.js.
     * @type { object }
     */
    SPEED,

    /**
     * Font awesome identifiers for the Token HUD speed selection. See const.js.
     * @type {object}
     */
    MOVEMENT_BUTTONS,

    /**
     * Types of movement. See const.js.
     * @type {enum}
     */
    MOVEMENT_TYPES,

    /**
     * Account for terrains/tokens in pathfinding.
     * Can be a serious performance hit.
     * @type {boolean}
     */
    pathfindingCheckTerrains: false,

    /**
     * Where to find token HP, used to ignore dead tokens when pathfinding.
     * @type {string}
     */
    tokenHPAttribute: defaultHPAttribute(),

    /**
     * ID of Token statuses to ignore when pathfinding.
     * @type {Set<string>}
     */
    pathfindingIgnoreStatuses: new Set([
      "sleeping",
      "unconscious",
      "dead",
      "ethereal",
      "incapacitated",
      "paralyzed",
      "petrified",
      "restrained"]),

    /**
     * Adjust the width of the highlighting in gridless maps.
     * Percentage of `canvas.scene.dimensions.size` that determines the width.
     * @type {number}
     */
    gridlessHighlightWidthMultiplier: 0.2,

    /**
     * Enable certain debug console logging and tests.
     * @type {boolean}
     */
    debug: false
  };

  /* To add a movement to the api:
  CONFIG.elevationruler.MOVEMENT_TYPES.SWIM = 3; // Increment by 1 from the highest-valued movement type

  // This label is from Font Awesome
  CONFIG.elevationruler.MOVEMENT_BUTTONS[CONFIG.elevationruler.MOVEMENT_TYPES.SWIM] = "person-swimming";
  CONFIG.elevationruler.SPEED.ATTRIBUTES.SWIM = "actor.system.attributes.movement.swim"; // dnd5e
  */


  game.modules.get(MODULE_ID).api = {
    gridShape,
    PATCHER,

    coordinates: {
      pointFromGridCoordinates,
      getCenterPoint3d,
      getGridPosition3d
    },

    // Measure classes
    measure: {
      PhysicalDistance,
      PhysicalDistanceGridless,
      PhysicalDistanceGridded,
      MoveDistance,
      MoveDistanceGridless,
      MoveDistanceGridded,
      MovePenalty,
      MovePenaltyGridless,
      MovePenaltyGridded,

      // For debugging
      TokenMovePenaltyGridless,
      TerrainMovePenaltyGridless,
      DrawingMovePenaltyGridless,

      TokenMovePenaltyGridded,
      DrawingMovePenaltyGridded,
      TerrainMovePenaltyGridded
    },

    // Pathfinding
    pathfinding: {
      BorderTriangle,
      BorderEdge,
      Pathfinder,
      BreadthFirstPathSearch,
      UniformCostPathSearch,
      GreedyPathSearch,
      AStarPathSearch,
      PriorityQueueArray,
      PriorityQueue,
      benchPathfinding,
      SCENE_GRAPH
    },

    WallTracer, WallTracerEdge, WallTracerVertex,

    Settings
  };
});

// Setup is after init; before ready.
// setup is called after settings and localization have been initialized,
// but before entities, packs, UI, canvas, etc. has been initialized
Hooks.once("setup", function() {
  Settings.registerKeybindings(); // Should go before registering settings, so hotkey group is defined
  Settings.registerAll();
  initializePatching();
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
  toggle: true
};

// Render the pathfinding control.
// Render the prefer token control if that setting is enabled.
Hooks.on("getSceneControlButtons", controls => {
  if ( !canvas.scene ) return;
  const tokenTools = controls.find(c => c.name === "token");
  tokenTools.tools.push(PATHFINDING_CONTROL);
});

Hooks.on("canvasInit", function(_canvas) {
  updatePathfindingControl();
  ui.controls.render(true);
});

Hooks.on("renderSceneControls", async function(controls, _html, _data) {
  // Monitor enabling/disabling of custom controls.
  if ( controls.activeControl !== "token" ) return;

  const toggle = controls.control.tools.find(t => t.name === Settings.KEYS.CONTROLS.PATHFINDING);
  if ( toggle ) await Settings.set(Settings.KEYS.CONTROLS.PATHFINDING, toggle.active);
});

function updatePathfindingControl(enable) {
  enable ??= Settings.get(Settings.KEYS.CONTROLS.PATHFINDING);
  const tokenTools = ui.controls.controls.find(c => c.name === "token");
  const index = tokenTools.tools.findIndex(b => b.name === Settings.KEYS.CONTROLS.PATHFINDING);
  if ( !~index ) tokenTools.tools.push(PATHFINDING_CONTROL);
  PATHFINDING_CONTROL.active = Settings.get(Settings.KEYS.CONTROLS.PATHFINDING);
  // Do in the hook instead to avoid repetition: ui.controls.render(true);
}

