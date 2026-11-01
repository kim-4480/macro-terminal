import type { JobState } from '@/shared/types';
import { internetOnline } from './sources/http';
import { errorMessage } from './util';

// 백그라운드 작업(번역·요약·브리핑) 상태.
// 인터넷이 끊겨 실패하면 'waiting-network' 로 멈춰 두고, 연결이 돌아오면 같은 작업을 다시 시작한다.

interface Job extends JobState {
  promise: Promise<unknown>;
}

const RETRY_POLL_MS = 15_000;
const MAX_WAIT_MS = 24 * 3600e3;

const g = globalThis as typeof globalThis & { __jobs?: Map<string, Job> };
const jobs = (g.__jobs ??= new Map());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runJob<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const cur = jobs.get(name);
  if (cur && (cur.state === 'running' || cur.state === 'waiting-network')) return cur.promise as Promise<T | undefined>;

  const job: Job = { state: 'running', startedAt: Date.now(), error: null, promise: Promise.resolve() };
  job.promise = (async () => {
    const waitStart = Date.now();
    for (;;) {
      try {
        job.state = 'running';
        const value = await fn();
        job.state = 'done';
        job.error = null;
        return value;
      } catch (err) {
        job.error = errorMessage(err);
        if (await internetOnline()) {
          job.state = 'error';
          return undefined;
        }
        // 인터넷 끊김: 연결이 돌아올 때까지 기다렸다가 이어서 다시 시도
        job.state = 'waiting-network';
        while (!(await internetOnline())) {
          if (Date.now() - waitStart > MAX_WAIT_MS) { job.state = 'error'; return undefined; }
          await sleep(RETRY_POLL_MS);
        }
      } finally {
        job.finishedAt = Date.now();
      }
    }
  })();
  jobs.set(name, job);
  return job.promise as Promise<T | undefined>;
}

export function jobStates(): Record<string, JobState> {
  return Object.fromEntries(
    [...jobs].map(([k, j]) => [k, { state: j.state, error: j.error, startedAt: j.startedAt, finishedAt: j.finishedAt }]),
  );
}

export const jobState = (name: string): JobState | null => jobStates()[name] ?? null;
