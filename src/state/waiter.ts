type WaitPayload = {
  payload: unknown;
  version: number;
};

type PendingWaiter = {
  afterVersion: number;
  resolve: (payload: WaitPayload) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type ScopeState = {
  version: number;
  lastPayload?: unknown;
  waiters: Set<PendingWaiter>;
};

export class Waiter {
  private scopes = new Map<string, ScopeState>();

  private getScope(scopeKey: string) {
    const current = this.scopes.get(scopeKey);
    if (current) return current;

    const next: ScopeState = {
      version: 0,
      waiters: new Set()
    };
    this.scopes.set(scopeKey, next);
    return next;
  }

  currentVersion(scopeKey: string) {
    return this.scopes.get(scopeKey)?.version ?? 0;
  }

  wait(scopeKey: string, afterVersion: number, timeoutMs: number): Promise<WaitPayload> {
    const scope = this.getScope(scopeKey);
    if (scope.version > afterVersion) {
      return Promise.resolve({
        payload: scope.lastPayload,
        version: scope.version
      });
    }

    return new Promise((resolve, reject) => {
      const entry: PendingWaiter = {
        afterVersion,
        resolve: (payload) => {
          if (entry.timer) clearTimeout(entry.timer);
          scope.waiters.delete(entry);
          resolve(payload);
        },
        reject: (error) => {
          if (entry.timer) clearTimeout(entry.timer);
          scope.waiters.delete(entry);
          reject(error);
        }
      };

      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => entry.reject(new Error('wait timeout')), timeoutMs);
      }

      scope.waiters.add(entry);
    });
  }

  notify(scopeKey: string, payload: unknown) {
    const scope = this.getScope(scopeKey);
    scope.version += 1;
    scope.lastPayload = payload;

    for (const waiter of Array.from(scope.waiters)) {
      if (scope.version > waiter.afterVersion) {
        waiter.resolve({
          payload,
          version: scope.version
        });
      }
    }
  }

  size() {
    let total = 0;
    for (const scope of this.scopes.values()) {
      total += scope.waiters.size;
    }
    return total;
  }
}
