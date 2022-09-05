/* globals
game,
Hooks
*/
"use strict";

import { registerSettings, registerKeybindings } from "./settings.js";
import { registerRuler } from "./patching.js";

export const MODULE_ID = "elevationruler";

export function log(...args) {
  try {
    const isDebugging = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
    if (isDebugging) console.log(MODULE_ID, "|", ...args);

  } catch(e) {
    // Empty
  }
}

// Setup is after init; before ready.
// setup is called after settings and localization have been initialized,
// but before entities, packs, UI, canvas, etc. has been initialized
Hooks.once("setup", async function() {
  log("Setup.");

  registerKeybindings(); // Should go before registering settings, so hotkey group is defined
  registerSettings();
});

// For https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

Hooks.once("libWrapper.Ready", async function() {
  log("libWrapper is ready to go.");
  registerRuler();
});
