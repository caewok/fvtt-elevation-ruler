/* globals
game,
Hooks
*/
"use strict";

import { registerSettings, registerKeybindings, SETTINGS, getSetting } from "./settings.js";
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

Hooks.on("getSceneControlButtons", controls => {
  if ( !getSetting(SETTINGS.PREFER_TOKEN_ELEVATION) ) return;

  const tokenTools = controls.find(c => c.name === "token");
  tokenTools.tools.push({
    name: SETTINGS.PREFER_TOKEN_ELEVATION,
    title: game.i18n.localize(`${MODULE_ID}.controls.${SETTINGS.PREFER_TOKEN_ELEVATION}.name`),
    icon: "fa-solid fa-user-lock",
    toggle: true
  });
});

Hooks.on("dragRuler.ready", function() {
  registerDragRuler();
});


