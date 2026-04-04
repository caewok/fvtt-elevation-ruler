// Very basic priority queue based on an array
// Allows for a custom comparator on which to sort and the option to switch the
// initial sort algorithm

import { binaryFindIndex } from "./BinarySearch.js";
import { radixSortObj } from "../geometry/RadixSort.js";

class Node {
  /** @param {object} */
  value = {};

  /** @param {number} */
  priority = -1;

  constructor(value, priority) {
    this.value = value;
    this.priority = priority;
  }
}

/**
 * For speed, this class adds a "_priority" object to each data object
 * instead of using a Node class.
 */
export class PriorityQueue {
  /** @param {object[]} */
  data = [];

  /**
   * @type {function}
   *   - @param {Node} elem
   *   - @param {Node} obj
   *   - @returns {boolean}  True if elem has a higher priority than obj.
   *     False if they are even or obj has higher priority.
   */
  comparator;

  /**
   * @param {"high"|"low"|function} comparator    What is the first element to leave the queue:
   *                                              - highest priority,
   *                                              - lowest priority, or
   *                                              - custom comparator method
   */
  constructor(comparator = "high") {
    switch ( comparator ) {
      case "high": this.comparator = (elem, obj) => elem.priority > obj.priority; break;
      case "low": this.comparator = (elem, obj) => elem.priority < obj.priority; break;
      default: {
        if ( !(comparator instanceof Function) ) console.error("PriorityQueue|Comparator must be a function.", comparator);
        this.comparator = comparator;
      }
     }
  }

  /** @type {number} */
  get length() { return this.data.length; }

  /** @type {number} */
  clear() { this.data.length = 0; }

  /**
   * Convert a sorted array to a queue
   */
  static fromArray(arr, priorityFn, comparator) {
   if ( comparator instanceof Function ) console.error("PriorityQueue.fromArray|Comparator must be 'high' or 'low'.");
   const pq = new this(comparator);
   pq.data = arr.map(elem => new Node(elem, priorityFn(elem)));
   pq.data = radixSortObj(pq.data, "priority")
   if ( comparator === "low" ) pq.data.reverse();
   return pq;
  }


  /**
   * Add an object to the queue
   * @param {Object} val      Object to store in the queue
   * @param {number} priority Priority of the object to store
   */
  enqueue(val, priority) {
    const node = new Node(val, priority);
    const idx = this.findPriorityIndex(node);
    this._insertAt(node, idx);
  }

  /**
   * Remove the highest priority object from the queue
   * @return {Object|undefined}
   */
  dequeue() { return this.data.pop()?.value; }

  /**
   * Examine the highest priority item in the queue without removing it.
   * @return {Object}
   */
  get peek() { return this.data.at(-1)?.value; }

  /**
   * Helper to insert an object at a specified index. Inserts at end if index is -1.
   * @param {Object} obj   Object to insert
   * @param {number} idx   Location to insert
   */
  _insertAt(node, idx) {
    if ( ~idx ) this.data.splice(idx, undefined, node);
    else this.data.push(node);
  }

  /**
   * Find the index of an object in this queue, or the index where the object would be.
   * @param {object} object   Object, with "_priority" property.
   * @returns {number}
   */
  findPriorityIndex(obj) { return binaryFindIndex(this.data, elem => this.comparator(elem, obj)); }
}

/* test
Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevationruler").api
PriorityQueueArray = api.pathfinding.PriorityQueueArray;


let tree = new PriorityQueueArray();
tree.enqueue(3,2);
tree.enqueue(4, 5);
tree.enqueue(31, 1);
tree.enqueue(6, 3);
console.log(tree.dequeue()); // 4
console.log(tree.dequeue()); // 6
console.log(tree.dequeue()); // 3
console.log(tree.dequeue()); // 31

// from an array
priorityFn = (a) => a;
arr = [1,3,2,10,5]
tree = PriorityQueueArray.fromArray(arr, priorityFn);
console.log(tree.dequeue()); // 10
console.log(tree.dequeue()); // 5
console.log(tree.dequeue()); // 3
console.log(tree.dequeue()); // 2
console.log(tree.dequeue()); // 1

// Reverse
let tree = new PriorityQueueArray("low");
tree.enqueue(3,2);
tree.enqueue(4, 5);
tree.enqueue(31, 1);
tree.enqueue(6, 3);
console.log(tree.dequeue()); // 31
console.log(tree.dequeue()); // 3
console.log(tree.dequeue()); // 6
console.log(tree.dequeue()); // 4

// Reverse array
tree = PriorityQueueArray.fromArray(arr, priorityFn, "low");
console.log(tree.dequeue()); // 1
console.log(tree.dequeue()); // 2
console.log(tree.dequeue()); // 3
console.log(tree.dequeue()); // 5
console.log(tree.dequeue()); // 10


function testArr(comparator = "high") {
  const priorityFn = (a) => a;
  const length = Math.ceil(Math.random() * 100);
  const arr = Array(length);
  for ( let i = 0; i < length; i += 1 ) arr[i] = Math.ceil(Math.random() * 100);
  const pq = PriorityQueueArray.fromArray(arr, priorityFn, comparator);
  let prev = pq.dequeue();
  let i = 0;
  while ( pq.length ) {
    i += 1;
    const curr = pq.dequeue();
    if ( pq.comparator({priority: curr}, {priority: prev}) ) {
      console.error(`Failed dequeue at i=${i}`, pq, arr);
      return false;
    }
  }
  return true;
}

function test(comparator = "high") {
  const priorityFn = (a) => a;
  const length = Math.ceil(Math.random() * 100);
  const pq = new PriorityQueueArray(comparator);
  for ( let i = 0; i < length; i += 1 ) {
    const priority = Math.ceil(Math.random() * 100);
    pq.enqueue(priority, priority); // So we can confirm priority later.
  }

  let prev = pq.dequeue();
  let i = 0;
  while ( pq.length ) {
    i += 1;
    const curr = pq.dequeue();
    if ( pq.comparator({priority: curr}, {priority: prev}) ) {
      console.error(`Failed dequeue at i=${i}`, pq, arr);
      return false;
    }
  }
  return true;
}

test("high")
test("low")
testArr("high")
testArr("low")


*/