import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type OutboxEventDocument = OutboxEvent & Document;

@Schema({
  collection: 'outbox_events',
  timestamps: { createdAt: true, updatedAt: false },
})
export class OutboxEvent {
  createdAt!: Date;

  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ required: true })
  eventType!: string;

  @Prop({ required: true })
  queueName!: string;

  @Prop({ required: true })
  aggregateId!: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  payload!: Record<string, unknown>;

  @Prop({ type: String, required: false, default: null })
  requestId!: string | null;

  @Prop({ type: String, required: false, default: null })
  traceparent!: string | null;

  @Prop({ type: String, required: false, default: null })
  tracestate!: string | null;

  @Prop({ required: true, default: 0, min: 0 })
  attemptCount!: number;

  @Prop({ required: true, default: Date.now })
  nextAttemptAt!: Date;

  @Prop({ type: String, required: false, default: null })
  lastError!: string | null;

  @Prop({ type: Date, required: false, default: null })
  publishedAt!: Date | null;

  @Prop({ type: Date, required: false, default: null })
  failedAt!: Date | null;
}

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);

OutboxEventSchema.index({
  publishedAt: 1,
  failedAt: 1,
  nextAttemptAt: 1,
  createdAt: 1,
});
