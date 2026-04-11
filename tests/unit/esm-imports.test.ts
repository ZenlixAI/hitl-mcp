import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_FILES = [
  'index.ts',
  'src/config/defaults.ts',
  'src/config/load-config.ts',
  'src/core/hitl-service.ts',
  'src/domain/types.ts',
  'src/domain/validators.ts',
  'src/http/middleware/request-context.ts',
  'src/http/routes/questions.ts',
  'src/mcp/caller-scope.ts',
  'src/mcp/register-tools.ts',
  'src/mcp/tools/cancel-question-group.ts',
  'src/mcp/tools/create-question-group.ts',
  'src/mcp/tools/get-current-question-group.ts',
  'src/mcp/tools/get-question.ts',
  'src/mcp/tools/submit-answers.ts',
  'src/mcp/tools/wait-question-group.ts',
  'src/server/create-server.ts',
  'src/storage/hitl-repository.ts',
  'src/storage/in-memory-repository.ts',
  'src/storage/redis-hitl-repository.ts'
];

const RELATIVE_IMPORT_PATTERN =
  /from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

describe('ESM relative imports', () => {
  it('uses .js extensions for runtime-relative imports', () => {
    const violations: string[] = [];

    for (const file of SOURCE_FILES) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');

      for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
        const specifier = match[1] ?? match[2];
        if (specifier.endsWith('.js')) continue;

        violations.push(`${file}: ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
