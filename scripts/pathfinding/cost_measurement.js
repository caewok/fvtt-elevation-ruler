/* globals
canvas,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


import { Point3d } from "../geometry/3d/Point3d.js";
import { tokenTopLeftFromCenter } from "../util.js";

// ----- NOTE: Base cost/heuristic methods ----- //



/**
 * Various helper functions to calculate cost or heuristics in two or three dimensions.
 * Always uses cost ^ 2 so that distanceSquared can be used (no square root).
 */
const COST_FUNCTIONS = {
  D2: {
    euclidean: function(a, b) { return PIXI.Point.distanceSquaredBetween(a, b); },

    manhattan: function(a, b) { // Formula: abs(a.x - b.x) + abs(a.y - b.y)
      using delta = PIXI.Point.tmp;
      a.subtract(b, delta).abs(delta);
      return (delta.x + delta.y) ** 2;
    },
  },

  D3: {
    euclidean: function(a, b) { return Point3d.distanceSquaredBetween(a, b); },

    manhattan: function(a, b) { // Formula: abs(a.x - b.x) + abs(a.y - b.y) + abs(a.z - b.z)
      using delta = Point3d.tmp;
      a.subtract(b, delta).abs(delta);
      return (delta.x + delta.y + delta.z) ** 2;
    },
  },

  foundry: function(a, b) { return canvas.grid.measurePath([a, b]).cost ** 2; },

  terrain: function(a, b) {
    using aTL = tokenTopLeftFromCenter(this.token, a);
    using bTL = tokenTopLeftFromCenter(this.token, b);
    const terrainWaypoints = this.token.createTerrainMovementPath([aTL, bTL]);
    return this.token.measureMovementPath(terrainWaypoints).cost ** 2;
  },
};

// ----- NOTE: Cost ----- //
export const Euclidean2dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = COST_FUNCTIONS.D2.euclidean;
};

export const Euclidean3dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = COST_FUNCTIONS.D3.euclidean;
};

export const Manhattan2dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = COST_FUNCTIONS.D2.manhattan;
};

export const Manhattan3dCost = superclass => class extends superclass {
  /** @type {function} */
  cost = COST_FUNCTIONS.D3.manhattan;
};

export const FoundryMeasureCost = superclass => class extends superclass {
  cost = COST_FUNCTIONS.foundry;
};

export const TokenTerrainCost = superclass => class extends superclass {
  cost = COST_FUNCTIONS.terrain;
};

// ----- NOTE: Heuristic ----- //
export const Euclidean2dHeuristic = superclass => class extends superclass {
  /** @type {function} */
  heuristic = COST_FUNCTIONS.D2.euclidean;
};

export const Euclidean3dHeuristic = superclass => class extends superclass {
  /** @type {function} */
  heuristic = COST_FUNCTIONS.D3.euclidean;
};

export const Manhattan2dHeuristic = superclass => class extends superclass {
  heuristic = COST_FUNCTIONS.D2.manhattan;
};

export const Manhattan3dHeuristic = superclass => class extends superclass {
  heuristic = COST_FUNCTIONS.D3.manhattan;
};

export const FoundryMeasureHeuristic = superclass => class extends superclass {
  heuristic = COST_FUNCTIONS.foundry;
};

export const TokenTerrainHeuristic = superclass => class extends superclass {
  heuristic = COST_FUNCTIONS.terrain;
};
