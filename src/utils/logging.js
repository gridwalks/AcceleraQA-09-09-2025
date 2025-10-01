const rawVerboseSetting =
  typeof process !== 'undefined' && process?.env?.REACT_APP_VERBOSE_LOGS
    ? process.env.REACT_APP_VERBOSE_LOGS
    : '';

const normalizeFlag = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
};

const normalizedVerboseSetting = normalizeFlag(rawVerboseSetting);

export const isVerboseLoggingEnabled =
  normalizedVerboseSetting === 'true' ||
  normalizedVerboseSetting === '1' ||
  normalizedVerboseSetting === 'yes' ||
  normalizedVerboseSetting === 'on';

const safeConsoleCall = (method, args) => {
  if (typeof console === 'undefined' || typeof console[method] !== 'function') {
    return;
  }

  console[method](...args);
};

export const logVerbose = (...args) => {
  if (!isVerboseLoggingEnabled) {
    return;
  }

  safeConsoleCall('debug', args);
};

export const logVerboseInfo = (...args) => {
  if (!isVerboseLoggingEnabled) {
    return;
  }

  safeConsoleCall('info', args);
};

export const logVerboseWarn = (...args) => {
  if (!isVerboseLoggingEnabled) {
    return;
  }

  safeConsoleCall('warn', args);
};
