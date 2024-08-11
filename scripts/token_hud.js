/* globals
CONFIG,
game
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/* Adapted from Elevation Drag Ruler
https://github.com/PepijnMC/ElevationDragRuler/blob/main/scripts/token_hud.js
MIT License

Copyright (c) 2022 Pepijn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { MODULE_ID, FLAGS, MOVEMENT_TYPES, MOVEMENT_BUTTONS } from "./const.js";
import { Settings } from "./settings.js";
import { keyForValue } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.MOVEMENT_SELECTION = {};

/**
 * Hook renderTokenHUD
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
function renderTokenHUD(app, html, _data) {
  const tokenDocument = app.object.document;
  addMovementSelectionButton(tokenDocument, html);
}

PATCHES.MOVEMENT_SELECTION.HOOKS = { renderTokenHUD };

/**
 * Getter: Token.prototype.movementType
 * Return movement type based on the flag and if auto, on token elevation.
 * @type {MOVEMENT_TYPE}
 */
export function movementType() { return movementTypeForTokenAt(this); }

PATCHES.BASIC.GETTERS = { movementType };

/**
 * Get the movement type for a token at a position.
 * @param {Token} token
 * @param {RegionMovementWaypoint|Point3d} position
 * @returns {MOVEMENT_TYPE}
 */
export function movementTypeForTokenAt(token, position) {
  if ( game.system.id === "dnd5e" ) return dnd5eMovementType(token, position);
  return hudMovementType(token, position);
}

/**
 * Movement type using the token HUD
 * @param {Token} token
 * @param {RegionMovementWaypoint|Point3d} position
 * @type {MOVEMENT_TYPE}
 */
function hudMovementType(token, position) {
  const selectedMovement = token.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_SELECTION) ?? MOVEMENT_TYPES.AUTO;
  if ( selectedMovement === MOVEMENT_TYPES.AUTO ) return determineMovementType(token, position);
  return selectedMovement;
}

/**
 * Movement type for dnd5e.
 * If both flying and burrowing, return flying.
 * @param {Token} token
 * @param {RegionMovementWaypoint|Point3d} position
 * @type {MOVEMENT_TYPE}
 */
function dnd5eMovementType(token, position) {
  if ( !token.actor?.statuses ) return "WALK";
  if ( token.actor.statuses.has("flying") ) return "FLY";
  if ( token.actor.statuses.has("burrow") ) return "BURROW";
  if ( Settings.get(Settings.KEYS.AUTO_MOVEMENT_TYPE) ) return determineMovementType(token, position);
  return "WALK";
}

/**
 * Determine movement type based on this token's elevation.
 * @returns {MOVEMENT_TYPE}
 */
function determineMovementType(token, position) {
  position ??= { ...token.center, elevation: token.elevationE, z: token.elevationZ };
  const startingElevation = (position.elevation ?? CONFIG.GeometryLib.utils.pixelsToGridUnits(position.z)) || 0; // Strip NaN
  const groundElevation = CONFIG.Canvas.rulerClass.terrainElevationAtLocation(position, startingElevation);
  return MOVEMENT_TYPES.forCurrentElevation(position.elevation, groundElevation);
}

/**
 * Creates clickable movement selection button and adds it to the Token HUD.
 * @param {TokenDocument} tokenDocument
 * @param {jQuery} html
 */
function addMovementSelectionButton(tokenDocument, html) {
  const selectedMovement = tokenDocument.getFlag(MODULE_ID, FLAGS.MOVEMENT_SELECTION) ?? MOVEMENT_TYPES.AUTO;
  const buttonIcon = MOVEMENT_BUTTONS[selectedMovement];
  const movementButton = createButton("Switch Movement Type", "switch-movement-type", `<i class="fas fa-${buttonIcon} fa-fw"></i>`,
    () => onMovementTypeButtonClick(tokenDocument, html));
  html.find("div.left").append(movementButton);
}

/**
 * Cycles through the token's speeds when the 'Switch Speed' button is clicked.
 * @param {TokenDocument} tokenDocument
 * @param {jQuery} html
 */
async function onMovementTypeButtonClick(tokenDocument, html) {
  const currentType = tokenDocument.getFlag(MODULE_ID, FLAGS.MOVEMENT_SELECTION); // May be undefined.
  const nextTypeName = keyForValue(MOVEMENT_TYPES, currentType + 1) ?? "AUTO";
  await tokenDocument.setFlag(MODULE_ID, FLAGS.MOVEMENT_SELECTION, MOVEMENT_TYPES[nextTypeName]);
  html.find("#switch-movement-type").remove();
  addMovementSelectionButton(tokenDocument, html);
}

/**
 * Basic button factory.
 * @param {string} title
 * @param {string} id
 * @param {html} innerHTML
 * @param {function} clickFunction
 */
function createButton(title, id, innerHTML, clickFunction) {
  const button = document.createElement("div");
  button.classList.add("control-icon");
  button.title = title;
  button.id = id;
  button.innerHTML = innerHTML;
  button.addEventListener("click", clickFunction);
  return button;
}
