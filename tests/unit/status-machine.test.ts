import { describe, it, expect } from 'vitest';
import { transitionStatus } from '../../src/state/status-machine.js';

describe('status machine', () => {
  it('allows pending -> answered only and blocks rollback', () => {
    expect(transitionStatus('pending', 'answered')).toBe('answered');
    expect(() => transitionStatus('answered', 'pending')).toThrowError();
  });
});
