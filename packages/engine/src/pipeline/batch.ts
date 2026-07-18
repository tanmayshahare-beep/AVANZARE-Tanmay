import { AppError } from '../errors';
import type { Database } from '../db/database';
import type { ScreeningInput, ScreeningProgress, ScreeningResult } from '../types';
import { runScreening } from './screening';
import { mapLimit } from '../util/concurrency';

/** One screening task in a batch: a caller-assigned id plus its screening input. */
export interface BatchTaskInput {
  /** Caller-assigned identifier so progress/results can be routed back to the right task. */
  taskId: string;
  input: ScreeningInput;
  /** Durable folder for CVs downloaded from an email source (per task, so runs never collide). */
  emailDownloadDir?: string;
}

/** Progress for a single task, tagged with its id so the UI can update just that row. */
export interface BatchTaskProgress {
  taskId: string;
  progress: ScreeningProgress;
}

/** Terminal outcome of one task: either its screening result or the error that stopped it. */
export type BatchTaskResult =
  | { taskId: string; ok: true; result: ScreeningResult }
  | { taskId: string; ok: false; error: { code: string; message: string; location: string } };

/**
 * Run several screening tasks concurrently, bounded by `maxConcurrent`. Each task
 * runs the same parse + keyword-screening pipeline as a single run and writes its
 * own job + applications to the shared database (better-sqlite3 writes are
 * synchronous, so concurrent tasks never corrupt each other). One task failing
 * never aborts the others — its error is captured and reported per task. The
 * human-review stages (rejection review, LLM analysis, emails) stay per task and
 * are driven afterwards by the caller, unchanged.
 */
export async function runScreeningBatch(
  tasks: BatchTaskInput[],
  db: Database,
  maxConcurrent: number,
  onTaskProgress?: (p: BatchTaskProgress) => void,
  onTaskDone?: (r: BatchTaskResult) => void,
): Promise<BatchTaskResult[]> {
  const limit = Math.max(1, Math.floor(maxConcurrent) || 1);
  return mapLimit(tasks, limit, async (t): Promise<BatchTaskResult> => {
    try {
      const result = await runScreening(
        t.input,
        db,
        (progress) => onTaskProgress?.({ taskId: t.taskId, progress }),
        { emailDownloadDir: t.emailDownloadDir },
      );
      const done: BatchTaskResult = { taskId: t.taskId, ok: true, result };
      onTaskDone?.(done);
      return done;
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('AVZ-APP-901', `batch task ${t.taskId}`, err instanceof Error ? err.message : String(err));
      const done: BatchTaskResult = {
        taskId: t.taskId, ok: false,
        error: { code: e.code, message: e.message, location: e.location },
      };
      onTaskDone?.(done);
      return done;
    }
  });
}
