/* globals
canvas,
foundry,
PIXI,
CONFIG,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "../settings.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";

/**
 * Utility functions for terrain evaluation that can be shared between pathfinding classes
 * to avoid circular dependencies.
 */

export const TERRAIN_FEATURES = {
  NORMAL: 0,
  DIFFICULT: 1,
  BLOCKING: 2,
  IMPASSABLE: 3
};

/**
 * Get the terrain value for a token relative to another token.
 * @param {Token} token - The token to evaluate
 * @param {Token} subjectToken - The token doing the pathfinding
 * @returns {number} - Terrain value from TERRAIN_FEATURES
 */
export function tokenTerrainValue(token, subjectToken) {
  // If the token does not affect the subject, should return NORMAL (not 0, although that could work).
  if ( token === subjectToken ) return TERRAIN_FEATURES.NORMAL;

  // TODO: Add setting to change this.
  if ( token.isProne ) return TERRAIN_FEATURES.NORMAL;
  if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsDead(token) ) return TERRAIN_FEATURES.NORMAL;

  const PATHFINDING = Settings.KEYS.PATHFINDING;
  const blocking = Settings.get(PATHFINDING.TOKENS_BLOCK);
  if ( blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.ALL ) return TERRAIN_FEATURES.BLOCKING;

  const isEnemy = CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsEnemy(subjectToken, token);
  if ( isEnemy && blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.HOSTILE ) return TERRAIN_FEATURES.BLOCKING;

  // No token blocking; check for token difficulties.
  const hostileDifficulty = Settings.get(PATHFINDING.TOKEN_DIFFICULTY.HOSTILE);
  if ( isEnemy ) return hostileDifficulty * TERRAIN_FEATURES.NORMAL;

  const isAlly = CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlly(subjectToken, token);
  const allyDifficulty = Settings.get(PATHFINDING.TOKEN_DIFFICULTY.FRIENDLY);
  if ( isAlly ) return allyDifficulty * TERRAIN_FEATURES.NORMAL;

  return TERRAIN_FEATURES.NORMAL;
}

/**
 * Get the terrain value for a region relative to a token.
 * @param {Region} region - The region to evaluate
 * @param {Token} token - The token doing the pathfinding
 * @returns {number} - Terrain value from TERRAIN_FEATURES
 */
export function regionTerrainValue(region, token) {
  let value = TERRAIN_FEATURES.NORMAL;
  if ( game.system.id === "dnd5e" ) {
    // Treat multiple difficult behaviors as multiplicative.
    const DIFFICULTY_MULTIPLIER = 2;
    for ( const behavior of region.document.behaviors ) {
      if ( behavior.system.difficult ) value *= DIFFICULTY_MULTIPLIER;
      if ( behavior.system.blocked ) value = TERRAIN_FEATURES.IMPASSABLE;
    }
  } else {
    // For other systems, check basic difficult/blocked behaviors
    for ( const behavior of region.document.behaviors ) {
      if ( behavior.system.difficult ) value = TERRAIN_FEATURES.DIFFICULT;
      if ( behavior.system.blocked ) value = TERRAIN_FEATURES.IMPASSABLE;
    }
  }
  return value;
}
