// Priority queue using a heap
// from https://www.digitalocean.com/community/tutorials/js-binary-heaps

class Node {
  constructor(val, priority) {
    this.val = val;
    this.priority = priority;
  }
}


/**
 * Priority queue using max heap.
 * Highest priority item will be dequeued first.
 */
export class PriorityQueue {
  constructor() {
    this.values = [];
  }

  get length() { return this.values.length; }


 /**
  * Convert a sorted array to a queue
  */
 static fromArray(arr, priorityFn) {
   const pq = new this();

   pq.values = arr.map(elem => new Node(elem, priorityFn(elem)));
   pq.values = radixSortObj(pq.values, "priority").reverse();

   return pq;
 }

 /**
  * Add an object to the queue.
  * @param {Object} val      Object to store in the queue
  * @param {number} priority Priority of the object to store
  */
  enqueue(val, priority) {
    let newNode = new Node(val, priority);
    this.values.push(newNode);
    let index = this.values.length - 1;
    const current = this.values[index];

    while(index > 0) {
      let parentIndex = Math.floor((index - 1) / 2);
      let parent = this.values[parentIndex];

      if(parent.priority <= current.priority) {
        this.values[parentIndex] = current;
        this.values[index] = parent;
        index = parentIndex;
      } else break;
    }
  }

 /**
  * Remove the highest-remaining-priority object from the queue.
  * @return {Object|undefined}  The highest-priority object stored.
  *                             Undefined if queue is empty.
  */
  dequeue() {
    if(this.values.length < 2) return this.values.pop();

    const max = this.values[0];
    const end = this.values.pop();
    this.values[0] = end;

    let index = 0;
    const length = this.values.length;
    const current = this.values[0];
    while(true) {
      let leftChildIndex = 2 * index + 1;
      let rightChildIndex = 2 * index + 2;
      let leftChild, rightChild;
      let swap = null;

      if(leftChildIndex < length) {
        leftChild = this.values[leftChildIndex];
        if(leftChild.priority > current.priority) swap = leftChildIndex;
      }

      if(rightChildIndex < length) {
        rightChild = this.values[rightChildIndex];
        if((swap === null && rightChild.priority > current.priority) ||
           (swap !== null && rightChild.priority > leftChild.priority)) {
          swap = rightChildIndex;
        }
      }

      if(swap === null) break;
      this.values[index] = this.values[swap];
      this.values[swap] = current;
      index = swap;
    }

    return max;
  }
}

/* test
let tree = new PriorityQueue();
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
tree = PriorityQueue.fromArray(arr, priorityFn);
tree.dequeue()

*/