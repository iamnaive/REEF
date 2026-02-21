import type { Tier } from "./economy";

export type CellId = string;
export type ActionType = "build" | "upgrade";

export interface BuildJob {
  id: string;
  cellId: CellId;
  buildingId: string;
  fromTier: Tier;
  toTier: Tier;
  type: ActionType;
  startedAtMs: number | null;
  durationMs: number;
  costPaid?: boolean;
}

export interface BuildQueueState {
  active: BuildJob | null;
  queued: BuildJob[];
}

const DEFAULT_QUEUE_LIMIT = 1;

export function startNextIfIdle(state: BuildQueueState, nowMs: number): BuildQueueState {
  if (state.active || state.queued.length === 0) return state;
  const [next, ...rest] = state.queued;
  return {
    active: {
      ...next,
      startedAtMs: nowMs
    },
    queued: rest
  };
}

export function enqueueJob(state: BuildQueueState, job: BuildJob, queueLimit = DEFAULT_QUEUE_LIMIT): BuildQueueState {
  if (!state.active) {
    return {
      active: {
        ...job,
        startedAtMs: job.startedAtMs ?? Date.now()
      },
      queued: state.queued
    };
  }
  if (state.queued.length >= queueLimit) return state;
  return {
    active: state.active,
    queued: [...state.queued, { ...job, startedAtMs: null }]
  };
}

export function getProgress(job: BuildJob, nowMs: number): number {
  if (job.startedAtMs == null) return 0;
  if (job.durationMs <= 0) return 1;
  const elapsed = Math.max(0, nowMs - job.startedAtMs);
  return Math.min(1, elapsed / job.durationMs);
}

export function tick(state: BuildQueueState, nowMs: number): { state: BuildQueueState; completed: BuildJob[] } {
  let nextState = state;
  const completed: BuildJob[] = [];

  while (nextState.active) {
    const progress = getProgress(nextState.active, nowMs);
    if (progress < 1) break;
    completed.push(nextState.active);
    nextState = {
      active: null,
      queued: nextState.queued
    };
    nextState = startNextIfIdle(nextState, nowMs);
  }

  return { state: nextState, completed };
}
