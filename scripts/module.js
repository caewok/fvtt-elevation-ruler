/* globals
canvas,
game,
Hooks,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { registerSettings, registerKeybindings, SETTINGS, getSetting, setSetting } from "./settings.js";
import { registerRuler } from "./patching.js";
import { MODULE_ID } from "./const.js";

// For Drag Ruler
import { registerDragRuler } from "./patching.js"; // eslint-disable-line no-duplicate-imports

import { registerGeometry } from "./geometry/registration.js";

// Setup is after init; before ready.
// setup is called after settings and localization have been initialized,
// but before entities, packs, UI, canvas, etc. has been initialized
Hooks.once("setup", async function() {
  registerKeybindings(); // Should go before registering settings, so hotkey group is defined
  registerSettings();

  registerGeometry();
});

// For https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

Hooks.once("libWrapper.Ready", async function() {
  registerRuler();
});

const PREFER_TOKEN_CONTROL = {
  name: SETTINGS.PREFER_TOKEN_ELEVATION,
  title: `${MODULE_ID}.controls.${SETTINGS.PREFER_TOKEN_ELEVATION}.name`,
  icon: "fa-solid fa-user-lock",
  toggle: true
};

Hooks.once("init", function() {
  // Cannot access localization until init.
  PREFER_TOKEN_CONTROL.title = game.i18n.localize(PREFER_TOKEN_CONTROL.title);
});

// Render the prefer token control if that setting is enabled
Hooks.on("getSceneControlButtons", controls => {
  if ( !canvas.scene || !getSetting(SETTINGS.PREFER_TOKEN_ELEVATION) ) return;
  const tokenTools = controls.find(c => c.name === "token");
  tokenTools.tools.push(PREFER_TOKEN_CONTROL);
});

Hooks.on("dragRuler.ready", function() {
  registerDragRuler();
});

Hooks.on("canvasInit", function(_canvas) {
  updatePreferTokenControl();
});

Hooks.on("renderSceneControls", async function(controls, _html, _data) {
  // Watch for enabling/disabling of the prefer token control
  if ( controls.activeControl !== "token" || !getSetting(SETTINGS.PREFER_TOKEN_ELEVATION) ) return;
  const toggle = controls.control.tools.find(t => t.name === SETTINGS.PREFER_TOKEN_ELEVATION);
  if ( !toggle ) return; // Shouldn't happen, but...
  await setSetting(SETTINGS.PREFER_TOKEN_ELEVATION_CURRENT_VALUE, toggle.active);
});

function updatePreferTokenControl(enable) {
  enable ??= getSetting(SETTINGS.PREFER_TOKEN_ELEVATION);
  const tokenTools = ui.controls.controls.find(c => c.name === "token");
  const index = tokenTools.tools.findIndex(b => b.name === SETTINGS.PREFER_TOKEN_ELEVATION);
  if ( enable && !~index ) tokenTools.tools.push(PREFER_TOKEN_CONTROL);
  else if ( ~index ) tokenTools.tools.splice(index, 1);
  PREFER_TOKEN_CONTROL.active = getSetting(SETTINGS.PREFER_TOKEN_ELEVATION_CURRENT_VALUE);
  ui.controls.render(true);
}

