import { DataSource, QueryRunner } from 'typeorm';

export async function safeRelease(queryRunner: QueryRunner): Promise<void> {
  if (queryRunner.isReleased) {
    return;
  }

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await queryRunner.release();
      break;
    } catch (error) {
      console.error(`Attempt ${attempt} failed to release QueryRunner:`, error);
      const delay = getExponentialBackoffDelay(attempt);
      await sleep(delay);
    }
  }
}

/**
 * Safely manages a database transaction with proper error handling and rollback
 * @param dataSource - The TypeORM DataSource
 * @param operation - The async operation to execute within the transaction
 * @returns The result of the operation
 */
export async function safeTransaction<T>(
  dataSource: DataSource,
  operation: (queryRunner: QueryRunner) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const result = await operation(queryRunner);

    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    console.error('Transaction error:', error);

    try {
      await queryRunner.rollbackTransaction();
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
    }

    throw error;
  } finally {
    try {
      await queryRunner.release();
    } catch (releaseError) {
      console.error('Failed to release queryRunner:', releaseError);
      await safeRelease(queryRunner);
    }
  }
}

function getExponentialBackoffDelay(attempt: number): number {
  const baseDelay = 100; // milliseconds
  return baseDelay * Math.pow(2, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
