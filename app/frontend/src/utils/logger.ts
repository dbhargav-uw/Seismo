const isProd = import.meta.env.PROD;

export const logger = {
  debug: (...args: unknown[]): void => {
    if (!isProd) console.debug('[seismo]', ...args);
  },
  info: (...args: unknown[]): void => {
    if (!isProd) console.info('[seismo]', ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn('[seismo]', ...args);
  },
  error: (...args: unknown[]): void => {
    console.error('[seismo]', ...args);
  },
};
