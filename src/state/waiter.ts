export class Waiter {
  private waiters = new Map<string, (payload: unknown) => void>();

  wait(groupId: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => reject(new Error('wait timeout')), timeoutMs) : null;

      this.waiters.set(groupId, (payload: unknown) => {
        if (timer) clearTimeout(timer);
        this.waiters.delete(groupId);
        resolve(payload);
      });
    });
  }

  notify(groupId: string, payload: unknown) {
    const waiter = this.waiters.get(groupId);
    if (waiter) waiter(payload);
  }

  size() {
    return this.waiters.size;
  }
}
