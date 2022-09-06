/* globals
game,
CONST,
canvas
*/
"use strict";

import { MODULE_ID, log } from "./module.js";

export const SETTINGS = {
  PREFER_TOKEN_ELEVATION: "prefer-token-elevation",
  USE_EV: "enable-elevated-vision-elevation",
  USE_TERRAIN: "enable-enhanced-terrain-elevation",
  USE_LEVELS: "enable-levels-elevation",
  USE_LEVELS_LABEL: "enable-levels-floor-label",
  NO_MODS: "no-modules-message"
};

const KEYBINDINGS = {
  INCREMENT: "incrementElevation",
  DECREMENT: "decrementElevation"
};

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

export function registerSettings() {
  log("Registering settings.");

  const evActive = game.modules.get("elevatedvision")?.active;
  const terrainLayerActive = game.modules.get("enhanced-terrain-layer")?.active;
  const levelsActive = game.modules.get("levels")?.active;

  if ( !evActive && !terrainLayerActive && !levelsActive ) {
    game.settings.register(MODULE_ID, SETTINGS.NO_MODS, {
      name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.NO_MODS}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.NO_MODS}.hint`),
      scope: "world",
      config: true,
      enabled: false,
      default: true,
      type: Boolean
    });
  }

  game.settings.register(MODULE_ID, SETTINGS.USE_EV, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_EV}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_EV}.hint`),
    scope: "world",
    config: evActive,
    default: evActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.USE_TERRAIN, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_TERRAIN}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_TERRAIN}.hint`),
    scope: "world",
    config: terrainLayerActive,
    default: terrainLayerActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.USE_LEVELS, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_LEVELS}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_LEVELS}.hint`),
    scope: "world",
    config: levelsActive,
    default: levelsActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.USE_LEVELS_LABEL, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_LEVELS_LABEL}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.USE_LEVELS_LABEL}.hint`),
    scope: "world",
    config: levelsActive,
    default: levelsActive,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.PREFER_TOKEN_ELEVATION, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.PREFER_TOKEN_ELEVATION}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.PREFER_TOKEN_ELEVATION}.hint`),
    scope: "user",
    config: true,
    default: false,
    type: Boolean,
    requiresReload: true
  });

  log("Done registering settings.");
}

export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, KEYBINDINGS.DECREMENT, {
    name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.hint`),
    editable: [
      { key: "BracketLeft" }
    ],
    onDown: () => canvas.controls.ruler.decrementElevation(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.keybindings.register(MODULE_ID, KEYBINDINGS.INCREMENT, {
    name: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.keybindings.${KEYBINDINGS.DECREMENT}.hint`),
    editable: [
      { key: "BracketRight" }
    ],
    onDown: () => canvas.controls.ruler.incrementElevation(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}
