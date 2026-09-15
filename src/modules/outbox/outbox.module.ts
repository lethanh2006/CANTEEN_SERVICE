import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OutboxEvent,
  OutboxEventSchema,
} from '../../schemas/outbox-events.schema';
import { OutboxPublisher } from './outbox.publisher';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OutboxEvent.name, schema: OutboxEventSchema },
    ]),
  ],
  providers: [OutboxService, OutboxPublisher],
  exports: [OutboxService],
})
export class OutboxModule {}
