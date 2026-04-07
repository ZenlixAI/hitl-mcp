export class Waiter {
  private waiters = new Map<string, (payload: unknown) => void>();

  wait(scopeKey: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => reject(new Error('wait timeout')), timeoutMs) : null;

      this.waiters.set(scopeKey, (payload: unknown) => {
        if (timer) clearTimeout(timer);
        this.waiters.delete(scopeKey);
        resolve(payload);
      });
    });
  }

  notify(scopeKey: string, payload: unknown) {
    const waiter = this.waiters.get(scopeKey);
    if (waiter) waiter(payload);
  }

  size() {
    return this.waiters.size;
  }
}
