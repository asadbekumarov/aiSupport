// src/scheduler.js – node-cron based job scheduler
import cron from 'node-cron';
import { config } from './config.js';

/**
 * Start the blog pipeline cron task.
 * @param {(reason: string) => Promise<void>} pipelineFn
 * @returns {cron.ScheduledTask | null}
 */
export function startBlogScheduler(pipelineFn) {
  if (!config.BLOG_ENABLED) {
    console.log('[scheduler] Blog pipeline is disabled (BLOG_ENABLED=false) — skipping blog cron.');
    return null;
  }

  const expr = config.CRON_EXPR;
  const tz = config.TIMEZONE;

  if (!cron.validate(expr)) {
    throw new Error(
      `[scheduler] Invalid CRON_EXPR: "${expr}". Use a valid 5-field cron expression.`
    );
  }

  const task = cron.schedule(
    expr,
    async () => {
      console.log(`[scheduler] Blog cron fired at ${new Date().toISOString()} (${tz}).`);
      await pipelineFn('cron').catch((err) => {
        console.error('[scheduler] Blog pipeline threw unexpectedly:', err.message ?? err);
      });
    },
    { timezone: tz, scheduled: true }
  );

  console.log(`[scheduler] Blog scheduled: "${expr}" (${tz}).`);
  return task;
}

/**
 * Start the personal digest cron task.
 * @param {(reason: string) => Promise<void>} digestFn
 * @returns {cron.ScheduledTask}
 */
export function startDigestScheduler(digestFn) {
  const expr = config.DIGEST_CRON;
  const tz = config.TIMEZONE;

  if (!cron.validate(expr)) {
    throw new Error(
      `[scheduler] Invalid DIGEST_CRON: "${expr}". Use a valid 5-field cron expression (e.g. "0 21 * * *").`
    );
  }

  const task = cron.schedule(
    expr,
    async () => {
      console.log(`[scheduler] Digest cron fired at ${new Date().toISOString()} (${tz}).`);
      await digestFn('cron').catch((err) => {
        console.error('[scheduler] Digest pipeline threw unexpectedly:', err.message ?? err);
      });
    },
    { timezone: tz, scheduled: true }
  );

  console.log(`[scheduler] Personal Digest scheduled: "${expr}" (${tz}).`);
  return task;
}

/**
 * Start both schedulers.
 *
 * @param {(reason: string) => Promise<void>} pipelineFn – blog pipeline
 * @param {((reason: string) => Promise<void>) | null} [digestFn] – personal digest pipeline
 * @returns {{ stop: () => void }}
 */
export function startScheduler(pipelineFn, digestFn = null) {
  const blogTask = startBlogScheduler(pipelineFn);
  const digestTask = digestFn ? startDigestScheduler(digestFn) : null;

  return {
    stop() {
      blogTask?.stop();
      digestTask?.stop();
    },
  };
}
