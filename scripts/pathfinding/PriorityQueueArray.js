// Very basic priority queue based on an array
// Allows for a custom comparator on which to sort and the option to switch the
// initial sort algorithm

import { binaryFindIndex } from "./BinarySearch.js";
import { radixSortObj } from "../geometry/RadixSort.js";

/**
 * For speed, this class adds a "_priority" object to each data object
 * instead of using a Node class.
 */
export class PriorityQueueArray {
  /** @param {object[]} */
  data = [];

  /** @param {function} */
  comparator = (elem, obj) => (obj._priority - elem._priority) < 0;

  /**
   * @param {"high"|"low"|function} comparator    What is the first element to leave the queue:
   *                                              - highest priority,
   *                                              - lowest priority, or
   *                                              - custom comparator method
   */
  constructor(comparator = "high") {
    switch ( comparator ) {
      case "high": break;
      case "low": this.comparator = (elem, obj) => (elem._priority - obj._priority) < 0; break;
      default: this.comparator = comparator;
     }
  }

  /** @type {number} */
  get length() { return this.data.length; }

  /** @type {number} */
  clear() { this.data.length = 0; }

  /**
   * Convert a sorted array to a queue
   */
  static fromArray(arr, priorityFn) {
    const pq = new this();
    pq.data = arr.map(elem => {
      elem._priority = priorityFn(elem);
      return elem;
    });
    pq.data = radixSortObj(pq.data, "_priority").reverse();
  }

  /**
   * Add an object to the queue
   * @param {Object} val      Object to store in the queue
   * @param {number} priority Priority of the object to store
   */
  enqueue(val, priority) {
    val._priority = priority;
    const idx = this.findPriorityIndex(val);
    this._insertAt(val, idx);
  }

  /**
   * Remove the highest priority object from the queue
   * @return {Object|undefined}
   */
  dequeue() { return this.data.pop(); }

  /**
   * Examine the highest priority item in the queue without removing it.
   * @return {Object}
   */
  get peek() { return this.data.at(-1); }

  /**
   * Helper to insert an object at a specified index. Inserts at end if index is -1.
   * @param {Object} obj   Object to insert
   * @param {number} idx   Location to insert
   */
  _insertAt(obj, idx) {
    if ( ~idx ) this.data.splice(idx, undefined, obj);
    else this.data.push(obj);
  }

  /**
   * Find the index of an object in this queue, or the index where the object would be.
   * @param {object} object   Object, with "_priority" property.
   * @returns {number}
   */
  findPriorityIndex(obj) { return binaryFindIndex(this.data, elem => this.comparator(elem, obj)); }
}
