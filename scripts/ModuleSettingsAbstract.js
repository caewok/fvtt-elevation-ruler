/* globals
game,
Settings
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

// Patches for the Setting class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Wipe the settings cache on update
 */
async function set(wrapper, namespace, key, value, options) {
  if ( namespace === MODULE_ID ) ModuleSettingsAbstract.cache.delete(key);
  return wrapper(namespace, key, value, options);
}

PATCHES.BASIC.WRAPS = { set };

/**
 * Wipe setting cache on update hook.
 * Needed so world settings get wiped from all users.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateSetting(document, changed, options, userId) {
  const [theNamespace, key] = document.key.split(".", 2);
  if ( !(theNamespace || key) ) return;
  if ( theNamespace !== MODULE_ID ) return;
  ModuleSettingsAbstract.cache.delete(key);
}

PATCHES.BASIC.HOOKS = { updateSetting };

export class ModuleSettingsAbstract {
  /** @type {Map<string, *>} */
  static cache = new Map();

  /** @type {object} */
  static KEYS = {};

  // ---- NOTE: Settings static methods ---- //

  /**
   * Retrive a specific setting.
   * Cache the setting.  For caching to work, need to clean the cache whenever a setting below changes.
   * @param {string} key
   * @returns {*}
   */
  static get(key) {

    const cached = this.cache.get(key);
    if ( typeof cached !== "undefined" ) {
    // For debugging, can confirm against what the value should be.
//       const origValue = game.settings.get(MODULE_ID, key);
//       if ( origValue !== cached ) {
//         console.debug(`Settings cache fail: ${origValue} !== ${cached} for key ${key}`);
//         return origValue;
//       }

      return cached;

    }
    const value = game.settings.get(MODULE_ID, key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set a specific setting.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  static async set(key, value) { return game.settings.set(MODULE_ID, key, value); }

  static async toggle(key) {
    const curr = this.get(key);
    return this.set(key, !curr);
  }

  /**
   * Register a specific setting.
   * @param {string} key        Passed to registerMenu
   * @param {object} options    Passed to registerMenu
   */
  static register(key, options) { game.settings.register(MODULE_ID, key, options); }

  /**
   * Register a submenu.
   * @param {string} key        Passed to registerMenu
   * @param {object} options    Passed to registerMenu
   */
  static registerMenu(key, options) { game.settings.registerMenu(MODULE_ID, key, options); }

  /**
   * Localize a setting key.
   * @param {string} key
   */
  static localize(key) { return game.i18n.localize(`${MODULE_ID}.settings.${key}`); }

  /**
   * Register all settings
   */
  static registerAll() {}

  /**
   * Check the stored value for a setting.
   * Typically used to retrieve stored setting values prior to registration. E.g., in data migration.
   * @param {string} storageKey                         The key from Settings.KEYS
   * @param {"world"|"client"} [storageType="world"]    Whether this is a client or a world setting
   * @returns {string|undefined} The stored setting as a string
   */
  static _getStorageValue(storageKey, storageType = "world") {
    if ( !game.settings?.storage ) return undefined;
    if ( storageType === "client" ) return game.settings.storage.get(storageType).getItem(`${MODULE_ID}.${storageKey}`);
    return game.settings.storage.get(storageType).getSetting(`${MODULE_ID}.${storageKey}`).value;
  }
}
