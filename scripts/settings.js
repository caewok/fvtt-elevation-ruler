/* globals
game,
CONST,
*/
"use strict";

import { MODULE_ID, log } from "./module.js";
import { incrementElevation, decrementElevation } from "./ruler.js";

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

export function registerSettings() {
  log("Registering settings.");

  const evActive = game.modules.get("elevatedvision")?.active;
  const terrainLayerActive = game.modules.get("enhanced-terrain-layer")?.active
  const levelsActive = game.modules.get("levels")?.active

  if ( !evActive && !terrainLayerActive && !levelsActive ) {
    game.settings.register(MODULE_ID, "no-modules-message", {
      name: "No elevation-related modules found.",
      hint: "Additional settings will be available here if Elevated Vision, Enhanced Terrain Layer, or Levels modules are active.",
      scope: "world",
      config: true,
      enabled: false,
      default: true,
      type: Boolean
    });
  }

  game.settings.register(MODULE_ID, "enable-elevated-vision-elevation", {
    name: "Use Elevated Vision",
    hint: "Set starting ruler elevations when measuring based on Elevated Vision module.",
    scope: "world",
    config: evActive,
    default: evActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "enable-enhanced-terrain-elevation", {
    name: "Use Enhanced Terrain",
    hint: "Set starting ruler elevations when measuring based on terrain maximum elevation. Requires Enhanced Terrain Elevation module.",
    scope: "world",
    config: terrainLayerActive,
    default: terrainLayerActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "enable-levels-elevation", {
    name: "Use Levels",
    hint: "Take into account Levels elevation when measuring. Requires Levels module.",
    scope: "world",
    config: levelsActive,
    default: levelsActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "enable-levels-floor-label", {
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
  game.keybindings.register(MODULE_ID, "decrementElevation", {
    name: game.i18n.localize("elevationruler.keybindings.decrementElevation.name"),
    hint: game.i18n.localize("elevationruler.keybindings.decrementElevation.hint"),
    editable: [
      { key: "BracketLeft"}
    ],
    onDown: () => canvas.controls.ruler.decrementElevation(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.keybindings.register(MODULE_ID, "incrementElevation", {
    name: game.i18n.localize("elevationruler.keybindings.incrementElevation.name"),
    hint: game.i18n.localize("elevationruler.keybindings.incrementElevation.hint"),
    editable: [
      { key: "BracketRight"}
    ],
    onDown: () => canvas.controls.ruler.incrementElevation(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}
