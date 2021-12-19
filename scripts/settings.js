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
  
  log("Registering Elevation Ruler settings.");
  game.settings.register(MODULE_ID, "prefer-token-elevation", {
    name: 'Prefer Token Elevation',
    hint: "If unset, dragging the ruler over the canvas will default to the elevation of the terrain (0 if none). If set, the ruler will remain at the token's elevation if the token is higher (for example, if the token is flying), unless the ruler is over another token.",
    scope: "user",
    config: true,
    default: false,
    type: Boolean
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
  
  log("Registering levels settings.");
  game.settings.register(MODULE_ID, "enable-levels-elevation", {
    name: 'Use Levels',
    hint: 'Take into account Levels elevation when measuring. Requires Levels module.',
    scope: "world",
    config: true,
    default: game.modules.get("levels")?.active,
    type: Boolean
  });
  
  game.settings.register(MODULE_ID, "enable-levels-floor-label", {
    name: 'Levels Floor Label',
    hint: 'Label the ruler with the current floor. Requires Levels module.',
    scope: "world",
    config: true,
    default: game.modules.get("levels")?.active,
    type: Boolean
  });


  log("Done registering settings.");

}

export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "decrementElevation", {
    name: game.i18n.localize("elevationruler.keybindings.decrementElevation.name"),
    hint: game.i18n.localize("elevationruler.keybindings.decrementElevation.hint"),
    editable: [
      { key: "["}
    ],
    onDown: decrementElevation
  });
  
  game.keybindings.register(MODULE_ID, "incrementElevation", {
    name: game.i18n.localize("elevationruler.keybindings.incrementElevation.name"),
    hint: game.i18n.localize("elevationruler.keybindings.incrementElevation.hint"),
    editable: [
      { key: "]"}
    ],
    onDown: incrementElevation
  });
}
