export interface TableItem {
  id: string;
  name: string;
  capacity: number;
  status: 'empty' | 'occupied' | 'reserved';
}

export interface TableAllocationResult {
  allocatedTableIds: string[];
  totalCapacity: number;
  partySize: number;
  isMerged: boolean;
  wasteCapacity: number;
}

/**
 * Phân bổ bàn động bằng chiến lược chọn một bàn vừa đủ hoặc tham lam khi gộp bàn.
 */
export class TableAllocationService {
  /**
   * Chọn một bàn phù hợp nhất hoặc gộp các bàn trống cho đủ số khách.
   */
  static allocateTables(
    emptyTables: TableItem[],
    partySize: number,
  ): TableAllocationResult | null {
    if (!emptyTables || emptyTables.length === 0 || partySize <= 0) {
      return null;
    }

    // Bước 1: Chọn một bàn có sức chứa vừa đủ và ít chỗ thừa nhất.
    let bestSingleTable: TableItem | null = null;
    let minWaste = Infinity;

    for (const table of emptyTables) {
      if (table.capacity >= partySize) {
        const waste = table.capacity - partySize;
        if (waste < minWaste) {
          minWaste = waste;
          bestSingleTable = table;
        }
      }
    }

    if (bestSingleTable) {
      return {
        allocatedTableIds: [bestSingleTable.id],
        totalCapacity: bestSingleTable.capacity,
        partySize,
        isMerged: false,
        wasteCapacity: minWaste,
      };
    }

    // Bước 2: Gộp bàn theo chiến lược tham lam.
    // Xếp bàn trống theo sức chứa giảm dần để giảm số bàn cần gộp.
    const sortedTables = [...emptyTables].sort(
      (a, b) => b.capacity - a.capacity,
    );
    const selectedTables: TableItem[] = [];
    let currentCapacity = 0;

    for (const table of sortedTables) {
      selectedTables.push(table);
      currentCapacity += table.capacity;

      if (currentCapacity >= partySize) {
        return {
          allocatedTableIds: selectedTables.map((t) => t.id),
          totalCapacity: currentCapacity,
          partySize,
          isMerged: true,
          wasteCapacity: currentCapacity - partySize,
        };
      }
    }

    // Tổng sức chứa của các bàn trống không đủ.
    return null;
  }
}
