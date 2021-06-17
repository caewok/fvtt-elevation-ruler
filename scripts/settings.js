import { MODULE_ID, log } from "./module.js";
import { incrementElevation, decrementElevation } from "./ruler.js";

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}


export function registerSettings() {
  log("Registering hotkey menu.");
  game.settings.registerMenu(MODULE_ID, "elevationRulerHotkeyMenu", {
    name: 'Hotkeys Settings',
          label: "Set Hotkeys",
          hint: "Select the hotkeys for incrementing and decrementing elevation when using a ruler.",
          icon: "fas fa-arrows-alt-v",
    type: Hotkeys.createConfig('Elevation Ruler Hotkeys', [`${MODULE_ID}.change-elevation-group`]),
  });


  log("Registering terrain layer settings.");
  game.settings.register(MODULE_ID, "enable-terrain-elevation", {
    name: 'Use Enhanced Terrain',
    hint: 'Set starting ruler elevations when measuring based on terrain maximum elevation. Requires Enhanced Terrain Elevation module.',
    scope: "world",
    config: true,
    default: game.modules.get("enhanced-terrain-layer")?.active,
    type: Boolean
  });


  log("Done registering settings.");

}

export function registerHotkeys() {
  // You must register the group before adding hotkeys to it
  log("Registering hotkeys group.");
  Hotkeys.registerGroup({
    name: `${MODULE_ID}.change-elevation-group`, // <- Must be unique
    label: 'Elevation Ruler',
    description: 'Keys to increase and decrease elevation while using the ruler.' // <-- Optional
  });

  log("Registering increment elevation hotkey.");
  Hotkeys.registerShortcut({
    name: `${MODULE_ID}.increment-elevation-hotkey`, // <- Must be unique
    label: 'Increment',
                repeat: true, // Let the user hold down the key to increase repeatedly.
    group: `${MODULE_ID}.change-elevation-group`,
//    get: () => game.settings.get(MODULE_ID, `increment-elevation-hotkey`),
//    set: async value => await game.settings.set(MODULE_ID, `increment-elevation-hotkey`, "ArrowUp"),
    default: () => { return { key: Hotkeys.keys.BracketRight, alt: false, ctrl: false, shift: false }; },
    onKeyDown: incrementElevation,
  });

  log("Registering decrement elevation hotkey.");
  Hotkeys.registerShortcut({
    name: `${MODULE_ID}.decrement-elevation-hotkey`, // <- Must be unique
    label: 'Decrement',
                repeat: true,
    group: `${MODULE_ID}.change-elevation-group`,
//    get: () => game.settings.get(MODULE_ID, `${MODULE_ID}.decrement-elevation-hotkey`),
//    set: async value => await game.settings.set(MODULE_ID, `${MODULE_ID}.decrement-elevation-hotkey`, "ArrowDown"),
    default: () => { return { key: Hotkeys.keys.BracketLeft, alt: false, ctrl: false, shift: false }; },
    onKeyDown: decrementElevation,
  });

}
