// Very basic priority queue based on an array
// Allows for a custom comparator on which to sort and the option to switch the
// initial sort algorithm

import { binaryFindIndex } from "./BinarySearch.js";

export class PriorityQueueArray {

 /**
  * @param {Object[]} arr         Array of objects to queue. Not copied.
  * @param {Function} comparator  How to organize the queue. Used for initial sort
  *                               and to insert additional elements.
  *                               Should sort the highest priority item last.
  */
  constructor(arr, { comparator = (a, b) => a - b,
                      sort = (arr, cmp) => arr.sort(cmp) } = {}) {

    this.sort = sort;
    this.comparator = comparator
    this.data = arr;
    this.sort(this.data, this.comparator);
  }

 /**
  * Length of the queue
  * @type {number}
  */
  get length() { return this.data.length; }

 /**
  * Examine the highest priority item in the queue without removing it.
  * @return {Object}
  */
  get peek() { return this.data[this.data.length - 1]; }

 /**
  * Retrieve the next element of the queue
  * @return {Object}  Highest priority item in queue.
  */
  next() { return this.data.pop(); }


 /**
  * Insert an object in the array using a linear search, O(n), to locate the position.
  * @param {Object} obj   Object to insert
  * @return {number}      Index where the object was inserted.
  */
  insert(obj) {
    const idx = this.data.findIndex(elem => this._elemIsAfter(obj, elem));
    this._insertAt(obj, idx);
  }

 /**
  * Insert an object in the array using a binary search, O(log(n)).
  * Requires that the array is strictly sorted according to the comparator function.
  * @param {Object} obj   Object to insert
  */
  binaryInsert(obj) {
    const idx = binaryFindIndex(this.data, elem => this._elemIsAfter(obj, elem));
    this._insertAt(obj, idx);
  }

 /**
  * Helper to insert an object at a specified index. Inserts at end if index is -1.
  * @param {Object} obj   Object to insert
  * @param {number} idx   Location to insert
  */
  _insertAt(obj, idx) {
//     ~idx ? (this.data = this.data.slice(0, idx).concat(obj, this.data.slice(idx))) : this.data.push(obj);
    ~idx ? this.data.splice(idx, undefined, obj) : this.data.push(obj);
  }

 /**
  * Remove object
  */
  remove(obj) {
    const idx = this.data.findIndex(elem => this._elemIsAfter(obj, elem));
    this._removeAt(idx);
  }

 /**
  * Remove object using binary search
  */
  binaryRemove(obj) {
    const idx = binaryFindIndex(this.data, elem => this._elemIsAfter(obj, elem));
    this._removeAt(idx);
  }

 /**
  * Helper to remove an object at a specified index.
  */
  _removeAt(idx) {
    this.data.splice(idx, 1);
  }

 /**
  * Helper function transforming the comparator output to true/false; used by insert.
  * @param {Object} obj   Object to search for
  * @param {Object} elem  Element of the array
  * @return {boolean}     True if the element is after the segment in the ordered array.
  */
  _elemIsAfter(obj, elem) { return this.comparator(obj, elem) < 0; }

}