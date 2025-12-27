/* globals
foundry,
Hooks,
libWrapper,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

/**
 * Class to control patching: libWrapper, hooks, added methods.
 * Patcher is primarily used to register arbitrary groups of patches.
 * Patcher can also register/deregister specific patches.
 */
export class Patcher {

  /** @type {Set<string>} */
  registeredGroups = new Set();

  /** @type {WeakSet<PatchAbstract>} */
  registeredPatches = new WeakSet();

  /** @type {Map<string, Set<PatchAbstract>} */
  groupings = new Map();

  /** @type {Set<PatchAbstract>} */
  patches = new Set();

  groupIsRegistered(groupName) { return this.registeredGroups.has(groupName); }

  /** @type {Set<PatchAbstract>} */
  groupPatches(groupName) {
    if ( !this.groupings.has(groupName) ) this.groupings.set(groupName, new Set());
    return this.groupings.get(groupName);
  }

  /**
   * Add new patch to track.
   * @param {PatchAbstract} patch     Patch to add to patch groups tracked by Patcher
   * @param {boolean} [register=true] Whether to register the patch if group is registered
   */
  addPatch(patch, register = true) {
    this.patches.add(patch);
    this.groupPatches(patch.group).add(patch);
    if ( register && this.groupIsRegistered(patch.group) ) this.registerPatch(patch);
  }

  /**
   * Remove a patch from the tracker.
   * If the patch is registered, deregister.
   * @param {PatchAbstract} patch       Patch to remove from patch groups tracked by Patcher
   * @param {boolean} [deregister=true] Whether to deregister the patch when removing it
   */
  removePatch(patch, deregister = true) {
    if ( !this.patches.has(patch) ) return;
    if ( deregister && this.registeredPatches.has(patch) ) this.deregisterPatch(patch);
    this.patches.delete(patch);
    const patchGroup = this.groupPatches(patch.group);
    patchGroup.delete(patch);

    // If last patch in a group is removed, mark the group as unregistered.
    if ( !patchGroup.size ) this.registeredGroups.delete(patch.group);
  }

  /**
   * Register this patch.
   * If the patch is not in Patcher, add it.
   * This does not affect group registration. I.e., if the patch group is not registered,
   * this patch (but not its group) will be registered.
   * @param {PatchAbstract} patch     Patch to register
   */
  registerPatch(patch) {
    if ( !this.patches.has(patch) ) this.addPatch(patch);
    if ( this.registeredPatches.has(patch) ) return;
    patch.register();
    this.registeredPatches.add(patch);
  }

  /**
   * Deregister this patch.
   * @param {PatchAbstract} patch   Patch to deregister
   */
  deregisterPatch(patch) {
    if ( !this.registeredPatches.has(patch) ) return;
    patch.deregister();
    this.registeredPatches.delete(patch);
  }

  /**
   * Register a grouping of patches.
   * @param {string} groupName    Name of group to register
   */
  registerGroup(groupName) {
    if ( this.groupIsRegistered(groupName) || !this.groupings.has(groupName) ) return;
    this.groupings.get(groupName).forEach(patch => this.registerPatch(patch));
    this.registeredGroups.add(groupName);
  }

  /**
   * Deregister a grouping of patches.
   * @param {string} groupName    Name of group to deregister
   */
  deregisterGroup(groupName) {
    if ( !this.groupIsRegistered(groupName) ) return;
    this.groupings.get(groupName).forEach(patch => this.deregisterPatch(patch));
    this.registeredGroups.delete(groupName);
  }

  /**
   * Primarily for backward compatibility.
   * Given an object of class names, register patches for each.
   * - className0
   *   - groupNameA
   *     - WRAPS, METHODS, etc.
   *     - method/hook
   *     - function
   * @param {registrationObject} regObj
   */
  addPatchesFromRegistrationObject(regObj) {
    // Cannot use mergeObject because it breaks for names like "PIXI.Circle".
    for ( const [clName, patchClass] of Object.entries(regObj) ) {
      for ( const [groupName, patchGroup] of Object.entries(patchClass) ) {
        for ( const [typeName, patchType] of Object.entries(patchGroup) ) {
          for ( const [patchName, patch] of Object.entries(patchType) ) {
            let patchCl;
            let cfg = {
              group: groupName,
              perf_mode: libWrapper.PERF_FAST,
              className: clName,
              isStatic: typeName.includes("STATIC") };
            switch ( typeName ) {
              case "HOOKS": patchCl = HookPatch; break;

              case "STATIC_OVERRIDES":
              case "OVERRIDES":
              case "STATIC_MIXES":
              case "MIXES":
              case "STATIC_WRAPS":
              case "WRAPS":
                patchCl = LibWrapperPatch;
                cfg.libWrapperType = typeName.includes("OVERRIDES")
                  ? libWrapper.OVERRIDE : typeName.includes("MIXES")
                    ? libWrapper.MIXED : libWrapper.WRAPPER;
                break;

              case "STATIC_GETTERS":
              case "GETTERS":
                cfg.isGetter = true;
                patchCl = MethodPatch;
                break;

              case "STATIC_SETTERS":
              case "SETTERS":
                cfg.isSetter = true;
                patchCl = MethodPatch;
                break;

              default:
                patchCl = MethodPatch;
            }
            const thePatch = patchCl.create(patchName, patch, cfg);
            this.addPatch(thePatch);
          }
        }
      }
    }
  }

  /**
   * Add a method or a getter to a class.
   * @param {class} cl      Either Class.prototype or Class
   * @param {string} name   Name of the method
   * @param {function} fn   Function to use for the method
   * @param {object} [opts] Optional parameters
   * @param {boolean} [opts.getter]     True if the property should be made a getter.
   * @param {boolean} [opts.optional]   True if the getter should not be set if it already exists.
   * @returns {undefined|object<id{string}} Either undefined if the getter already exists or the cl.prototype.name.
   */
  static addClassMethod(cl, name, fn, { getter = false, setter = false, optional = false } = {}) {
    if ( optional && Object.hasOwn(cl, name) ) return undefined;
    const descriptor = { configurable: true };

    // For getters and setters, keep the getter when creating a setter and vice-versa
    if ( getter ) {
      descriptor.get = fn;
      const currentSetter = Object.getOwnPropertyDescriptor(cl, name)?.set;
      if ( currentSetter ) descriptor.set = currentSetter;
    } else if ( setter ) {
      descriptor.set = fn;
      const currentGetter = Object.getOwnPropertyDescriptor(cl, name)?.get;
      if ( currentGetter ) descriptor.get = currentGetter;
    } else {
      descriptor.writable = true;
      descriptor.value = fn;
    }
    Object.defineProperty(cl, name, descriptor);

    const prototypeName = cl.constructor?.name;
    const id = `${prototypeName ?? cl.name}.${prototypeName ? "prototype." : ""}${name}`;
    return { id, args: { cl, name } };
  }

  /**
   * A thorough lookup method to locate Foundry classes by name.
   * Relies on CONFIG where possible, falling back on eval otherwise.
   * @param {string|function} className         Class name or namespace path to class or the class function
   * @param {object} [opts]
   * @param {boolean} [opts.returnPathString]   Return a string path to the object, primarily for libWrapper.
   * @returns {class|string|null}
   */
  static lookupByClassName(className, { returnPathString = false } = {}) {
    if ( typeof className === "function" ) return returnPathString ? lookup(className.name) : className;

    // Is a class name or path.
    // Class names cannot have periods in JS.
    // Either, e.g.:
    // • Token
    // • foundry.canvas.placeables.Token <-- Always starts with "foundry."
    // • some.other.module.namespace.TokenClass
    const path = className.includes(".") ? className : lookup(className);
    if ( path ) {
      try {
        const cl = eval?.(`"use strict";(${className})`);
        if ( typeof cl === "function" ) return returnPathString ? className : cl;
      } catch(error) { /* empty */ } /* eslint-disable-line no-unused-vars */
    }
    console.error(`lookupByClassName|${className} not found`);
    return null;
  }

  /**
   * Split out the class name from the method name and determine if there is a prototype.
   * Assumes "." demarcate parts of the name.
   * @param {string} str    String from which to extract.
   * @returns {object}
   * - {string} className   Class such as Token or PIXI.Rectangle
   * - {boolean} isStatic   True if no "prototype" found in the string
   * - {string} methodName  Everything after "prototype" or the last piece of the string.
   */
  static splitClassMethodString(str) {
    str = str.split(".");
    const methodName = str.pop();
    const notStatic = str.at(-1) === "prototype";
    if ( notStatic ) str.pop();
    const className = str.join(".");
    return { className, isStatic: !notStatic, methodName };
  }
}

// ----- NOTE: Patch classes ----- //

// Key to force the Patch constructor to be private.
const secretToken = Symbol("secretToken");

class AbstractPatch {

  /** @type {object} */
  config = {};

  /** @type {function} */
  patchFn;

  /** @type {string} */
  target;

  /** @type {string} */
  regId;

  /**
   * @param {string} target     The hook or class.method that is being patched
   * @param {function} patchFn  The function to use for the patch
   */
  constructor(token, target, patchFn) {
    // Needed so that create can be the primary function.
    if ( token !== secretToken ) console.error("AbstractPatch constructor is private! Use static `create` method.");
    this.target = target;
    this.patchFn = patchFn;
  }

  /**
   * Instantiate a patch object. Use this instead of the constructor in order to configure it.
   * @param {string} target     The hook or class.method that is being patched
   * @param {function} patchFn  The function to use for the patch
   * @param {object} [config]     Optional parameters that modify the patch
   * @returns {AbstractPatch}
   */
  static create(target, patchFn, config) {
    const obj = new this(secretToken, target, patchFn);
    obj._configure(config);
    return obj;
  }

  /**
   * Instantiate many patches using the same underlying configuration.
   * Each patch in the object are described by { target: patchFn }.
   * @param {object} obj        Each patch in the object are described by { target: patchFn }
   * @param {object} [config]     Optional parameters that modify the patch
   * @returns {AbstractPatch[]}
   */
  static createFromObject(obj, config) {
    const patches = [];
    for ( const [target, patchFn] of Object.entries(obj) ) patches.push(this.create(target, patchFn, config));
    return patches;
  }

  /**
   * Configure this patch with optional settings that affect how the patch is applied.
   * @param {object} config
   */
  _configure(config = {}) {
    const cfg = this.config;
    cfg.group = config.group || "BASIC";
  }

  /** @type {boolean} */
  get isRegistered() { return Boolean(this.regId); }

  /** @type {string} */
  get group() { return this.config.group; }
}

export class HookPatch extends AbstractPatch {

  /**
   * Register this hook.
   */
  register() {
    if ( this.isRegistered ) return;
    this.regId = Hooks.on(this.target, this.patchFn);
  }

  /**
   * Deregister this hook.
   */
  deregister() {
    if ( !this.isRegistered ) return;
    Hooks.off(this.target, this.regId);
    this.regId = undefined;
  }
}

export class MethodPatch extends AbstractPatch {

  /** @type {function} */
  prevMethod;

  /**
   * @param {object} [config]               Optional parameters that modify the patch
   * @param {string} [config.className]     Class name to use; checked against Foundry CONFIG.
   * @param {string} {config.isStatic}      If true, treat as static method (not class.prototype).
   * @param {string} {config.isGetter}      If true, add the method as a getter.
   */
  _configure(config = {}) {
    super._configure(config);
    const cfg = this.config;

    // If class name is not supplied, infer parameters from the target string.
    if ( !config.className ) {
      const res = Patcher.splitClassMethodString(this.target);
      this.target = res.methodName;
      config.className = res.className;
      config.isStatic ??= res.isStatic;
    }

    cfg.isGetter = Boolean(config.isGetter);
    cfg.isSetter = Boolean(config.isSetter);
    if ( cfg.isGetter && cfg.isSetter ) console.warn("Patcher|Getter and Setter both true; you probably only want 1 at a time!");

    cfg.isStatic = Boolean(config.isStatic);
    this.cl = config.className;
  }

  /** @type {class} */
  #cl;

  set cl(value) {
    const cfg = this.config;
    if ( typeof value !== "string" ) value = value.name; // Can pass the class or the class name as string.
    cfg.className = value;
    this.#cl = Patcher.lookupByClassName(cfg.className);
    if ( !this.#cl ) console.error(`Patcher|${cfg.className} not found!`);
    if ( !cfg.isStatic ) this.#cl = this.#cl.prototype;
  }

  /**
   * Register this method.
   */
  register() {
    if ( this.isRegistered ) return;

    this.prevMethod = Object.getOwnPropertyDescriptor(this.#cl, this.target);
    if ( this.config.isGetter ) this.prevMethod = this.prevMethod?.get;
    else if ( this.config.isSetter ) this.prevMethod = this.prevMethod?.set;
    else this.prevMethod = this.prevMethod?.value;

    this.regId = Patcher.addClassMethod(this.#cl, this.target, this.patchFn, {
      getter: this.config.isGetter, setter: this.config.isSetter
    });
  }

  /**
   * Deregister this method.
   */
  deregister() {
    if ( !this.isRegistered ) return;
    delete this.#cl[this.target]; // Remove the patched method entirely.

    // Add back the original, if any.
    if ( this.prevMethod ) {
      Patcher.addClassMethod(this.#cl, this.target, this.prevMethod, {
        getter: this.config.isGetter, setter: this.config.isSetter
      });
      this.prevMethod = undefined;
    }
    this.regId = undefined;
  }
}

export class LibWrapperPatch extends AbstractPatch {

  /**
   * @param {object} [config]               Optional parameters that modify the patch
   * @param {string} [config.className]     Class name to use; checked against Foundry CONFIG.
   * @param {string} [config.isStatic ]     If true, treat as static method (not class.prototype).
   * @param {enum} [config.libWrapperType]  libWrapper.WRAPPED, MIXED, OVERRIDE
   * @param {enum} [config.perf_mode]       libWrapper.PERF_FAST|PERF_AUTO|PERF_NORMAL
   */
  _configure(config = {}) {
    super._configure(config);
    const cfg = this.config;

    // If class name is not supplied, infer parameters from the target string.
    if ( !config.className ) {
      const res = Patcher.splitClassMethodString(this.target);
      this.target = res.methodName;
      config.className = res.className;
      config.isStatic ??= res.isStatic;
    }

    cfg.isStatic = Boolean(config.isStatic);
    cfg.libWrapperType = config.libWrapperType || "WRAPPER";
    cfg.perf_mode = config.perf_mode || "AUTO";
    this.className = config.className;
  }

  /** @type {string} */
  #className = "";

  set className(value) {
    const cfg = this.config;
    if ( typeof value !== "string" ) value = value.name; // Can pass the class or the class name as string.
    cfg.className = value;
    this.#className = Patcher.lookupByClassName(value, { returnPathString: true });
    if ( !this.#className ) console.error(`Patcher|${cfg.className} not found!`);
    if ( !cfg.isStatic ) this.#className = `${this.#className}.prototype`;
  }

  get wrapperName() { return `${this.#className}.${this.target}`; }

  /**
   * Register this wrapper.
   */
  register() {
    if ( this.isRegistered ) return;
    const { wrapperName, patchFn, config } = this;
    const { libWrapperType, perf_mode } = config;
    this.regId = libWrapper.register(MODULE_ID, wrapperName, patchFn, libWrapperType, { perf_mode });
  }

  /**
   * Deregister this wrapper.
   */
  deregister() {
    if ( !this.isRegistered ) return;
    libWrapper.unregister(MODULE_ID, this.regId, false);
    this.regId = undefined;
  }
}

/**
 * Lookup a class name in the foundry namespace.
 * Recursively traverses the directory.
 * @param {string} className
 * @param {object} [dir=foundry] Starting point
 * @returns {string} The directory path
 */
function lookup(className) {
   const res = lookupRecursive(className);
   if ( res ) return `foundry.${res}`;
 }

 function lookupRecursive(className, dir = foundry) {
  for ( const [key, obj] of Object.entries(dir) ) {
    // Skip CONFIG and CONST directories
    if ( key === "CONFIG" || key === "CONST" ) continue;
    // console.log(`${key}: ${typeof obj}`, obj);

    switch ( typeof obj ) {
      case "function": {
        if ( obj.name === className ) return key;
        break;
      }
      case "object": {
        const res = lookupRecursive(className, obj);
        if ( res ) return `${key}.${res}`;
        break;
      }
    }
  }
  return null;
}
