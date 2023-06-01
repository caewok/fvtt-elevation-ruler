/* globals
game,
Hooks
*/
"use strict";

import { registerSettings, registerKeybindings, SETTINGS, getSetting, setSetting } from "./settings.js";
import { registerRuler } from "./patching.js";
import { MODULE_ID } from "./const.js";

// For Drag Ruler
import { registerDragRuler } from "./patching.js";

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
})

Hooks.on("renderSceneControls", async function(controls, html, data) {
  // Watch for enabling/disabling of the prefer token control
  if ( controls.activeControl !== "token" ) return;
  const toggle = controls.control.tools.find(t => t.name === SETTINGS.PREFER_TOKEN_ELEVATION);
  await setSetting()

});

function updatePreferTokenControl(enable) {
  enable ??= getSetting(SETTINGS.PREFER_TOKEN_ELEVATION);
  const tokenTools = ui.controls.controls.find(c => c.name === "token");
  const index = tokenTools.tools.findIndex(b => b.name === SETTINGS.PREFER_TOKEN_ELEVATION);
  if ( enable && !~index ) tokenTools.tools.push(PREFER_TOKEN_CONTROL);
  else if ( ~index ) tokenTools.tools.splice(index, 1);
  ui.controls.render(true);
}

