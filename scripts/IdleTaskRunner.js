/* globals
requestIdleCallback,
window,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/**
 * Utility to run generators with different scheduling strategies.
 * Used to run complex tasks only during idle time to improve UI responsiveness.
 * (Presumably tasks that would be difficult to shift to a worker.)
 */
export class IdleTaskRunner {

  /**
   * Run a generator until completion during idle time.
   * @param {generator} generator
   * @param {AbortSignal} [signal]
   * @returns {Promise<any>} Final value returned by the generator
   */
  static runIdle(generator, signal = {}) {
    return new Promise((resolve, reject) => {
      const step = deadline => {
        if ( signal.aborted ) {
          console.debug("IdleTaskRunner|runIdle aborted.");
          return resolve(null);
        }
        try {
          // Process while time remains in the frame.
          while ( deadline.timeRemaining() > 0 ) {
            console.debug(`runIdle|${deadline.timeRemaining()} ms`);
            const { value, done } = generator.next();
            if ( done ) return resolve(value);
            if ( signal.aborted ) return resolve(null);
          }
          // Out of time, schedule the next chunk
          requestIdleCallback(step);

        } catch(err) {
          reject(err);
        }
      };
      requestIdleCallback(step);
    });
  }

  /**
   * Runs a generator immediately (blocking).
   */
  static runPriority(generator, signal = {}) {
    let result = generator.next();
    while ( !result.done ) {
      if ( signal.aborted ) return null; // Cannot really occur unless in worker.
      result = generator.next();
    }
    return result.value;
  }

  /**
   * Run a generator until completion during idle time.
   * @param {generator} generator
   * @param {AbortSignal} [signal]
   * @returns {Promise<any>} Final value returned by the generator
   */
  static async asyncRunIdle(asyncGenerator, signal = {}) {
    return new Promise((resolve, reject) => {
      const step = async deadline => {
        if ( signal.aborted ) {
          console.debug("IdleTaskRunner|runIdle aborted.");
          return resolve(null);
        }

        // Note: since we await, "deadline" might expire during the await.
        try {
          // Process while time remains in the frame.
          while ( deadline.timeRemaining() > 0 ) {
            const { value, done } = await asyncGenerator.next();
            if ( done ) return resolve(value);
            if ( signal.aborted ) return resolve(null);
          }

          // Out of time, schedule the next chunk
          requestIdleCallback(step);

        } catch(err) {
          reject(err);
        }
      };
      requestIdleCallback(step);
    });
  }

  /**
   * Runs a generator immediately (blocking).
   */
  static async asyncRunPriority(asyncGenerator, signal = {}) {
    let result = await asyncGenerator.next();
    while ( !result.done ) {
      if ( signal.aborted ) return null; // Cannot really occur unless in worker.
      result = await asyncGenerator.next();
    }
    return result.value;
  }
}

// Shim if requestIdleCAllback is missing. Looking at you, Safari.
window.requestIdleCallback = window.requestIdleCallback
  || function(cb) { return setTimeout(() => cb({ timeRemaining: () => 1 }), 1); };
