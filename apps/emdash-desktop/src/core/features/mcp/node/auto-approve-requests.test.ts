import { peek } from '@emdash/wire/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoApproveRequests, type AutoApproveRequestInput } from './auto-approve-requests';

const REQUEST: AutoApproveRequestInput = {
  kind: 'create',
  enable: true,
  taskName: 'Fix the bug',
  projectName: 'Repo',
  providerName: 'Claude Code',
  restartsAgent: false,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('AutoApproveRequests', () => {
  it('lists a request until the user answers it', async () => {
    const reveal = vi.fn();
    const requests = new AutoApproveRequests({ reveal });

    const answer = requests.request(REQUEST);
    const [pending] = peek(requests.pending);
    expect(pending).toMatchObject(REQUEST);
    expect(reveal).toHaveBeenCalledOnce();

    requests.resolve(pending!.id, true);
    await expect(answer).resolves.toBe(true);
    expect(peek(requests.pending)).toEqual([]);
  });

  it('denies a request nobody answers in time', async () => {
    vi.useFakeTimers();
    const requests = new AutoApproveRequests({ timeoutMs: 1_000 });

    const answer = requests.request(REQUEST);
    vi.advanceTimersByTime(1_000);

    await expect(answer).resolves.toBe(false);
    expect(peek(requests.pending)).toEqual([]);
  });

  it('denies every waiting request when the server stops', async () => {
    const requests = new AutoApproveRequests();

    const first = requests.request(REQUEST);
    const second = requests.request({ ...REQUEST, kind: 'change' });
    requests.denyAll();

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
  });

  it('ignores answers for unknown or already answered requests', async () => {
    const requests = new AutoApproveRequests();
    const answer = requests.request(REQUEST);
    const [pending] = peek(requests.pending);

    requests.resolve('unknown', true);
    requests.resolve(pending!.id, false);
    requests.resolve(pending!.id, true);

    await expect(answer).resolves.toBe(false);
  });
});
