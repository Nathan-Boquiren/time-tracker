// ── Shared utilities (DEFAULT_CONFIG, isCurrentlyFreeTime, formatMs, formatMsVerbose)
importScripts("shared.js");

// ── Constants ────────────────────────────────────────────────────────────────

const ENTERTAINMENT_DOMAINS = [
  "youtube.com",
  "netflix.com",
  "twitch.tv",
  "reddit.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "disneyplus.com",
  "hulu.com",
  "primevideo.com",
  "max.com",
  "crunchyroll.com",
];

const TICK_ALARM = "tick";
const TICK_INTERVAL_MINUTES = 0.5; // 30 seconds
const MAX_ELAPSED_MS = 60_000; // safety cap per tick
const IDLE_THRESHOLD_SECONDS = 60;

// ── Async Queue ──────────────────────────────────────────────────────────────
// Serializes all storage-mutating operations so each read-modify-write cycle
// completes fully before the next begins, eliminating race conditions.

let queue = Promise.resolve();

function serialized(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function stripHostname(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return "local-file";
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    return hostname;
  } catch {
    return "";
  }
}

function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith("." + domain);
}

function classifyUrl(url, productivitySites) {
  const hostname = stripHostname(url);
  if (!hostname) return "neutral";

  for (const d of ENTERTAINMENT_DOMAINS) {
    if (domainMatches(hostname, d)) return "entertainment";
  }
  for (const d of productivitySites) {
    if (domainMatches(hostname, d)) return "productivity";
  }
  return "neutral";
}

function clampElapsed(raw) {
  return Math.max(0, Math.min(raw, MAX_ELAPSED_MS));
}

// ── Storage Access ───────────────────────────────────────────────────────────

async function getData() {
  const result = await chrome.storage.local.get(["config", "today", "tracking"]);

  if (!result.config) {
    result.config = { ...DEFAULT_CONFIG };
  }
  if (result.config.freeTimeStartMinutes == null) {
    result.config.freeTimeStartMinutes = DEFAULT_CONFIG.freeTimeStartMinutes;
  }
  if (result.config.productivityRequiredMinutes == null) {
    result.config.productivityRequiredMinutes = DEFAULT_CONFIG.productivityRequiredMinutes;
  }

  const dateStr = todayDateString();
  if (!result.today || result.today.date !== dateStr) {
    result.today = {
      date: dateStr,
      entertainmentMs: 0,
      productivityMs: 0,
      state: "ALLOWED",
      productivityMsSinceBlock: 0,
    };
    // Reset tick baseline so stale lastTickTime doesn't cause phantom time
    if (result.tracking) {
      result.tracking.lastTickTime = Date.now();
    }
  }

  if (!result.tracking) {
    result.tracking = {
      windowCategories: {},
      lastTickTime: Date.now(),
    };
  }

  // Migrate old single-tab format to per-window map
  if ("activeTabCategory" in result.tracking) {
    delete result.tracking.activeTabCategory;
    result.tracking.windowCategories = {};
  }
  if (!result.tracking.windowCategories) {
    result.tracking.windowCategories = {};
  }

  return result;
}

async function saveData(data) {
  await chrome.storage.local.set({
    today: data.today,
    tracking: data.tracking,
  });
}

// ── Badge ────────────────────────────────────────────────────────────────────

function updateBadge(today, config) {
  if (isCurrentlyFreeTime(config)) {
    chrome.action.setBadgeText({ text: "FT" });
    chrome.action.setBadgeBackgroundColor({ color: "#7e57c2" });
    return;
  }

  if (today.state === "BLOCKED") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
  } else {
    const limitMs = config.entertainmentLimitMinutes * 60_000;
    const remainingMs = Math.max(0, limitMs - today.entertainmentMs);
    const remainingMin = Math.floor(remainingMs / 60_000);
    chrome.action.setBadgeText({ text: String(remainingMin) });
    chrome.action.setBadgeBackgroundColor({ color: "#0ac282" });
  }
}

// ── Active Tab Classification ────────────────────────────────────────────────

function getActiveCategories(windowCategories) {
  let entertainmentActive = false;
  let productivityActive = false;
  for (const cat of Object.values(windowCategories)) {
    if (cat === "entertainment") entertainmentActive = true;
    else if (cat === "productivity") productivityActive = true;
  }
  return { entertainmentActive, productivityActive };
}

async function reclassifyAllWindows(data) {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const newMap = {};
    for (const win of windows) {
      if (win.state === "minimized") continue;
      try {
        const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
        if (tab?.url) {
          newMap[win.id] = classifyUrl(tab.url, data.config.productivitySites);
        }
      } catch (e) {
        console.warn("reclassifyAllWindows: tab query failed for window", win.id, e);
      }
    }
    data.tracking.windowCategories = newMap;
  } catch (e) {
    console.warn("reclassifyAllWindows: windows.getAll failed", e);
    data.tracking.windowCategories = {};
  }
}

async function reclassifyWindow(data, windowId) {
  try {
    const win = await chrome.windows.get(windowId);
    if (win.state === "minimized") {
      delete data.tracking.windowCategories[windowId];
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.url) {
      data.tracking.windowCategories[windowId] = classifyUrl(tab.url, data.config.productivitySites);
    } else {
      delete data.tracking.windowCategories[windowId];
    }
  } catch (e) {
    console.warn("reclassifyWindow: failed for window", windowId, e);
    delete data.tracking.windowCategories[windowId];
  }
}

async function cleanupMinimizedWindows(data) {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const openIds = new Set(windows.filter((w) => w.state !== "minimized").map((w) => w.id));
    for (const id of Object.keys(data.tracking.windowCategories)) {
      if (!openIds.has(Number(id))) {
        delete data.tracking.windowCategories[id];
      }
    }
  } catch (e) {
    console.warn("cleanupMinimizedWindows: failed", e);
  }
}

// ── Enforcement ──────────────────────────────────────────────────────────────

async function enforceBlock(data) {
  if (data.today.state !== "BLOCKED") return;

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url) continue;
      if (classifyUrl(tab.url, data.config.productivitySites) === "entertainment") {
        chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("blocked.html") });
      }
    }
  } catch (e) {
    console.warn("enforceBlock: tabs query failed", e);
  }
}

async function releaseBlockedTabs() {
  try {
    const blockedUrl = chrome.runtime.getURL("blocked.html");
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url?.startsWith(blockedUrl)) {
        chrome.tabs.update(tab.id, { url: "chrome://newtab" });
      }
    }
  } catch (e) {
    console.warn("releaseBlockedTabs: tabs query failed", e);
  }
}

async function redirectEntertainmentInWindow(data, windowId) {
  if (data.today.state !== "BLOCKED") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.url && classifyUrl(tab.url, data.config.productivitySites) === "entertainment") {
      chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("blocked.html") });
    }
  } catch (e) {
    console.warn("redirectEntertainmentInWindow: failed for window", windowId, e);
  }
}

// ── State Machine ────────────────────────────────────────────────────────────

function checkStateTransitions(data) {
  const { today, config } = data;
  const limitMs = config.entertainmentLimitMinutes * 60_000;

  if (today.state === "ALLOWED" && today.entertainmentMs >= limitMs) {
    today.state = "BLOCKED";
    return true;
  }

  const prodRequiredMs = config.productivityRequiredMinutes * 60_000;
  if (today.state === "BLOCKED" && today.productivityMsSinceBlock >= prodRequiredMs) {
    today.state = "ALLOWED";
    today.entertainmentMs = 0;
    today.productivityMsSinceBlock = 0;
    return true;
  }

  return false;
}

// ── Time Accumulation ────────────────────────────────────────────────────────

let isIdle = false;

function accumulateTime(data, elapsed, freeTime) {
  if (isIdle || elapsed <= 0) return;

  const { entertainmentActive, productivityActive } = getActiveCategories(data.tracking.windowCategories);
  const prodCapMs = data.config.productivityRequiredMinutes * 60_000;

  if (entertainmentActive && !freeTime) {
    data.today.entertainmentMs += elapsed;
  }
  if (productivityActive) {
    if (data.today.productivityMs < prodCapMs) {
      data.today.productivityMs = Math.min(data.today.productivityMs + elapsed, prodCapMs);
    }
    if ((entertainmentActive || data.today.state === "BLOCKED" || data.today.entertainmentMs > 0) && data.today.productivityMsSinceBlock < prodCapMs) {
      data.today.productivityMsSinceBlock = Math.min(data.today.productivityMsSinceBlock + elapsed, prodCapMs);
    }
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────
// All handlers run through serialized() to prevent concurrent storage access.

async function onTick() {
  const data = await getData();
  const now = Date.now();
  const rawElapsed = now - data.tracking.lastTickTime;
  const elapsed = rawElapsed > MAX_ELAPSED_MS ? 0 : clampElapsed(rawElapsed);
  const freeTime = isCurrentlyFreeTime(data.config);

  data.tracking.lastTickTime = now;

  if (freeTime && data.today.state === "BLOCKED") {
    data.today.state = "ALLOWED";
    await releaseBlockedTabs();
  }

  accumulateTime(data, elapsed, freeTime);

  if (!freeTime) {
    const stateChanged = checkStateTransitions(data);
    if (stateChanged) await enforceBlock(data);
  }

  updateBadge(data.today, data.config);
  await saveData(data);
}

async function onTabChanged(windowId) {
  const data = await getData();
  const now = Date.now();
  const rawElapsed = now - data.tracking.lastTickTime;
  const elapsed = rawElapsed > MAX_ELAPSED_MS ? 0 : clampElapsed(rawElapsed);
  const freeTime = isCurrentlyFreeTime(data.config);

  // Flush elapsed to previous categories
  accumulateTime(data, elapsed, freeTime);
  data.tracking.lastTickTime = now;

  // Reclassify the changed window (or all if unknown)
  if (windowId != null) {
    await reclassifyWindow(data, windowId);
  } else {
    await reclassifyAllWindows(data);
  }

  if (freeTime) {
    if (data.today.state === "BLOCKED") {
      data.today.state = "ALLOWED";
      await releaseBlockedTabs();
    }
  } else {
    const stateChanged = checkStateTransitions(data);
    if (windowId != null) {
      await redirectEntertainmentInWindow(data, windowId);
    }
    if (stateChanged) await enforceBlock(data);
  }

  updateBadge(data.today, data.config);
  await saveData(data);
}

async function onFocusChanged(windowId) {
  const data = await getData();
  const now = Date.now();
  const rawElapsed = now - data.tracking.lastTickTime;
  const elapsed = rawElapsed > MAX_ELAPSED_MS ? 0 : clampElapsed(rawElapsed);
  const freeTime = isCurrentlyFreeTime(data.config);

  accumulateTime(data, elapsed, freeTime);
  data.tracking.lastTickTime = now;

  // Reclassify the focused window and clean up minimized/closed windows
  await reclassifyWindow(data, windowId);
  await cleanupMinimizedWindows(data);

  if (freeTime) {
    if (data.today.state === "BLOCKED") {
      data.today.state = "ALLOWED";
      await releaseBlockedTabs();
    }
  } else {
    const stateChanged = checkStateTransitions(data);
    await redirectEntertainmentInWindow(data, windowId);
    if (stateChanged) await enforceBlock(data);
  }

  updateBadge(data.today, data.config);
  await saveData(data);
}

async function onInit() {
  const raw = await chrome.storage.local.get("config");
  const data = await getData();
  data.tracking.lastTickTime = Date.now();
  await reclassifyAllWindows(data);

  if (isCurrentlyFreeTime(data.config) && data.today.state === "BLOCKED") {
    data.today.state = "ALLOWED";
    await releaseBlockedTabs();
  }

  updateBadge(data.today, data.config);
  await saveData(data);
  // Only seed config on first install (when no config existed yet)
  if (!raw.config) await chrome.storage.local.set({ config: data.config });
}

async function onConfigChanged() {
  const data = await getData();

  if (isCurrentlyFreeTime(data.config)) {
    if (data.today.state === "BLOCKED") {
      data.today.state = "ALLOWED";
      await releaseBlockedTabs();
    }
  } else {
    const stateChanged = checkStateTransitions(data);
    if (stateChanged) await enforceBlock(data);
  }

  updateBadge(data.today, data.config);
  await saveData(data);
}

// ── Event Listeners ──────────────────────────────────────────────────────────
// All state-mutating listeners route through serialized() to ensure each
// read-modify-write cycle completes before the next begins.

chrome.runtime.onInstalled.addListener(() => serialized(onInit));
chrome.runtime.onStartup.addListener(() => serialized(onInit));

chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_INTERVAL_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) serialized(onTick);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  serialized(() => onTabChanged(activeInfo.windowId));
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
    serialized(() => onTabChanged(tab.windowId));
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  serialized(() => onFocusChanged(windowId));
});

chrome.windows.onRemoved.addListener((windowId) => {
  serialized(async () => {
    const data = await getData();
    const now = Date.now();
    const rawElapsed = now - data.tracking.lastTickTime;
    const elapsed = rawElapsed > MAX_ELAPSED_MS ? 0 : clampElapsed(rawElapsed);
    const freeTime = isCurrentlyFreeTime(data.config);
    accumulateTime(data, elapsed, freeTime);
    data.tracking.lastTickTime = now;
    delete data.tracking.windowCategories[windowId];
    updateBadge(data.today, data.config);
    await saveData(data);
  });
});

chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
chrome.idle.onStateChanged.addListener((state) => {
  isIdle = state !== "active";
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.config) serialized(onConfigChanged);
});
