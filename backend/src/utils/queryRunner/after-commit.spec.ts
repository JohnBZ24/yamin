import { QueryRunner } from 'typeorm';

import {
  discardAfterCommit,
  flushAfterCommit,
  onAfterCommit,
} from './after-commit';

const makeRunner = (isTransactionActive: boolean): QueryRunner =>
  ({ isTransactionActive }) as unknown as QueryRunner;

/**
 * These hooks exist to stop the worker dequeuing a job before the row it refers
 * to is committed and visible ("Voice transcript record not found"), and to stop
 * a rolled-back request leaving a job pointing at a row that never existed.
 */
describe('onAfterCommit', () => {
  it('defers the callback while a transaction is active', async () => {
    const runner = makeRunner(true);
    const spy = jest.fn().mockResolvedValue(undefined);

    await onAfterCommit(runner, spy);

    // The whole point: it must NOT have run yet.
    expect(spy).not.toHaveBeenCalled();

    await flushAfterCommit(runner);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when there is no transaction', async () => {
    const spy = jest.fn().mockResolvedValue(undefined);
    await onAfterCommit(undefined, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when the runner has no active transaction', async () => {
    const spy = jest.fn().mockResolvedValue(undefined);
    await onAfterCommit(makeRunner(false), spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preserves registration order', async () => {
    const runner = makeRunner(true);
    const order: number[] = [];

    await onAfterCommit(runner, async () => {
      order.push(1);
    });
    await onAfterCommit(runner, async () => {
      order.push(2);
    });
    await flushAfterCommit(runner);

    expect(order).toEqual([1, 2]);
  });
});

describe('flushAfterCommit', () => {
  it('drains, so a second flush cannot double-enqueue', async () => {
    const runner = makeRunner(true);
    const spy = jest.fn().mockResolvedValue(undefined);

    await onAfterCommit(runner, spy);
    await flushAfterCommit(runner);
    await flushAfterCommit(runner);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('propagates a failure instead of swallowing it', async () => {
    // The data is already committed; if the enqueue fails the caller must learn
    // about it and retry (submit is idempotent) rather than get a 202 for work
    // that was never queued.
    const runner = makeRunner(true);
    await onAfterCommit(runner, async () => {
      throw new Error('redis down');
    });

    await expect(flushAfterCommit(runner)).rejects.toThrow('redis down');
  });

  it('does not replay earlier callbacks when a later one throws', async () => {
    const runner = makeRunner(true);
    const ok = jest.fn().mockResolvedValue(undefined);

    await onAfterCommit(runner, ok);
    await onAfterCommit(runner, async () => {
      throw new Error('boom');
    });

    await expect(flushAfterCommit(runner)).rejects.toThrow('boom');
    await flushAfterCommit(runner).catch(() => {});

    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nothing was registered', async () => {
    await expect(flushAfterCommit(makeRunner(true))).resolves.toBeUndefined();
  });
});

describe('discardAfterCommit', () => {
  it('drops callbacks so a rollback never enqueues', async () => {
    const runner = makeRunner(true);
    const spy = jest.fn().mockResolvedValue(undefined);

    await onAfterCommit(runner, spy);
    discardAfterCommit(runner);
    await flushAfterCommit(runner);

    expect(spy).not.toHaveBeenCalled();
  });
});
