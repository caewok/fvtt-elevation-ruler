/* globals
canvas,
Hooks,
PIXI,
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { EdgeGraph } from "../EdgeGraph.js";

export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.EdgeGraph`,

  context => {
    const { describe, it, expect, beforeEach } = context;

    // --- NOTE: Initial canvas graph ---
    describe("Initial canvas graph", () => {
      const graph = EdgeGraph.buildFromCanvas();

      it("should have all canvas placeables in the graph", () => {
        for ( const wall of canvas.walls.placeables ) {
          expect(graph.hasPlaceable(wall)).to.be.true;
        }
        for ( const token of canvas.tokens.placeables ) {
          expect(graph.hasPlaceable(token)).to.be.true;
        }
      });

      // --- NOTE: Remove wall from canvas ---
      it("should be able to remove and add wall from graph", () => {
        const wall = canvas.walls.placeables[0];
        if ( wall ) {
          graph.removePlaceable(wall);
          expect(graph.hasPlaceable(wall)).to.be.false;

          graph.addWall(wall);
          expect(graph.hasPlaceable(wall)).to.be.true;
        }
      });

       // --- NOTE: Remove wall from canvas ---
      it("should be able to remove and add token from graph", () => {
        const token = canvas.tokens.placeables[0];
        if ( token ) {
          graph.removePlaceable(token);
          expect(graph.hasPlaceable(token)).to.be.false;

          graph.addToken(token);
          expect(graph.hasPlaceable(token)).to.be.true;
        }
      });
    });

  }, { displayName: "EdgeGraph" });
}
