type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, data?: unknown): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(data !== undefined ? { data } : {}),
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, data?: unknown) => emit('debug', msg, data),
  info: (msg: string, data?: unknown) => emit('info', msg, data),
  warn: (msg: string, data?: unknown) => emit('warn', msg, data),
  error: (msg: string, data?: unknown) => emit('error', msg, data),
};
