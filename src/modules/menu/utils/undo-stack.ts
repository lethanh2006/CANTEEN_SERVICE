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
  private readonly TTL_SECONDS = 86400; // Lưu lịch sử trong 24 giờ.

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

    await this.redisService.rPush(undoKey, commandStr);

    await this.redisService.lTrim(undoKey, -this.MAX_HISTORY_LIMIT, -1);

    await this.redisService.expire(undoKey, this.TTL_SECONDS);

    await this.redisService.del(redoKey);
  }

  async popUndo(userId: string): Promise<MenuCommand | null> {
    const undoKey = this.getUndoKey(userId);
    const redoKey = this.getRedoKey(userId);

    const commandStr = await this.redisService.rPop(undoKey);
    if (!commandStr) {
      return null;
    }

    const command = JSON.parse(commandStr) as MenuCommand;

    await this.redisService.rPush(redoKey, commandStr);
    await this.redisService.expire(redoKey, this.TTL_SECONDS);

    return command;
  }

  async popRedo(userId: string): Promise<MenuCommand | null> {
    const undoKey = this.getUndoKey(userId);
    const redoKey = this.getRedoKey(userId);

    const commandStr = await this.redisService.rPop(redoKey);
    if (!commandStr) {
      return null;
    }

    const command = JSON.parse(commandStr) as MenuCommand;

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
