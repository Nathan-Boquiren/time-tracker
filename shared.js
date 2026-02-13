// ── Shared Constants & Utilities ─────────────────────────────────────────────
// Used by background.js, popup.js, and blocked-page.js

const DEFAULT_CONFIG = {
  entertainmentLimitMinutes: 10,
  productivitySites: ["github.com", "stackoverflow.com", "leetcode.com"],
  freeTimeStartMinutes: 1260, // 21:00 (9 PM) = 21 * 60
  productivityRequiredMinutes: 20,
};

function isCurrentlyFreeTime(config) {
  const startMinutes = config.freeTimeStartMinutes;
  if (startMinutes == null || startMinutes >= 1440) return false;
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) >= startMinutes;
}

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatMsVerbose(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}
