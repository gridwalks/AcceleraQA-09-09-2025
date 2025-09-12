const TOKEN_USAGE_KEY = 'tokenUsage';

// Record token usage with timestamp
export function recordTokenUsage(tokens, timestamp = Date.now()) {
  try {
    const data = JSON.parse(localStorage.getItem(TOKEN_USAGE_KEY) || '[]');
    // Remove entries older than 1 year for storage efficiency
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const filtered = data.filter(entry => entry.timestamp >= oneYearAgo);
    filtered.push({ tokens, timestamp });
    localStorage.setItem(TOKEN_USAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Failed to record token usage:', err);
  }
}

// Get token usage statistics for last 30 days and 12 months
export function getTokenUsageStats() {
  try {
    const data = JSON.parse(localStorage.getItem(TOKEN_USAGE_KEY) || '[]');
    const now = new Date();

    // Daily stats for last 30 days
    const daily = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const dateStr = day.toISOString().slice(0, 10);
      const tokens = data
        .filter(entry => new Date(entry.timestamp).toISOString().slice(0, 10) === dateStr)
        .reduce((sum, entry) => sum + entry.tokens, 0);
      daily.push({ date: dateStr, tokens });
    }

    // Monthly stats for last 12 months
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = monthDate.toISOString().slice(0, 7);
      const tokens = data
        .filter(entry => {
          const d = new Date(entry.timestamp);
          return d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth();
        })
        .reduce((sum, entry) => sum + entry.tokens, 0);
      monthly.push({ month: monthStr, tokens });
    }

    return { daily, monthly };
  } catch (err) {
    console.error('Failed to get token usage stats:', err);
    return { daily: [], monthly: [] };
  }
}
