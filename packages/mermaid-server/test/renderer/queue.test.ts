import { describe, it, expect, vi } from 'vitest';
import { RenderQueue, RenderTimeoutError } from '../../src/renderer/queue.js';

describe('RenderQueue', () => {
  it('executes tasks sequentially', async () => {
    const queue = new RenderQueue();
    const order: number[] = [];

    const p1 = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
      return 'a';
    });
    const p2 = queue.run(() => {
      order.push(2);
      return 'b';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(order).toEqual([1, 2]); // 2 waits for 1
  });

  it('propagates errors without blocking queue', async () => {
    const queue = new RenderQueue();

    const p1 = queue.run(async () => {
      await Promise.resolve();
      throw new Error('fail');
    });

    const p2 = queue.run(() => 'ok');

    await expect(p1).rejects.toThrow('fail');
    expect(await p2).toBe('ok');
  });

  // The 2026-08-05 production incident: a single request whose render never
  // settled (no error, no crash — just never resolved) permanently wedged
  // every subsequent render behind it, because the queue's internal chain
  // was itself awaiting that same never-resolving promise. Recovery required
  // a manual pm2 restart. This proves a hung task can no longer take the
  // whole service down with it.
  it('does not permanently block the queue when a task never settles', async () => {
    vi.useFakeTimers();
    try {
      const queue = new RenderQueue(50); // short timeout so the test is fast
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- deliberately never resolves, simulating a hung render
      const hung = queue.run(() => new Promise(() => {}));
      const after = queue.run(() => 'still works');

      const hungOutcome = hung.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(50);

      await expect(hungOutcome).resolves.toBeInstanceOf(RenderTimeoutError);
      expect(await after).toBe('still works');
    } finally {
      vi.useRealTimers();
    }
  }, 2000);
});
