export interface KitchenOrderNode {
  orderId: string;
  orderNumber: string;
  priorityScore: number;
  confirmedAt: Date;
  userRole?: string;
  isTakeaway?: boolean;
}

/**
 * Hàng đợi Max Heap quản lý đơn bếp theo điểm ưu tiên.
 * Độ phức tạp: thêm O(log N), lấy ra O(log N), xem phần tử đầu O(1).
 */
export class KitchenPriorityQueue {
  private heap: KitchenOrderNode[] = [];

  /**
   * Lấy số đơn hiện có trong hàng đợi.
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Kiểm tra hàng đợi có rỗng hay không.
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Thêm một đơn mới vào Max Heap.
   */
  push(node: KitchenOrderNode): void {
    this.heap.push(node);
    this.siftUp(this.heap.length - 1);
  }

  /**
   * Lấy và xóa đơn có độ ưu tiên cao nhất.
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
   * Xem đơn có độ ưu tiên cao nhất mà không xóa khỏi hàng đợi.
   */
  peek(): KitchenOrderNode | null {
    return this.size() > 0 ? this.heap[0] : null;
  }

  /**
   * Sao chép các phần tử thành mảng để phục vụ API hiển thị hàng đợi.
   */
  toArray(): KitchenOrderNode[] {
    return [...this.heap];
  }

  /**
   * Dịch phần tử lên để giữ đúng tính chất Max Heap sau khi thêm.
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
   * Dịch phần tử xuống để giữ đúng tính chất Max Heap sau khi lấy ra.
   */
  private siftDown(index: number): void {
    let current = index;
    const length = this.size();

    while (current * 2 + 1 < length) {
      const leftChild = current * 2 + 1;
      const rightChild = current * 2 + 2;
      let largest = current;

      if (
        this.heap[leftChild].priorityScore > this.heap[largest].priorityScore
      ) {
        largest = leftChild;
      }

      if (
        rightChild < length &&
        this.heap[rightChild].priorityScore > this.heap[largest].priorityScore
      ) {
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
   * Hoán đổi hai phần tử trong Heap.
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }

  /**
   * Cập nhật điểm chờ định kỳ để đơn cũ không bị bỏ đói.
   */
  refreshPriorities(
    computeScoreFn: (node: KitchenOrderNode, waitMinutes: number) => number,
  ): void {
    const now = new Date().getTime();
    for (let i = 0; i < this.heap.length; i++) {
      const waitMinutes = Math.max(
        0,
        Math.floor(
          (now - new Date(this.heap[i].confirmedAt).getTime()) / 60000,
        ),
      );
      this.heap[i].priorityScore = computeScoreFn(this.heap[i], waitMinutes);
    }

    // Dựng lại Max Heap với độ phức tạp O(N).
    for (let i = Math.floor(this.size() / 2) - 1; i >= 0; i--) {
      this.siftDown(i);
    }
  }

  /**
   * Xóa toàn bộ phần tử trong hàng đợi.
   */
  clear(): void {
    this.heap = [];
  }
}
