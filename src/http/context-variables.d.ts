declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    traceId: string;
    agentIdentity: string;
    agentSessionId: string;
  }
}

export {};
