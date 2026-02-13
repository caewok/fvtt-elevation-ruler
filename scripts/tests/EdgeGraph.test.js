/* globals
canvas,
Hooks,
PIXI,
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { EdgeGraph } from "../EdgeGraph.js";

Hooks.on("quenchReady", quench => {
  quench.registerBatch(
    `${MODULE_ID}.EdgeGraph`,

  context => {
    const { describe, it, expect, beforeEach } = context;

    // --- NOTE: Initial canvas graph ---
    describe("Initial canvas graph", () => {
      const graph = EdgeGraph.buildFromCanvas();
      for ( const wall of canvas.walls.placeables ) {
        expect(graph.hasPlaceable(wall)).to.be.true;
      }
      for ( const token of canvas.tokens.placeables ) {
        expect(graph.hasPlaceable(token)).to.be.true;
      }
    });

    // --- NOTE: Remove wall from canvas ---
    describe("Remove wall from graph", () => {
      const graph = EdgeGraph.buildFromCanvas();
      const wall = canvas.walls.placeables[0];
      if ( wall ) {
        graph.removePlaceable(wall);
        expect(graph.hasPlaceable(wall)).to.be.false;

        graph.addPlaceable(wall);
        expect(graph.hasPlaceable(wall)).to.be.true;
      }
    });

     // --- NOTE: Remove wall from canvas ---
    describe("Remove token from graph", () => {
      const graph = EdgeGraph.buildFromCanvas();
      const token = canvas.tokens.placeables[0];
      if ( token ) {
        graph.removePlaceable(token);
        expect(graph.hasPlaceable(token)).to.be.false;

        graph.addPlaceable(token);
        expect(graph.hasPlaceable(token)).to.be.true;
      }
    });

  }, { displayName: "EdgeGraph" });
});
