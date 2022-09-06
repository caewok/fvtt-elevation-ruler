/* globals
game,
CONST,
*/
"use strict";

import { MODULE_ID, log } from "./module.js";
import { incrementElevation, decrementElevation } from "./ruler.js";

export const SETTINGS = {
  PREFER_TOKEN_ELEVATION: "prefer-token-elevation",
  USE_EV: "enable-elevated-vision-elevation",
  USE_TERRAIN: "enable-enhanced-terrain-elevation",
  USE_LEVELS: "enable-levels-elevation",
  USE_LEVELS_LABEL: "enable-levels-floor-label",
  NO_MODS: "no-modules-message"
}

const KEYBINDINGS = {
  INCREMENT: "incrementElevation",
  DECREMENT: "decrementElevation"
}

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

export function registerSettings() {
  log("Registering settings.");

  const evActive = game.modules.get("elevatedvision")?.active;
  const terrainLayerActive = game.modules.get("enhanced-terrain-layer")?.active
  const levelsActive = game.modules.get("levels")?.active

  if ( !evActive && !terrainLayerActive && !levelsActive ) {
    game.settings.register(MODULE_ID, SETTINGS.NO_MODS, {
      name: "No elevation-related modules found.",
      hint: "Additional settings will be available here if Elevated Vision, Enhanced Terrain Layer, or Levels modules are active.",
      scope: "world",
      config: true,
      enabled: false,
      default: true,
      type: Boolean
    });
  }

  game.settings.register(MODULE_ID, SETTINGS.USE_EV, {
    name: "Use Elevated Vision",
    hint: "Set starting ruler elevations when measuring based on Elevated Vision module.",
    scope: "world",
    config: evActive,
    default: evActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.USE_TERRAIN, {
    name: "Use Enhanced Terrain",
    hint: "Set starting ruler elevations when measuring based on terrain maximum elevation. Requires Enhanced Terrain Elevation module.",
    scope: "world",
    config: terrainLayerActive,
    default: terrainLayerActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.USE_LEVELS) {
    name: "Use Levels",
    hint: "Take into account Levels elevation when measuring. Requires Levels module.",
    scope: "world",
    config: levelsActive,
    default: levelsActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.USE_LEVELS_LABEL, {
    name: "Levels Floor Label",
    hint: "Label the ruler with the current floor. Requires Levels module.",
    scope: "world",
    config: levelsActive,
    default: levelsActive,
    type: Boolean
  });

  log("Done registering settings.");
}

export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, KEYBINDINGS.DECREMENT, {
    name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.hint`),
    editable: [
      { key: "BracketLeft"}
    ],
    onDown: () => canvas.controls.ruler.decrementElevation(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.keybindings.register(MODULE_ID, KEYBINDINGS.INCREMENT, {
    name: game.i18n.localize("${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.name"),
    hint: game.i18n.localize("${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.hint"),
    editable: [
      { key: "BracketRight"}
    ],
    onDown: () => canvas.controls.ruler.incrementElevation(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}
