import { beforeEach, describe, expect, it, vi } from 'vitest';

// 인터넷 상태를 테스트에서 조절한다
const net = { online: true };
vi.mock('@/server/sources/http', () => ({ internetOnline: async () => net.online }));

const { jobState, runJob } = await import('@/server/jobs');

describe('runJob', () => {
  beforeEach(() => {
    net.online = true;
    vi.useRealTimers();
  });

  it('marks a failure as error when the internet is up', async () => {
    await runJob('t-error', async () => { throw new Error('boom'); });
    expect(jobState('t-error')).toMatchObject({ state: 'error', error: 'boom' });
  });

  it('dedupes a running job', async () => {
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 1; };
    const [a, b] = await Promise.all([runJob('t-dedupe', fn), runJob('t-dedupe', fn)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
  });

  it('pauses while offline and resumes the same work when back online', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    net.online = false;
    const p = runJob('t-net', async () => {
      attempts++;
      if (!net.online) throw new Error('fetch failed');
      return 'ok';
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(jobState('t-net')?.state).toBe('waiting-network');
    expect(attempts).toBe(1);

    net.online = true;
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(p).resolves.toBe('ok');
    expect(jobState('t-net')?.state).toBe('done');
    expect(attempts).toBe(2);
  });
});
