export const redisKeys = {
  qg: (prefix: string, groupId: string) => `${prefix}:qg:${groupId}`,
  q: (prefix: string, questionId: string) => `${prefix}:q:${questionId}`,
  ans: (prefix: string, groupId: string) => `${prefix}:ans:${groupId}`,
  wait: (prefix: string, groupId: string) => `${prefix}:wait:${groupId}`,
  idem: (prefix: string, scope: string, idempotencyKey: string) =>
    `${prefix}:idem:${scope}:${idempotencyKey}`,
  idxQ2G: (prefix: string, questionId: string) => `${prefix}:idx:q2g:${questionId}`
};
