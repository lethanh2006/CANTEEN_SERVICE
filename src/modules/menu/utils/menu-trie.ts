class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEndOfWord: boolean = false;
  menuItemIds: Set<string> = new Set();
}

/**
 * Cây tiền tố Trie trong bộ nhớ phục vụ gợi ý và tìm kiếm nhanh món ăn.
 * Độ phức tạp O(L), với L là độ dài từ khóa tìm kiếm.
 */
export class MenuSearchTrie {
  private root: TrieNode = new TrieNode();

  /**
   * Loại bỏ dấu tiếng Việt, chuyển chữ thường và xóa khoảng trắng thừa.
   */
  private normalizeText(text: string): string {
    if (!text) return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .trim();
  }

  /**
   * Thêm một món ăn vào chỉ mục Trie.
   */
  insert(name: string, menuItemId: string): void {
    const normalized = this.normalizeText(name);
    if (!normalized) return;

    const words = normalized.split(/\s+/);

    // Lập chỉ mục cho cả cụm từ đầy đủ và các cụm bắt đầu từ từng từ.
    for (let i = 0; i < words.length; i++) {
      const phrase = words.slice(i).join(' ');
      this.insertPhrase(phrase, menuItemId);
    }
  }

  /**
   * Thêm một cụm từ vào cây Trie.
   */
  private insertPhrase(phrase: string, menuItemId: string): void {
    let current = this.root;
    for (const char of phrase) {
      if (!current.children.has(char)) {
        current.children.set(char, new TrieNode());
      }
      current = current.children.get(char)!;
      current.menuItemIds.add(menuItemId);
    }
    current.isEndOfWord = true;
  }

  /**
   * Tìm ID món ăn theo tiền tố với độ phức tạp O(L).
   */
  searchPrefix(prefix: string): string[] {
    const normalized = this.normalizeText(prefix);
    if (!normalized) return [];

    let current = this.root;
    for (const char of normalized) {
      if (!current.children.has(char)) {
        return [];
      }
      current = current.children.get(char)!;
    }

    return Array.from(current.menuItemIds);
  }

  /**
   * Xóa toàn bộ dữ liệu trong cây Trie.
   */
  clear(): void {
    this.root = new TrieNode();
  }
}
