export interface KitchenOrderNode {
  orderId: string;
  orderNumber: string;
  priorityScore: number;
  confirmedAt: Date;
  userRole?: string;
  isTakeaway?: boolean;
}

/**
 * KitchenPriorityQueue
 * Max Heap data structure for managing kitchen orders by priority score.
 * Complexity: Push O(log N), Pop O(log N), Peek O(1).
 */
export class KitchenPriorityQueue {
  private heap: KitchenOrderNode[] = [];

  /**
   * Get current queue size
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Push a new order node into the Max Heap
   */
  push(node: KitchenOrderNode): void {
    this.heap.push(node);
    this.siftUp(this.heap.length - 1);
  }

  /**
   * Pop the highest-priority order node from the heap
   */
  pop(): KitchenOrderNode | null {
    if (this.size() === 0) return null;
    const root = this.heap[0];
    const lastNode = this.heap.pop()!;

    if (this.size() > 0) {
      this.heap[0] = lastNode;
      this.siftDown(0);
    }
    return root;
  }

  /**
   * Peek at the highest-priority order node without removing it
   */
  peek(): KitchenOrderNode | null {
    return this.size() > 0 ? this.heap[0] : null;
  }

  /**
   * Get all elements in the heap as an array (for queue visualization API)
   */
  toArray(): KitchenOrderNode[] {
    return [...this.heap];
  }

  /**
   * Maintain Max Heap property upwards when inserting
   */
  private siftUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.heap[current].priorityScore <= this.heap[parent].priorityScore) {
        break;
      }
      this.swap(current, parent);
      current = parent;
    }
  }

  /**
   * Maintain Max Heap property downwards when popping
   */
  private siftDown(index: number): void {
    let current = index;
    const length = this.size();

    while (current * 2 + 1 < length) {
      const leftChild = current * 2 + 1;
      const rightChild = current * 2 + 2;
      let largest = current;

      if (this.heap[leftChild].priorityScore > this.heap[largest].priorityScore) {
        largest = leftChild;
      }

      if (rightChild < length && this.heap[rightChild].priorityScore > this.heap[largest].priorityScore) {
        largest = rightChild;
      }

      if (largest === current) {
        break;
      }

      this.swap(current, largest);
      current = largest;
    }
  }

  /**
   * Swap two nodes in the heap array
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }

  /**
   * Refresh waiting time scores periodically to prevent order starvation
   */
  refreshPriorities(computeScoreFn: (node: KitchenOrderNode, waitMinutes: number) => number): void {
    const now = new Date().getTime();
    for (let i = 0; i < this.heap.length; i++) {
      const waitMinutes = Math.max(0, Math.floor((now - new Date(this.heap[i].confirmedAt).getTime()) / 60000));
      this.heap[i].priorityScore = computeScoreFn(this.heap[i], waitMinutes);
    }

    // Rebuild Max Heap (Heapify O(N))
    for (let i = Math.floor(this.size() / 2) - 1; i >= 0; i--) {
      this.siftDown(i);
    }
  }

  /**
   * Clear the priority queue
   */
  clear(): void {
    this.heap = [];
  }
}