/* globals
canvas,
game,
Hooks,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "./settings.js";
import { initializePatching, PATCHER } from "./patching.js";
import { MODULE_ID } from "./const.js";
import { iterateGridUnderLine } from "./util.js";
import { registerGeometry } from "./geometry/registration.js";

// Pathfinding
import { BorderTriangle, BorderEdge } from "./pathfinding/BorderTriangle.js";
import { Pathfinder, BreadthFirstPathSearch, UniformCostPathSearch, AStarPathSearch } from "./pathfinding/pathfinding.js";
import { PriorityQueueArray } from "./pathfinding/PriorityQueueArray.js";
import { PriorityQueue } from "./pathfinding/PriorityQueue.js";

Hooks.once("init", function() {
  // Cannot access localization until init.
  PREFER_TOKEN_CONTROL.title = game.i18n.localize(PREFER_TOKEN_CONTROL.title);
  registerGeometry();
  game.modules.get(MODULE_ID).api = {
    iterateGridUnderLine,
    PATCHER,

    // Pathfinding
    pathfinding: {
      BorderTriangle,
      BorderEdge,
      Pathfinder,
      BreadthFirstPathSearch,
      UniformCostPathSearch,
      AStarPathSearch,
      PriorityQueueArray,
      PriorityQueue
    }
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

const PREFER_TOKEN_CONTROL = {
  name: Settings.KEYS.PREFER_TOKEN_ELEVATION,
  title: `${MODULE_ID}.controls.${Settings.KEYS.PREFER_TOKEN_ELEVATION}.name`,
  icon: "fa-solid fa-user-lock",
  toggle: true
};


// Render the prefer token control if that setting is enabled
Hooks.on("getSceneControlButtons", controls => {
  if ( !canvas.scene || !Settings.get(Settings.KEYS.PREFER_TOKEN_ELEVATION) ) return;
  const tokenTools = controls.find(c => c.name === "token");
  tokenTools.tools.push(PREFER_TOKEN_CONTROL);
});

Hooks.on("canvasInit", function(_canvas) {
  updatePreferTokenControl();
});

Hooks.on("renderSceneControls", async function(controls, _html, _data) {
  // Watch for enabling/disabling of the prefer token control
  if ( controls.activeControl !== "token" || !Settings.get(Settings.KEYS.PREFER_TOKEN_ELEVATION) ) return;
  const toggle = controls.control.tools.find(t => t.name === Settings.KEYS.PREFER_TOKEN_ELEVATION);
  if ( !toggle ) return; // Shouldn't happen, but...
  await Settings.set(Settings.KEYS.PREFER_TOKEN_ELEVATION_CURRENT_VALUE, toggle.active);
});

function updatePreferTokenControl(enable) {
  enable ??= Settings.get(Settings.KEYS.PREFER_TOKEN_ELEVATION);
  const tokenTools = ui.controls.controls.find(c => c.name === "token");
  const index = tokenTools.tools.findIndex(b => b.name === Settings.KEYS.PREFER_TOKEN_ELEVATION);
  if ( enable && !~index ) tokenTools.tools.push(PREFER_TOKEN_CONTROL);
  else if ( ~index ) tokenTools.tools.splice(index, 1);
  PREFER_TOKEN_CONTROL.active = Settings.get(Settings.KEYS.PREFER_TOKEN_ELEVATION_CURRENT_VALUE);
  ui.controls.render(true);
}

