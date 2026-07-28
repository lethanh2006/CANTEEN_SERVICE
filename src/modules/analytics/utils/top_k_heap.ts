export interface DishSalesNode {
  menuItemId: string;
  name: string;
  salesCount: number;
  totalRevenue?: number;
}

export class TopKActiveHeap {
  private heap: DishSalesNode[] = [];
  private readonly K: number;

  constructor(k: number) {
    this.K = k > 0 ? k : 10;
  }

  size(): number {
    return this.heap.length;
  }

  // Thêm món ăn vào Heap. Nếu kích thước >= K, thay thế phần tử nhỏ nhất ở gốc nếu lớn hơn.
  add(node: DishSalesNode): void {
    if (this.size() < this.K) {
      this.push(node);
    } else if (node.salesCount > this.heap[0].salesCount) {
      this.heap[0] = node;
      this.siftDown(0);
    }
  }

  private push(node: DishSalesNode): void {
    this.heap.push(node);
    this.siftUp(this.heap.length - 1);
  }

  pop(): DishSalesNode | null {
    if (this.size() === 0) return null;
    const root = this.heap[0];
    const lastNode = this.heap.pop()!;
    if (this.size() > 0) {
      this.heap[0] = lastNode;
      this.siftDown(0);
    }
    return root;
  }

  // Trả về kết quả Top K sắp xếp từ bán chạy nhất đến bán ít nhất
  getTopK(): DishSalesNode[] {
    const result: DishSalesNode[] = [];
    const tempHeap = new TopKActiveHeap(this.K);
    tempHeap.heap = [...this.heap];

    while (tempHeap.size() > 0) {
      result.push(tempHeap.pop()!);
    }
    return result.reverse();
  }

  private siftUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.heap[current].salesCount >= this.heap[parent].salesCount) {
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

      if (this.heap[leftChild].salesCount < this.heap[smallest].salesCount) {
        smallest = leftChild;
      }

      if (rightChild < length && this.heap[rightChild].salesCount < this.heap[smallest].salesCount) {
        smallest = rightChild;
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
}