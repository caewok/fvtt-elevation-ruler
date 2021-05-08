import { registerSettings, registerHotkeys } from "./settings.js";
import { registerRuler } from "./patching.js";

export const MODULE_ID = 'elevation-ruler';
const FORCE_DEBUG = true; // used for logging before dev mode is set up


export function log(...args) {
  try {
    const isDebugging = window.DEV?.getPackageDebugValue(CONSTANTS.MODULE_ID);
    //console.log(MODULE_ID, '|', `isDebugging: ${isDebugging}.`);

    if (FORCE_DEBUG || isDebugging) {
      console.log(MODULE_ID, '|', ...args);
    }
  } catch (e) {}
}


Hooks.once('init', async function() {
  log("Initializing Elevation Ruler Options.");
  registerSettings();
  registerHotkeys();
  
});


Hooks.once('ready', async function() {
  log("Readying Elevation Ruler.");
  if(!game.modules.get('lib-wrapper')?.active && game.user.isGM) ui.notifications.error("Module Elevation Ruler requires the 'libWrapper' module. Please install and activate it.");
        
  if (!game.modules.get('lib-df-hotkeys')?.active && game.user.isGM) ui.notifications.error("'My Module' requires the 'Library: DF Hotkeys' module. Please install and activate this dependency.");
		
        
});

Hooks.once('setup', async function() {
  log("Setup for Elevation Ruler.");
  registerRuler();
  registerHotkeys();
});

