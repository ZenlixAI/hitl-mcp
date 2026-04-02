# Production Runbook

## 1. Health and Readiness

- Liveness: `GET /api/v1/healthz` (expect `200` + `status=ok`)
- Readiness: `GET /api/v1/readyz`
  - `200` when repository backend is ready
  - `503` when not ready
- Metrics: `GET /api/v1/metrics`

## 2. Startup Checklist

1. Confirm Redis is reachable if `HITL_STORAGE=redis`.
2. Confirm `MCP_URL` and exposed port are correct.
3. If auth is required, set `HITL_API_KEY`; leave unset for optional no-auth mode.
4. Run smoke checks:
   - `GET /api/v1/healthz`
   - `GET /api/v1/readyz`
   - `GET /api/v1/metrics`

## 3. Failure Playbook

### Readiness returns 503

- Check Redis connectivity and credentials.
- If Redis is down and fallback is acceptable, switch to `HITL_STORAGE=memory`.

### Finalize validation failures spike

- Inspect `finalize_validation_failed_total` from `/metrics`.
- Review payload formats from calling backend.
- Confirm schema drift between agent output and server expectations.

### Pending sessions growing

- Inspect `pending_count` gauge from `/metrics`.
- Check whether backend finalize calls are arriving.
- Check client-side workflows for dropped answer submissions.

## 4. Deployment Notes

- Use `docker-compose.yml` for local/prod-like validation.
- For production orchestration (Kubernetes/ECS), wire probes to:
  - liveness: `/api/v1/healthz`
  - readiness: `/api/v1/readyz`
- Keep `HITL_TTL_SECONDS` aligned with business SLA for unanswered groups.
