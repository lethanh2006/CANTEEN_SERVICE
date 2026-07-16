import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export interface MenuCommand {
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  menuItemId: string;
  previousData: any;
  newData: any;
}

@Injectable()
export class MenuHistoryManager {
  private readonly MAX_HISTORY_LIMIT = 50;
  private readonly TTL_SECONDS = 86400; // 24 hours

  constructor(private readonly redisService: RedisService) {}

  private getUndoKey(userId: string): string {
    return `canteen:undo:${userId}`;
  }

  private getRedoKey(userId: string): string {
    return `canteen:redo:${userId}`;
  }

  async pushCommand(userId: string, command: MenuCommand): Promise<void> {
    const undoKey = this.getUndoKey(userId);
    const redoKey = this.getRedoKey(userId);
    const commandStr = JSON.stringify(command);

    // Push new command to undo stack in Redis
    await this.redisService.rPush(undoKey, commandStr);
    
    // Keep only the last 50 commands
    await this.redisService.lTrim(undoKey, -this.MAX_HISTORY_LIMIT, -1);
    
    // Set 24h expiration on the undo list
    await this.redisService.expire(undoKey, this.TTL_SECONDS);

    // Clear redo stack for this user since history became linear
    await this.redisService.del(redoKey);
  }

  async popUndo(userId: string): Promise<MenuCommand | null> {
    const undoKey = this.getUndoKey(userId);
    const redoKey = this.getRedoKey(userId);

    // Retrieve last command from undo stack
    const commandStr = await this.redisService.rPop(undoKey);
    if (!commandStr) {
      return null;
    }

    const command = JSON.parse(commandStr) as MenuCommand;

    // Push to redo stack
    await this.redisService.rPush(redoKey, commandStr);
    await this.redisService.expire(redoKey, this.TTL_SECONDS);

    return command;
  }

  async popRedo(userId: string): Promise<MenuCommand | null> {
    const undoKey = this.getUndoKey(userId);
    const redoKey = this.getRedoKey(userId);

    // Retrieve last command from redo stack
    const commandStr = await this.redisService.rPop(redoKey);
    if (!commandStr) {
      return null;
    }

    const command = JSON.parse(commandStr) as MenuCommand;

    // Push back to undo stack
    await this.redisService.rPush(undoKey, commandStr);
    await this.redisService.expire(undoKey, this.TTL_SECONDS);

    return command;
  }

  async clear(userId: string): Promise<void> {
    const undoKey = this.getUndoKey(userId);
    const redoKey = this.getRedoKey(userId);

    await this.redisService.del(undoKey);
    await this.redisService.del(redoKey);
  }
}
