import { registerSettings } from "./settings.js";

const MODULE_ID = 'elevation-ruler';
const FORCE_DEBUG = true; // used for logging before dev mode is set up


export function log(...args) {
  try {
    const isDebugging = window.DEV?.getPackageDebugValue(CONSTANTS.MODULE_ID);
    console.log(MODULE_ID, '|', `isDebugging: ${isDebugging}.`);

    if (FORCE_DEBUG || isDebugging) {
      console.log(MODULE_ID, '|', ...args);
    }
  } catch (e) {}
}


Hooks.once('init', async function() {
  console.log("Initializing Elevation Ruler Options.");
  registerSettings();
});

Hooks.once('ready', async function() {

});


