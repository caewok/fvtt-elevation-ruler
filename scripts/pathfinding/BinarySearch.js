/* Functions to binary search a sorted array.
Binary, Interpolate, and InterpolateBinary options.
For each, there are versions to work with an array of numbers and an array of objects
that can be scored.

• Binary halves the search each time from the midpoint. O(log(n))
• Interpolate halves the search from a point based on
  where the target value is likely to be given min and max of the array
  and assuming a uniform distribution.
  - Best case: O(log(log(n)))
  - Worse case: O(n).
• InterpolateBinary starts like Interpolate but then runs binary search
  on the two halves of the array. This repeats for each subsequent iteration.

If the array is close to uniformly distributed, like the output of
Math.random(), then Interpolate will likely be fastest. If relatively
uniform but might have jumps/gaps, then InterpolateBinary may do better.
If not uniform at all, Binary may be best.

If normally distributed, Interpolation search likely very slow
but Binary and InterpolateBinary may perform similarly.

Type of searching:
• indexOf: Comparable to Array.indexOf, for numeric arrays.
• indexOfCmp: Comparable to Array.indexOf, but takes the comparator used to sort the array
              Used when the array elements are sorted objects.
• findIndex: Comparable to Array.findIndex. Finds the first element that is true
             for a comparison function. Requires that once true, every subsequent
             element in the sorted array is true.

*/

/**
 * Find the index of a value in a sorted array of numbers.
 * Comparable to Array.indexOf but uses binary search.
 * O(log(n)) time.
 * @param {Number[]} arr    Array to search. Must be sorted low to high.
 * @param {Number} x        Value to locate.
 * @return {Number|-1}      Index of the value or -1 if not found.
 * Example:
 * cmpNum = (a, b) => a - b;
 * arr = [0,1,2,3,4,5,6,7]
 * arr.sort(cmpNum)
 * binaryIndexOf(arr, 2)
 * arr.indexOf(2)
 */
export function binaryIndexOf(arr, x) {
  let start = 0;
  let end = arr.length - 1;

  // Iterate, halving the search each time.
  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    if (arr[mid] === x) return mid;

    if (arr[mid] < x) {
      start = mid + 1;
    } else {
      end = mid - 1;
    }
  }
  return -1;
}

/**
 * Find the index of a value in a sorted array of objects.
 * Comparable to Array.indexOf but uses binary search.
 * O(log(n)) time.
 * @param {Number[]} arr    Array to search. Must be sorted low to high.
 * @param {Number} obj      Object to locate.
 * @param {Function} cmpFn  Comparison function to use. Typically should be function
 *                          used to sort the array. Must return 0 if elem === obj.
 * @return {number|-1}      Index of the value or -1 if not found.
 * Example:
 * cmpNum = (a, b) => a - b;
 * arr = [0,1,2,3,4,5,6,7]
 * arr.sort(cmpNum)
 * binaryIndexOfCmp(arr, 2, cmpNum)
 * arr.indexOf(2)
 */
export function binaryIndexOfObject(arr, obj, cmpFn = (a, b) => a - b) {
  let start = 0;
  let end = arr.length - 1;

  // Iterate, halving the search each time.
  while (start <= end) {
    let mid = Math.floor((start + end) / 2);
    let res = cmpFn(obj, arr[mid], mid);
    if (!res) { return mid; }

    if (res > 0) {
      start = mid + 1;
    } else {
      end = mid - 1;
    }
  }
  return -1;
}


/**
 * Find the first element that meets a condition in a sorted array,
 * based on binary search of a sorted array.
 * Comparable to Array.findIndex, but in O(log(n)) time.
 * @param {Object[]} arr          Array to search
 * @param {Function} comparator   Comparison function to call.
 *                                Must return true or false, like with Array.findIndex.
 * @return {number|-1}            Index of the object or -1 if not found.
 *
 * Example:
 * cmpNum = (a, b) => a - b;
 * arr = [0,1,2,3,4,5,6,7]
 * arr.sort(cmpNum)
 * binaryFindIndex(arr, elem => elem > 3)
 * arr.findIndex(elem => elem > 3)
 *
 * binaryFindIndex(arr, elem => cmpNum(3, elem) <= 0)
 * arr.findIndex(elem => elem > cmpNum(3, elem) <= 0)
 *
 * binaryFindIndex(arr, elem => cmpNum(elem, 3) > 0)
 * arr.findIndex(elem => cmpNum(elem, 3) > 0)
 *
 * or
 * arr = Array.fromRange(100).map(elem => Math.random())
 * arr.sort((a, b) => a - b)
 */
export function binaryFindIndex(arr, comparator) {
  let start = 0;
  const ln = arr.length;
  let end = ln - 1;
  let mid = -1;

  // Need first index for which callbackFn returns true
  // b/c the array is sorted, once the callbackFn is true for an index,
  // it is assumed true for the rest.
  // So, e.g, [F,F,F, T, T, T, T]
  // Progressively check until we have no items left.

  // Iterate, halving the search each time we find a true value.
  let last_true_index = -1;
  while (start <= end) {
    // Find the mid index.
    mid = Math.floor((start + end) / 2);

    // Determine if this index returns true.
    const res = comparator(arr[mid], mid);

    if (res) {
      // If the previous is false, we are done.
      if ((mid - 1) >= 0 && !comparator(arr[mid - 1], mid - 1)) { return mid; }
      // If we found a true value, we can ignore everything after mid
      last_true_index = mid;
      end = mid - 1;
    } else {
      // If the next value is true, we are done.
      if ((mid + 1) < ln && comparator(arr[mid + 1], mid + 1)) { return mid + 1; }
      // Otherwise, the first true value might be after mid.
      // (b/c it is sorted, it cannot be before.)
      start = mid + 1;
    }
  }

  return last_true_index;
}

/**
 * Find the index of an object in a sorted array of numbers
 * that is approximately uniformly distributed.
 * Expected O(log(log(n))) but can take up to O(n).
 * @param {Number[]} arr    Array to search
 * @param {Number} x   Value to find.
 * @return {number|-1}      Index of the object found or -1 if not found.
 *
 * Example:
 * cmpNum = (a, b) => a - b;
 * arr = [0,1,2,3,4,5,6,7]
 * arr.sort(cmpNum)
 * interpolationIndexOf(arr, 2)
 * arr.indexOf(2)
 */
export function interpolationIndexOf(arr, x) {
  let start = 0;
  let end = arr.length - 1;
  let position = -1;
  let delta = -1;
  while (start <= end) {
    const v_start = arr[start];
    const v_end = arr[end];
    if (x < v_start || x > v_end) { break; }

    delta = (x - v_start) / (v_end - v_start);
    position = start + Math.floor((end - start) * delta);
    const v_position = arr[position];

    if (v_position === x) {
      return position;
    }

    if (v_position < x) {
      start = position + 1;
    } else {
      end = position - 1;
    }
  }

  return -1;
}


/**
 * Find the index of an object in a sorted array of numbers
 * that is approximately uniformly distributed.
 * Expected O(log(log(n))) but can take up to O(n).
 * @param {Object[]} arr    Array to search
 * @param {Object} obj      Object to find.
 * @param {Function} valuationFn  How to value each object in the array.
 *                                Must be ordered comparable to the sort
 * @return {number|-1}      Index of the object found or -1 if not found.
 *
 * Example:
 * cmpNum = (a, b) => a - b;
 * arr = [0,1,2,3,4,5,6,7]
 * arr.sort(cmpNum)
 * interpolationIndexOf(arr, 2, cmpNum)
 * arr.indexOf(2)
 */
export function interpolationIndexOfObject(arr, obj, valuationFn = a => a) {
  let start = 0;
  let end = arr.length - 1;
  let position = -1;
  let delta = -1;
  const target = valuationFn(obj);
  while (start <= end) {
    const v_start = valuationFn(arr[start]);
    const v_end = valuationFn(arr[end]);
    if (target < v_start || target > v_end) { break; }

    delta = (target - v_start) / (v_end - v_start);
    position = start + Math.floor((end - start) * delta);
    const v_position = valuationFn(arr[position]);

    if (v_position === target) { return position; }

    if (v_position < target) {
      start = position + 1;
    } else {
      end = position - 1;
    }
  }

  return -1;
}


/**
 * Find the first element that meets a condition in a sorted array,
 * where the values in the array are approximately uniformly distributed.
 * Expected O(log(log(n))) but can take up to O(n).
 * @param {Object[]} arr          Array to search
 * @param {Function} comparator   Comparison function to call.
 *                                Must return true or false, like with Array.findIndex.
 * @return {number|-1}      Index of the object found or -1 if not found.
 * Example:
 * cmpNum = (a, b) => a - b;
 * arr = [0,1,2,3,4,5,6,7]
 * arr.sort(cmpNum)
 * interpolationFindIndexBeforeScalar(arr, elem => elem )
 */
export function interpolationFindIndexBeforeScalar(arr, x) {
  let start = 0;
  let end = arr.length - 1;

  if (x > arr[end]) return end;
  if (x < arr[0]) return -1;

  while (start <= end) {
    const delta = (x - arr[start]) / (arr[end] - arr[start]);
    const position = start + Math.floor((end - start) * delta);

    if (arr[position] === x) return position - 1;

    if (arr[position] < x) {
      if (arr[position + 1] > x) return position;
      start = position + 1;
    } else {
      if (arr[position - 1] < x) return position - 1;
      end = position - 1;
    }
  }
  return -1;
}


/**
 * Find the index of an object that is less than but nearest value in a sorted array,
 * where the values in the array are approximately uniformly distributed.
 * Probably O(log(log(n))) but can take up to O(n).
 * @param {Object[]} arr    Array to search
 * @param {Object} obj      Object to find.
 * @param {Function} valuationFn  How to value each object in the array.
 *                                Must be ordered comparable to the sort
 * @return {number|-1}      Index of the object found or -1 if not found.
 * Example:
 * cmpNum = (a, b) => a - b;
 * arr = [0,1,2,3,4,5,6,7]
 * arr.sort(cmpNum)
 * interpolationFindIndexBeforeObj(arr, 2.5)
 */
export function interpolationFindIndexBeforeObject(arr, obj, valuationFn = a => a) {
  let start = 0;
  let end = arr.length - 1;
  const x = valuationFn(obj);

  if (x > valuationFn(arr[end])) return end;
  if (x < valuationFn(arr[0])) return -1;

  while (start <= end) {
    const v_start = valuationFn(arr[start]);
    const v_end = valuationFn(arr[end]);

    const delta = (x - v_start) / (v_end - v_start);
    const position = start + Math.floor((end - start) * delta);
    const v_position = valuationFn(arr[position]);

    if (v_position === x) return position - 1;

    if (v_position < x) {
      if (valuationFn(arr[position + 1]) > x) return position;
      start = position + 1;
    } else {
      if (valuationFn(arr[position - 1]) < x) return position - 1;
      end = position - 1;
    }
  }
  return -1;
}

/**
 * Find the index of a value in a sorted array of numbers.
 * Comparable to Array.indexOf but uses interpolation and binary search together.
 * Expected time of between O(log(n)) and O(log(log(n))).
 * Implements https://www.sciencedirect.com/science/article/pii/S221509862100046X
 * @param {Number[]}  arr   Array to search. Must be sorted low to high.
 * @param {Number}    x     Value to locate
 * @return {Number|-1} Index of the value or -1 if not found
 */
export function interpolateBinaryIndexOf(arr, x) {
  let left = 0;
  let right = arr.length - 1;

  if (x > arr[right] || x < arr[0]) { return -1; }

  while (left < right) {
    if (x < arr[left] || x > arr[right]) { break; }

    const inter = left + Math.ceil((x - arr[left]) / (arr[right] - arr[left]) * (right - left));

    if (x === arr[inter]) {
      return inter;
    } else if (x > arr[inter]) {
      const mid = Math.floor((inter + right) / 2);
      if (x <= arr[mid]) {
        left = inter + 1;
        right = mid;
      } else {
        left = mid + 1;
      }
    } else {
      const mid = Math.floor((inter + left) / 2);
      if (x >= arr[mid]) {
        left = mid;
        right = inter - 1;
      } else {
        right = mid - 1;
      }
    }
  }

  if (x === arr[left]) { return left; }
  return -1;
}

/**
 * Find the index of a value in a sorted array of numbers.
 * Comparable to Array.indexOf but uses interpolation and binary search together.
 * Expected time of between O(log(n)) and O(log(log(n))).
 * Implements https://www.sciencedirect.com/science/article/pii/S221509862100046X
 * @param {Number[]}  arr   Array to search. Must be sorted low to high.
 * @param {Number}    x     Value to locate
 * @return {Number|-1} Index of the value or -1 if not found
 */
export function interpolateBinaryFindIndexBeforeScalar(arr, x) {
  let left = 0;
  let right = arr.length - 1;

  if (x > arr[right]) { return right; }
  if (x < arr[0]) { return -1; }

  while (left < right) {
    if (x < arr[left] || x > arr[right]) { break; }

    const inter = left + Math.ceil((x - arr[left]) / (arr[right] - arr[left]) * (right - left));

    if (x === arr[inter]) {
      return inter - 1;
    } else if (x > arr[inter]) {
      const mid = Math.floor((inter + right) / 2);
      if (x <= arr[mid]) {
        left = inter + 1;
        right = mid;
      } else {
        left = mid + 1;
      }
    } else {
      const mid = Math.floor((inter + left) / 2);
      if (x >= arr[mid]) {
        left = mid;
        right = inter - 1;
      } else {
        right = mid - 1;
      }
    }
  }


  if (x > arr[left - 1] && x < arr[left]) { return left - 1; }
  if (x > arr[right] && x < arr[right + 1]) { return right; }

  return -1;
}

/**
 * Find the index of a value in a sorted array of objects that can be scored.
 * Comparable to Array.indexOf but uses interpolation and binary search together.
 * Expected time of between O(log(n)) and O(log(log(n))).
 * Implements https://www.sciencedirect.com/science/article/pii/S221509862100046X
 * @param {Number[]}  arr   Array to search. Must be sorted low to high.
 * @param {Object} obj      Object to find.
 * @param {Function} valuationFn  How to value each object in the array.
 *                                Must be ordered comparable to the sort
 * @return {Number|-1} Index of the value or -1 if not found
 */
export function interpolateBinaryFindIndexBeforeObject(arr, obj, valuationFn = a => a) {
  let left = 0;
  let right = arr.length - 1;
  const x = valuationFn(obj);

  if (x > valuationFn(arr[right])) { return right; }
  if (x < valuationFn(arr[0])) { return -1; }

  while (left < right) {
    const v_left = valuationFn(arr[left]);
    const v_right = valuationFn(arr[right]);
    if (x < v_left || x > v_right) { break; }

    const inter = left + Math.ceil((x - v_left) / (v_right - v_left) * (right - left));
    const v_inter = valuationFn(arr[inter]);

    if (x === v_inter) {
      return inter - 1;
    } else if (x > v_inter) {
      const mid = Math.floor((inter + right) / 2);
      if (x <= valuationFn(arr[mid])) {
        left = inter + 1;
        right = mid;
      } else {
        left = mid + 1;
      }
    } else {
      const mid = Math.floor((inter + left) / 2);
      if (x >= valuationFn(arr[mid])) {
        left = mid;
        right = inter - 1;
      } else {
        right = mid - 1;
      }
    }
  }

  if (x > valuationFn(arr[left - 1]) && x < valuationFn(arr[left])) { return left - 1; }
  if (x > valuationFn(arr[right]) && x < valuationFn(arr[right + 1])) { return right; }

  return -1;
}
