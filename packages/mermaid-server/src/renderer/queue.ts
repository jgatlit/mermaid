export class RenderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Render did not complete within ${timeoutMs}ms`);
    this.name = 'RenderTimeoutError';
  }
}

// 2026-08-05 incident: a single render that never settled (no throw, no
// crash — mermaid/JSDOM just never returned) permanently wedged every
// request queued behind it, because this queue's own internal chain was
// itself awaiting that same promise. Every task is now raced against a
// timeout so the chain always advances. This does NOT cancel the hung
// task — JS has no way to abort an arbitrary in-flight promise — it just
// guarantees the QUEUE stops waiting on it, turning a total, permanent
// outage into a single failed request.
const DEFAULT_TIMEOUT_MS = 15_000;

export class RenderQueue {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.chain = this.chain.then(async () => {
        try {
          resolve(await this.withTimeout(fn()));
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  private withTimeout<T>(value: T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new RenderTimeoutError(this.timeoutMs)),
        this.timeoutMs
      );
      Promise.resolve(value).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }
}
