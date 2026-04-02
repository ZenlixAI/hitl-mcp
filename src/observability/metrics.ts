export type HitlMetricsSnapshot = {
  counters: {
    finalize_validation_failed_total: number;
    finalize_success_total: number;
  };
  gauges: {
    pending_count: number;
  };
  histograms: {
    wait_duration_ms: { count: number; min: number; max: number; avg: number };
  };
};

export class HitlMetrics {
  private finalizeValidationFailedTotal = 0;
  private finalizeSuccessTotal = 0;
  private pendingCount = 0;
  private waitDurations: number[] = [];

  setPendingCount(value: number) {
    this.pendingCount = value;
  }

  incFinalizeValidationFailed() {
    this.finalizeValidationFailedTotal += 1;
  }

  incFinalizeSuccess() {
    this.finalizeSuccessTotal += 1;
  }

  observeWaitDuration(ms: number) {
    this.waitDurations.push(ms);
  }

  snapshot(): HitlMetricsSnapshot {
    const count = this.waitDurations.length;
    const sum = this.waitDurations.reduce((acc, v) => acc + v, 0);
    const min = count ? Math.min(...this.waitDurations) : 0;
    const max = count ? Math.max(...this.waitDurations) : 0;
    const avg = count ? sum / count : 0;

    return {
      counters: {
        finalize_validation_failed_total: this.finalizeValidationFailedTotal,
        finalize_success_total: this.finalizeSuccessTotal
      },
      gauges: {
        pending_count: this.pendingCount
      },
      histograms: {
        wait_duration_ms: { count, min, max, avg }
      }
    };
  }
}
