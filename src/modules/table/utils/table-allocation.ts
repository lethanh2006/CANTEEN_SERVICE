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
 * TableAllocationService
 * Best-Fit single table selection and Greedy table merging algorithm for dynamic table assignment.
 */
export class TableAllocationService {
  /**
   * Automatically allocate single best-fit table or merge adjacent empty tables for partySize
   */
  static allocateTables(emptyTables: TableItem[], partySize: number): TableAllocationResult | null {
    if (!emptyTables || emptyTables.length === 0 || partySize <= 0) {
      return null;
    }

    // 1. Single Best-Fit Table Selection
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

    // 2. Greedy Table Merging Strategy
    // Sort empty tables descending by capacity
    const sortedTables = [...emptyTables].sort((a, b) => b.capacity - a.capacity);
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

    // Not enough empty tables capacity available
    return null;
  }
}
