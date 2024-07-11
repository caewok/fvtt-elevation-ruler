/* globals
canvas,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";

// Patches for the TokenLayer class
export const PATCHES = {};
PATCHES.MOVEMENT_TRACKING = {};

// ----- NOTE: Wraps ----- //

/**
 * Wrap TokenLayer.prototype.storeHistory
 * Add token movement data if the token moved so combat move history can be undone.
 * @param {string} type   The event type (create, update, delete)
 * @param {Object[]} data   The object data
 */
function storeHistory(wrapped, type, data) {
  wrapped(type, data);
  if ( type === "create" ) return;
  data = data.filter(d => Object.keys(d).length > 1); // Filter entries without changes
  if ( !data.length ) return;
  const addedObj = this.history.at(-1);
  const tokenMap = new Map(canvas.tokens.placeables.map(token => [token.id, token]));
  for ( const datum of data ) {
    addedObj[MODULE_ID] ??= {};
    const token = tokenMap.get(datum._id);
    if ( !token ) continue;

    // Copy the current move data.
    token._combatMoveData ??= new Map();
    const lastMoveDistance = token._lastMoveDistance ?? 0;
    const combatMoveData = foundry.utils.duplicate([...token._combatMoveData.entries()]);
    addedObj[MODULE_ID][datum._id] = { lastMoveDistance, combatMoveData };
  }
}

/**
 * Wrap TokenLayer.prototype.undoHistory
 * Reset the tokens' movement data to the previous history.
 * @returns {Promise<Document[]>}     An array of documents which were modified by the undo operation
 */
async function undoHistory(wrapped) {
  const event = this.history.at(-1);
  const res = await wrapped();
  if ( !event || event.type === "create" ) return res; // Create would be undone with deletion, which we can ignore.

  // If deletion event, a new token would be created upon undo. Update with its previous event movement data.
  // If update event, update with previous event movement data.
  if ( !event[MODULE_ID] ) return res;
  const tokenMap = new Map(canvas.tokens.placeables.map(token => [token.id, token]));
  for ( const [id, { lastMoveDistance, combatMoveData }] of Object.entries(event[MODULE_ID]) ) {
    const token = tokenMap.get(id);
    if ( !token ) continue;
    token._lastMoveDistance = lastMoveDistance;
    token._combatMoveData = new Map(combatMoveData);
  }
  return res;
}

PATCHES.MOVEMENT_TRACKING.WRAPS = { storeHistory, undoHistory };
