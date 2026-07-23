import { Logger } from '@nestjs/common';
import { QueryRunner } from 'typeorm';

type AfterCommitCallback = () => Promise<void>;

const AFTER_COMMIT_CALLBACKS = Symbol('afterCommitCallbacks');

type QueryRunnerWithCallbacks = QueryRunner & {
  [AFTER_COMMIT_CALLBACKS]?: AfterCommitCallback[];
};

/**
 * Defers side effects that must not happen until the transaction is durable.
 *
 * The motivating bug: `submitToQueue` added the BullMQ job while still inside
 * the request transaction. BullMQ is Redis, not Postgres — it does not
 * participate in the transaction, so the worker could dequeue the job and look
 * up the transcript *before* the INSERT was committed and visible, failing with
 * "Voice transcript record not found". Worse, if the transaction then rolled
 * back, the job referenced a row that would never exist.
 *
 * Registering the enqueue here instead means it runs only after commit, so the
 * row is always visible by the time the worker can see the job.
 *
 * With no active transaction (no interceptor in play), the callback runs
 * immediately — the ordering hazard doesn't exist in that case.
 *
 * NOTE: this closes the race, not the atomicity gap. A crash in the window
 * between COMMIT and enqueue still leaves a row with no job (it stays
 * `pending`). Closing that fully needs a transactional outbox — a table written
 * inside the same transaction and drained by a poller. That is Phase 4 in
 * IMPLEMENTATION_PLAN.md. Until then the window is small and recoverable
 * because submit is idempotent (`jobId` = fileUuid): the client can retry.
 */
export function onAfterCommit(
  queryRunner: QueryRunner | undefined,
  callback: AfterCommitCallback,
): Promise<void> {
  if (!queryRunner || !queryRunner.isTransactionActive) {
    return callback();
  }

  const runner = queryRunner as QueryRunnerWithCallbacks;
  if (!runner[AFTER_COMMIT_CALLBACKS]) {
    runner[AFTER_COMMIT_CALLBACKS] = [];
  }
  runner[AFTER_COMMIT_CALLBACKS].push(callback);

  return Promise.resolve();
}

/**
 * Runs the registered callbacks. Call only after a successful commit.
 *
 * Callbacks are drained before running so a throw cannot cause a replay, and
 * errors propagate: the caller has already committed, so the client must be
 * told the side effect failed rather than getting a 202 for work that was never
 * queued. Retrying the request is safe (idempotent job ids).
 */
export async function flushAfterCommit(
  queryRunner: QueryRunner,
  logger?: Logger,
): Promise<void> {
  const runner = queryRunner as QueryRunnerWithCallbacks;
  const callbacks = runner[AFTER_COMMIT_CALLBACKS];
  runner[AFTER_COMMIT_CALLBACKS] = [];

  if (!callbacks?.length) {
    return;
  }

  for (const callback of callbacks) {
    await callback();
  }

  logger?.log(`Ran ${callbacks.length} after-commit callback(s)`);
}

/**
 * Drops pending callbacks without running them — used on rollback, where the
 * side effect must not happen because the data it refers to does not exist.
 */
export function discardAfterCommit(queryRunner: QueryRunner): void {
  (queryRunner as QueryRunnerWithCallbacks)[AFTER_COMMIT_CALLBACKS] = [];
}
