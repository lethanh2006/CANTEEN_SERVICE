export interface InventoryBatchNode {
  batchId: string;
  ingredientId: string;
  ingredientName?: string;
  unit?: string;
  expiryDate: Date;
  quantity: number;
  originalQuantity?: number;
  costPrice?: number;
  supplier?: string;
  status?: string;
}

export class InventoryMinHeap {
  private heap: InventoryBatchNode[] = [];

  size(): number {
    return this.heap.length;
  }

  push(node: InventoryBatchNode): void {
    this.heap.push(node);
    this.siftUp(this.heap.length - 1);
  }

  // Lấy lô có hạn sử dụng gần nhất để ưu tiên chế biến.
  pop(): InventoryBatchNode | null {
    if (this.size() === 0) return null;
    const root = this.heap[0];
    const lastNode = this.heap.pop()!;

    if (this.size() > 0) {
      this.heap[0] = lastNode;
      this.siftDown(0);
    }
    return root;
  }

  peek(): InventoryBatchNode | null {
    return this.size() > 0 ? this.heap[0] : null;
  }

  private siftUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      const currentTime = new Date(this.heap[current].expiryDate).getTime();
      const parentTime = new Date(this.heap[parent].expiryDate).getTime();
      if (currentTime >= parentTime) {
        break;
      }
      this.swap(current, parent);
      current = parent;
    }
  }

  private siftDown(index: number): void {
    let current = index;
    const length = this.size();

    while (current * 2 + 1 < length) {
      const leftChild = current * 2 + 1;
      const rightChild = current * 2 + 2;
      let smallest = current;

      const leftTime = new Date(this.heap[leftChild].expiryDate).getTime();
      const smallestTime = new Date(this.heap[smallest].expiryDate).getTime();

      if (leftTime < smallestTime) {
        smallest = leftChild;
      }

      if (rightChild < length) {
        const rightTime = new Date(this.heap[rightChild].expiryDate).getTime();
        const currentSmallestTime = new Date(
          this.heap[smallest].expiryDate,
        ).getTime();
        if (rightTime < currentSmallestTime) {
          smallest = rightChild;
        }
      }

      if (smallest === current) {
        break;
      }

      this.swap(current, smallest);
      current = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }

  // Trả về toàn bộ lô theo hạn sử dụng tăng dần mà không thay đổi Heap gốc.
  getSortedBatches(): InventoryBatchNode[] {
    const tempHeap = new InventoryMinHeap();
    tempHeap.heap = [...this.heap];
    const sorted: InventoryBatchNode[] = [];
    while (tempHeap.size() > 0) {
      sorted.push(tempHeap.pop()!);
    }
    return sorted;
  }
}
