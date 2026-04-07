export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  constructor(private readonly level: LogLevel = 'info') {}

  private normalize(fields: Record<string, unknown>) {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value instanceof Error) {
        normalized[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
        continue;
      }
      normalized[key] = value;
    }
    return normalized;
  }

  log(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
    if (priority[level] < priority[this.level]) return;

    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...this.normalize(fields)
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }

  debug(message: string, fields?: Record<string, unknown>) {
    this.log('debug', message, fields);
  }

  info(message: string, fields?: Record<string, unknown>) {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>) {
    this.log('warn', message, fields);
  }

  error(message: string, fields?: Record<string, unknown>) {
    this.log('error', message, fields);
  }
}
