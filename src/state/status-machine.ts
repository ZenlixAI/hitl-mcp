export type GroupStatus = 'pending' | 'answered' | 'cancelled' | 'expired';

const allowedTransitions: Record<GroupStatus, GroupStatus[]> = {
  pending: ['answered', 'cancelled', 'expired'],
  answered: [],
  cancelled: [],
  expired: []
};

export function transitionStatus(from: GroupStatus, to: GroupStatus): GroupStatus {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`illegal transition ${from} -> ${to}`);
  }

  return to;
}
