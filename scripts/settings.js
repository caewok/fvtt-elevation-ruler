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

  game.settings.register(MODULE_ID, "enable-elevated-vision-elevation", {
    name: "Use Elevated Vision",
    hint: "Set starting ruler elevations when measuring based on Elevated Vision module.",
    scope: "world",
    config: Boolean(game.modules.get("elevatedvision")),
    default: game.modules.get("elevatedvision")?.active,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "enable-terrain-elevation", {
    name: "Use Enhanced Terrain",
    hint: "Set starting ruler elevations when measuring based on terrain maximum elevation. Requires Enhanced Terrain Elevation module.",
    scope: "world",
    config: Boolean(game.modules.get("enhanced-terrain-layer")),
    default: game.modules.get("enhanced-terrain-layer")?.active,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "enable-levels-elevation", {
    name: "Use Levels",
    hint: "Take into account Levels elevation when measuring. Requires Levels module.",
    scope: "world",
    config: Boolean(game.modules.get("levels")),
    default: game.modules.get("levels")?.active,
    type: Boolean
  });

  game.settings.register(MODULE_ID, "enable-levels-floor-label", {
    name: "Levels Floor Label",
    hint: "Label the ruler with the current floor. Requires Levels module.",
    scope: "world",
    config: Boolean(game.modules.get("levels")),
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
      { key: "BracketLeft"}
    ],
    onDown: decrementElevation,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.keybindings.register(MODULE_ID, "incrementElevation", {
    name: game.i18n.localize("elevationruler.keybindings.incrementElevation.name"),
    hint: game.i18n.localize("elevationruler.keybindings.incrementElevation.hint"),
    editable: [
      { key: "BracketRight"}
    ],
    onDown: incrementElevation,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}
