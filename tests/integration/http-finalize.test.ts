import { describe, it, expect } from 'vitest';
import { createHttpApp, createRuntime } from '../../src/server/create-server';

describe('http finalize api', () => {
  it('returns 404 when group does not exist', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/question-groups/qg_missing/answers/finalize', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q_1: { value: 'A' } } })
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('QUESTION_GROUP_NOT_FOUND');
  });
});

describe('http finalize validation', () => {
  it('returns 422 when answers are invalid and keeps pending', async () => {
    const runtime = await createRuntime();
    const created = await runtime.repository.createPendingGroup({
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-invalid-1',
      title: 'group',
      questions: [
        {
          question_id: 'q_range_1',
          type: 'range',
          title: 'score',
          range_constraints: { min: 0, max: 10, step: 1 }
        }
      ]
    });

    const res = await runtime.app.request(`/api/v1/question-groups/${created.question_group_id}/answers/finalize`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q_range_1: { value: 99 } } })
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ANSWER_VALIDATION_FAILED');

    const status = await runtime.repository.getGroupStatus(created.question_group_id);
    expect(status?.status).toBe('pending');
  });

  it('requires explicit skip for unanswered optional questions', async () => {
    const runtime = await createRuntime();
    const created = await runtime.repository.createPendingGroup({
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-optional-1',
      title: 'group',
      questions: [
        {
          question_id: 'q_required_1',
          type: 'boolean',
          title: 'required',
          required: true
        },
        {
          question_id: 'q_optional_1',
          type: 'text',
          title: 'optional',
          required: false
        }
      ]
    });

    const withoutSkip = await runtime.app.request(
      `/api/v1/question-groups/${created.question_group_id}/answers/finalize`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: {
            q_required_1: { value: true }
          }
        })
      }
    );

    expect(withoutSkip.status).toBe(422);

    const withSkip = await runtime.app.request(
      `/api/v1/question-groups/${created.question_group_id}/answers/finalize`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: {
            q_required_1: { value: true }
          },
          skipped_question_ids: ['q_optional_1']
        })
      }
    );

    expect(withSkip.status).toBe(200);
    const payload = await withSkip.json();
    expect(payload.data.skipped_question_ids).toEqual(['q_optional_1']);
  });
});
