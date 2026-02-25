import { describe, it, expect } from 'vitest';
import { RenderQueue } from '../../src/renderer/queue.js';

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
});
