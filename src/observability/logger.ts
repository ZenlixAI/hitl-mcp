export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  constructor(private readonly level: LogLevel = 'info') {}

  log(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
    if (priority[level] < priority[this.level]) return;

    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...fields
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
