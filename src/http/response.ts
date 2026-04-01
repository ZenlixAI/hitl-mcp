export function ok(requestId: string, data: unknown) {
  return {
    request_id: requestId,
    success: true,
    data,
    error: null
  };
}

export function fail(
  requestId: string,
  code: string,
  message: string,
  details?: unknown,
  data: unknown = {}
) {
  return {
    request_id: requestId,
    success: false,
    data,
    error: {
      code,
      message,
      details
    }
  };
}
