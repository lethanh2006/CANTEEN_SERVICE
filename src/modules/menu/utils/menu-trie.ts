class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEndOfWord: boolean = false;
  menuItemIds: Set<string> = new Set();
}

/**
 * MenuSearchTrie
 * In-memory Prefix Tree (Trie) data structure for fast menu item autocomplete & search.
 * Complexity: O(L) where L is query length.
 */
export class MenuSearchTrie {
  private root: TrieNode = new TrieNode();

  /**
   * Strip Vietnamese accents and normalize string to lower case
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
   * Insert a menu item into the Trie index
   */
  insert(name: string, menuItemId: string): void {
    const normalized = this.normalizeText(name);
    if (!normalized) return;

    const words = normalized.split(/\s+/);

    // Index full phrase and sub-phrases starting from each word
    for (let i = 0; i < words.length; i++) {
      const phrase = words.slice(i).join(' ');
      this.insertPhrase(phrase, menuItemId);
    }
  }

  /**
   * Helper to insert a phrase into the Trie
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
   * Search menu item IDs by matching prefix - O(L)
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
   * Clear the entire Trie tree
   */
  clear(): void {
    this.root = new TrieNode();
  }
}
