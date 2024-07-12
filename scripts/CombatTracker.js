/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { TEMPLATES, MODULE_ID, FLAGS } from "./const.js";

// Patches for the Combat tracker

export const PATCHES = {};
PATCHES.BASIC = {};

import { injectConfiguration, renderTemplateSync } from "./util.js";

// ----- NOTE: Hooks ----- //

/**
 * Hook renderCombatTracker
 * Add a button at the top left to clear the current token's movement.
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
function renderCombatTracker(app, html, data) {
  if ( !game.user.isGM ) return;
  const encounterControlsDiv = html.find(".encounter-controls")[0];
  if ( !encounterControlsDiv ) return;
  const combatButtons = encounterControlsDiv.getElementsByClassName("combat-button");
  if ( !combatButtons.length ) return;
  const dividers = encounterControlsDiv.getElementsByTagName("h3");
  if ( !dividers.length ) return;

  const myHtml = renderTemplateSync(TEMPLATES.COMBAT_TRACKER, data);
  // const aElem = document.createElement("a");
  // aElem.innerHTML = myHtml;
  dividers[0].insertAdjacentHTML("beforebegin", myHtml);

  // const npcButton = Object.values(combatButtons).findIndex(b => b.dataset.control === "rollNPC");
  //   const findString = ".combat-button[data-control='rollNPC']";
  //   await injectConfiguration(app, html, data, template, findString);

   html.find(`.${MODULE_ID}`).click(ev => clearMovement.call(app, ev));
}

PATCHES.BASIC.HOOKS = { renderCombatTracker };

async function clearMovement(event) {
  event.preventDefault();
  event.stopPropagation();
  const combat = this.viewed;
  const tokenD = combat?.combatant?.token;
  if ( !tokenD ) return;
  await tokenD.unsetFlag(MODULE_ID, FLAGS.MOVEMENT_HISTORY);
  ui.notifications.notify(`Combat movement history for ${tokenD.name} reset.`);

}
