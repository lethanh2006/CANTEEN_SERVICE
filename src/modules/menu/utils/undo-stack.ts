import { Injectable } from '@nestjs/common';

export interface MenuCommand {
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  menuItemId: string;
  previousData: any;
  newData: any;
}

@Injectable()
export class MenuHistoryManager {
  private undoStack: MenuCommand[] = [];
  private redoStack: MenuCommand[] = [];
  private readonly MAX_HISTORY_LIMIT = 50;


  pushCommand(command: MenuCommand): void {
    if (this.undoStack.length >= this.MAX_HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.undoStack.push(command);
    this.redoStack = [];
  }


  popUndo(): MenuCommand | null {
    if (this.undoStack.length === 0) return null;
    const command = this.undoStack.pop()!;
    this.redoStack.push(command);
    return command;
  }


  popRedo(): MenuCommand | null {
    if (this.redoStack.length === 0) return null;
    const command = this.redoStack.pop()!;
    this.undoStack.push(command);
    return command;
  }


  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
