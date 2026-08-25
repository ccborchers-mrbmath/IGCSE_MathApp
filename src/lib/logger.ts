const isProd = import.meta.env.PROD;

/**
 * Safe logger that suppresses error details in production builds to avoid
 * leaking stack traces, user IDs, or database internals via browser DevTools.
 */
export const logger = {
  error: (message: string, error?: unknown) => {
    if (!isProd) {
       
      console.error(message, error);
    }
  },
  warn: (message: string, error?: unknown) => {
    if (!isProd) {
       
      console.warn(message, error);
    }
  },
};