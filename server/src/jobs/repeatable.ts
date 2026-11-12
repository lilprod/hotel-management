import type { Queue } from 'bullmq';

export interface RepeatSchedule {
  /** Interval in ms. */
  every?: number;
  /** Cron pattern (BullMQ, never node-cron). */
  pattern?: string;
  /** IANA time zone of the cron pattern (tenant time zone for daily jobs). */
  tz?: string;
}

/**
 * Registers (or updates) a repeatable job with a job scheduler: idempotent across restarts and
 * instances, unlike node-cron (doc 03 §1).
 */
export async function registerRepeatable<D>(
  queue: Queue,
  schedulerId: string,
  schedule: RepeatSchedule,
  template: { name: string; data?: D },
): Promise<void> {
  if (!schedule.every && !schedule.pattern)
    throw new Error(`Repeatable ${schedulerId}: every or pattern is required`);
  await queue.upsertJobScheduler(
    schedulerId,
    {
      ...(schedule.every ? { every: schedule.every } : {}),
      ...(schedule.pattern ? { pattern: schedule.pattern } : {}),
      ...(schedule.tz ? { tz: schedule.tz } : {}),
    },
    { name: template.name, ...(template.data !== undefined ? { data: template.data } : {}) },
  );
}

export async function removeRepeatable(queue: Queue, schedulerId: string): Promise<void> {
  await queue.removeJobScheduler(schedulerId);
}
