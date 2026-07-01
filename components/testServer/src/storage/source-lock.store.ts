import { Injectable } from '@nestjs/common';
import type { SourceLockRecord } from '../shared/types';

@Injectable()
export class SourceLockStore {
  private readonly records = new Map<string, SourceLockRecord>();

  get(sourceId: string): SourceLockRecord | undefined {
    return this.records.get(sourceId);
  }

  set(sourceId: string, record: SourceLockRecord): void {
    this.records.set(sourceId, record);
  }

  delete(sourceId: string): void {
    this.records.delete(sourceId);
  }

  clear(): void {
    this.records.clear();
  }
}
