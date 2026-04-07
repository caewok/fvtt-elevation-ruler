/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Import tests
import { registerTests as registerEdgeGraphTests } from "./EdgeGraph.test.js";

export function registerTests(quench) {
  registerEdgeGraphTests(quench);
}
