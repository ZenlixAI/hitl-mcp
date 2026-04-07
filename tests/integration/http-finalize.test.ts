import { afterEach, describe, it, expect, vi } from 'vitest';
import { createHttpApp, createRuntime } from '../../src/server/create-server';

describe('http submit answers api', () => {
  it('returns 422 when target questions do not exist in caller scope', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-missing-1'
      },
      body: JSON.stringify({ answers: { q_1: { value: 'A' } } })
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('QUESTION_NOT_FOUND');
  });
});

describe('http submit validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    const questionId = String(created.questions[0].question_id);

    const res = await runtime.app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-invalid-1'
      },
      body: JSON.stringify({ answers: { [questionId]: { value: 99 } } })
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ANSWER_VALIDATION_FAILED');

    const status = await runtime.repository.getGroupStatus(created.question_group_id);
    expect(status?.status).toBe('pending');
  });

  it('accepts partial submission and keeps unanswered questions pending', async () => {
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
    const requiredQuestionId = String(created.questions[0].question_id);
    const optionalQuestionId = String(created.questions[1].question_id);

    const res = await runtime.app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-optional-1'
      },
      body: JSON.stringify({
        answers: {
          [requiredQuestionId]: { value: true }
        }
      })
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.data.status).toBe('in_progress');
    expect(payload.data.pending_questions).toHaveLength(1);
    expect(payload.data.pending_questions[0].question_id).toBe(optionalQuestionId);
  });

  it('logs validation failures as structured warnings', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runtime = await createRuntime();
    const created = await runtime.repository.createPendingGroup({
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-log-1',
      title: 'group',
      questions: [
        {
          question_id: 'q_range_log',
          type: 'range',
          title: 'score',
          range_constraints: { min: 0, max: 10, step: 1 }
        }
      ]
    });
    const questionId = String(created.questions[0].question_id);

    const res = await runtime.app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-log-1'
      },
      body: JSON.stringify({ answers: { [questionId]: { value: 99 } } })
    });

    expect(res.status).toBe(422);
    const messages = logSpy.mock.calls.map((call) => String(call[0]));
    expect(messages.some((line) => line.includes('"message":"submit_answers_failed"') && line.includes('"level":"warn"'))).toBe(true);
  });
});
