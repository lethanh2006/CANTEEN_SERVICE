import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { getLogContext, injectTraceHeaders } from '@nrapp/observability';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Model } from 'mongoose';
import {
  OutboxEvent,
  OutboxEventDocument,
} from '../../schemas/outbox-events.schema';

export interface EnqueueOutboxEvent {
  eventType: string;
  queueName: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
  ) {}

  async enqueue(
    input: EnqueueOutboxEvent,
    session: ClientSession,
  ): Promise<OutboxEventDocument> {
    const eventId = randomUUID();
    const traceHeaders = injectTraceHeaders();
    const requestId = getLogContext().request_id;
    const [event] = await this.outboxModel.create(
      [
        {
          eventId,
          eventType: input.eventType,
          queueName: input.queueName,
          aggregateId: input.aggregateId,
          payload: input.payload,
          requestId: typeof requestId === 'string' ? requestId : null,
          traceparent: optionalHeader(traceHeaders.traceparent),
          tracestate: optionalHeader(traceHeaders.tracestate),
          attemptCount: 0,
          nextAttemptAt: new Date(),
          lastError: null,
          publishedAt: null,
          failedAt: null,
        },
      ],
      { session },
    );
    return event;
  }
}

function optionalHeader(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 512 ? value : null;
}
