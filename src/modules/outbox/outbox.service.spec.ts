import type { ClientSession, Model } from 'mongoose';
import type { OutboxEventDocument } from '../../schemas/outbox-events.schema';
import { OutboxService } from './outbox.service';

describe('Canteen OutboxService', () => {
  it('ghi event bằng đúng Mongo session của transaction nghiệp vụ', async () => {
    const session = {} as ClientSession;
    const persisted = { eventId: 'persisted-event' } as OutboxEventDocument;
    const create = jest.fn().mockResolvedValue([persisted]);
    const model = { create } as unknown as Model<OutboxEventDocument>;
    const service = new OutboxService(model);

    await expect(
      service.enqueue(
        {
          eventType: 'order.ready',
          queueName: 'order.ready',
          aggregateId: 'order-1',
          payload: { orderId: 'order-1' },
        },
        session,
      ),
    ).resolves.toBe(persisted);

    expect(create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          eventId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ) as string,
          eventType: 'order.ready',
          queueName: 'order.ready',
          aggregateId: 'order-1',
          payload: { orderId: 'order-1' },
          attemptCount: 0,
          nextAttemptAt: expect.any(Date) as Date,
        }),
      ],
      { session },
    );
  });
});
