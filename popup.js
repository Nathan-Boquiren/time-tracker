// ── Helpers ──────────────────────────────────────────────────────────────────
// formatMs, isCurrentlyFreeTime, DEFAULT_CONFIG are in shared.js

function minutesToTimeString(minutes) {
  if (minutes == null || minutes >= 1440) return "00:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeStringToMinutes(timeStr) {
  if (!timeStr) return 1440;
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m;
  return total === 0 ? 1440 : total;
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const statusBadge = document.getElementById("statusBadge");

const entertainmentLimit = document.getElementById("entertainmentLimit");
const productivityRequired = document.getElementById("productivityRequired");

const limitInput = document.getElementById("limitInput");
const limitSave = document.getElementById("limitSave");

const prodLimitInput = document.getElementById("prodLimitInput");
const prodLimitSave = document.getElementById("prodLimitSave");

const sitesList = document.getElementById("sitesList");
const siteInput = document.getElementById("siteInput");
const siteAdd = document.getElementById("siteAdd");

const freeTimeInput = document.getElementById("freeTimeInput");
const freeTimeMsg = document.getElementById("freeTime");
const freeTimeSave = document.getElementById("freeTimeSave");

const settingsBtn = document.getElementById("settingsBtn");
const backBtn = document.getElementById("backBtn");

const settingsSection = document.querySelector(".settings");
const toggleViewBtn = document.getElementById("toggleViewBtn");
const darkModeToggle = document.getElementById("darkModeToggle");

const strictModeBanner = document.getElementById("strictModeBanner");
const strictModeCountdown = document.getElementById("strictModeCountdown");
const strictDurationInput = document.getElementById("strictDurationInput");
const strictModeToggle = document.getElementById("strictModeToggle");
const strictModeModal = document.getElementById("strictModeModal");
const strictModeConfirm = document.getElementById("strictModeConfirm");
const strictModeCancel = document.getElementById("strictModeCancel");
const modalDuration = document.getElementById("modalDuration");

let strictCountdownInterval = null;

// ── View switching ──────────────────────────────────────────────────────────

toggleViewBtn.addEventListener("click", () => {
  settingsSection.classList.toggle("hidden");
  toggleViewBtn.title = toggleViewBtn.title === "Settings" ? "Back" : "Settings";
});

// ── Strict Mode ─────────────────────────────────────────────────────────────

strictModeToggle.addEventListener("click", () => {
  strictModeModal.showModal();
});

strictModeToggle.addEventListener("change", () => {
  if (!strictModeToggle.checked) return;

  // if (strictModeToggle.checked) {
  const minutes = parseInt(strictDurationInput.value, 10);
  if (!minutes || minutes < 1) {
    strictModeToggle.checked = false;
    return;
  }
  modalDuration.textContent = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  strictModeModal.classList.add("show");
  strictModeToggle.checked = false; // don't check until confirmed
  // }
});

strictModeConfirm.addEventListener("click", async () => {
  const minutes = parseInt(strictDurationInput.value, 10);
  if (!minutes || minutes < 1) return;
  const result = await chrome.storage.local.get("config");
  const config = result.config || { ...DEFAULT_CONFIG };
  config.strictModeEndTime = Date.now() + minutes * 60_000;
  await chrome.storage.local.set({ config });
  strictModeModal.close();
});

strictModeCancel.addEventListener("click", () => strictModeModal.close());

strictModeModal.addEventListener("click", (e) => {
  if (e.target === strictModeModal) strictModeModal.classList.remove("show");
});

function updateStrictCountdown(endTime) {
  const remaining = Math.max(0, endTime - Date.now());
  if (remaining <= 0) {
    clearInterval(strictCountdownInterval);
    strictCountdownInterval = null;
    render();
    return;
  }
  const totalSec = Math.ceil(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const timeStr =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  strictModeCountdown.textContent = `Settings locked for ${timeStr}`;
}

// ── Save feedback ───────────────────────────────────────────────────────────

function flashButton(button) {
  button.classList.add("save-success");
  setTimeout(() => button.classList.remove("save-success"), 1000);
}

// ── Render ───────────────────────────────────────────────────────────────────

let justAddedSite = null;

async function render() {
  const result = await chrome.storage.local.get(["config", "today"]);
  const config = result.config || { ...DEFAULT_CONFIG };
  const today = result.today || {
    entertainmentMs: 0,
    productivityMs: 0,
    state: "ALLOWED",
    productivityMsSinceBlock: 0,
  };

  applyTheme(config.darkMode);
  darkModeToggle.checked = !!config.darkMode;

  const blocked = today.state === "BLOCKED";
  const limitMs = config.entertainmentLimitMinutes * 60_000;
  const freeTime = isCurrentlyFreeTime(config);
  const strictActive = isStrictModeActive(config);

  // Clean up expired strict mode timestamp
  if (config.strictModeEndTime != null && !strictActive) {
    config.strictModeEndTime = null;
    chrome.storage.local.set({ config });
  }

  // Status badge
  renderStatusBadge(blocked, freeTime);

  // Free time banner
  freeTimeMsg.classList.toggle("show", freeTime);

  // Strict mode banner
  strictModeBanner.classList.toggle("show", strictActive);

  // Strict mode countdown
  clearInterval(strictCountdownInterval);
  strictCountdownInterval = null;
  if (strictActive) {
    updateStrictCountdown(config.strictModeEndTime);
    strictCountdownInterval = setInterval(() => updateStrictCountdown(config.strictModeEndTime), 1000);
  }

  // Lock/unlock settings
  settingsSection.classList.toggle("locked", strictActive);

  renderSettings(config, strictActive);

  if (freeTime) return;

  // Entertainment card
  renderEntertainmentCard(config, today, limitMs);

  // Productivity card
  renderProductivityCard(config, today, blocked);
}

// Rendering Helper Functions

function renderEntertainmentCard(config, today, limitMs) {
  const pct = limitMs > 0 ? Math.min(100, (today.entertainmentMs / limitMs) * 100) : 0;

  const entertainmentBar = document.getElementById("entertainmentBar");
  const entertainmentUsed = document.getElementById("entertainmentUsed");

  entertainmentBar.style.setProperty("--progress-width", `${pct.toFixed(1)}%`);
  entertainmentUsed.textContent = formatMs(today.entertainmentMs);
  entertainmentLimit.textContent = `${String(config.entertainmentLimitMinutes).padStart(2, "0")}:00`;
}

function renderProductivityCard(config, today, blocked) {
  const prodCapMs = config.productivityRequiredMinutes * 60_000;
  const earnedMs = today.productivityMsSinceBlock || 0;
  const preEarning = today.entertainmentMs > 0;
  const showEarned = blocked || preEarning;
  const pct = prodCapMs > 0 ? Math.min(100, ((showEarned ? earnedMs : today.productivityMs) / prodCapMs) * 100) : 0;

  const productivityBar = document.getElementById("productivityBar");
  const productivityTotal = document.getElementById("productivityTotal");

  productivityBar.style.setProperty("--progress-width", `${pct.toFixed(1)}%`);
  productivityRequired.textContent = formatMs(prodCapMs);
  productivityTotal.textContent = formatMs(showEarned ? earnedMs : today.productivityMs);

  // Productivity time left to unlock
  renderTimeLeftTxt(showEarned, prodCapMs, earnedMs);
}

function renderStatusBadge(isBlocked, isFreeTime) {
  statusBadge.classList.toggle("blocked", isBlocked);
  statusBadge.classList.toggle("free-time", isFreeTime);
  statusBadge.textContent = isFreeTime ? "Free Time" : isBlocked ? "Blocked" : "Allowed";
}

function renderTimeLeftTxt(showEarned, prodCapMs, earnedMs) {
  const unlockText = document.getElementById("unlockText");
  const remainingMs = Math.max(0, prodCapMs - earnedMs);
  unlockText.textContent = `(${formatMs(remainingMs)} left)`;
  unlockText.classList.toggle("show", showEarned);
}

function renderSettings(config, strictActive) {
  // Limit input
  limitInput.value = config.entertainmentLimitMinutes;
  prodLimitInput.value = config.productivityRequiredMinutes;

  // Free time input
  freeTimeInput.value = minutesToTimeString(config.freeTimeStartMinutes != null ? config.freeTimeStartMinutes : 1260);

  // Sites list
  renderSites(config.productivitySites || [], strictActive);

  // Strict mode controls
  strictModeToggle.checked = strictActive;
  strictModeToggle.disabled = strictActive;
  strictDurationInput.disabled = strictActive;

  // Disable other inputs when locked
  limitInput.disabled = strictActive;
  limitSave.disabled = strictActive;
  prodLimitInput.disabled = strictActive;
  prodLimitSave.disabled = strictActive;
  freeTimeInput.disabled = strictActive;
  freeTimeSave.disabled = strictActive;
  darkModeToggle.disabled = strictActive;
  siteInput.disabled = strictActive;
  siteAdd.disabled = strictActive;
}

function renderSites(sites, strictActive) {
  sitesList.innerHTML = "";
  for (const site of sites) {
    const item = document.createElement("div");
    item.className = "site-item";

    const name = document.createElement("span");
    name.textContent = site;

    const removeBtn = document.createElement("button");
    removeBtn.classList.add("remove-site-btn");
    removeBtn.textContent = "\u00d7";
    removeBtn.title = "Remove";
    removeBtn.disabled = strictActive;
    removeBtn.addEventListener("click", () => removeSite(site));

    item.appendChild(name);
    item.appendChild(removeBtn);
    if (justAddedSite === site) {
      item.classList.add("just-added");
      justAddedSite = null;
    }
    sitesList.appendChild(item);
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

limitSave.addEventListener("click", async () => {
  const val = parseInt(limitInput.value, 10);
  if (!val || val < 1) return;

  const result = await chrome.storage.local.get("config");
  const config = result.config || { ...DEFAULT_CONFIG };
  if (isStrictModeActive(config)) return;
  config.entertainmentLimitMinutes = Math.min(val, 1440);
  await chrome.storage.local.set({ config });
  flashButton(limitSave);
});

prodLimitSave.addEventListener("click", async () => {
  const val = parseInt(prodLimitInput.value, 10);
  if (!val || val < 1) return;

  const result = await chrome.storage.local.get("config");
  const config = result.config || { ...DEFAULT_CONFIG };
  if (isStrictModeActive(config)) return;
  config.productivityRequiredMinutes = Math.min(val, 1440);
  await chrome.storage.local.set({ config });
  flashButton(prodLimitSave);
});

freeTimeSave.addEventListener("click", async () => {
  const minutes = timeStringToMinutes(freeTimeInput.value);
  const result = await chrome.storage.local.get("config");
  const config = result.config || { ...DEFAULT_CONFIG };
  if (isStrictModeActive(config)) return;
  config.freeTimeStartMinutes = minutes;
  await chrome.storage.local.set({ config });
  flashButton(freeTimeSave);
});

darkModeToggle.addEventListener("change", async () => {
  const result = await chrome.storage.local.get("config");
  const config = result.config || { ...DEFAULT_CONFIG };
  if (isStrictModeActive(config)) return;
  config.darkMode = darkModeToggle.checked;
  await chrome.storage.local.set({ config });
});

siteAdd.addEventListener("click", () => addSite());
siteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

async function addSite() {
  let domain = siteInput.value.trim().toLowerCase();
  if (!domain) return;

  if (domain.startsWith("file:")) domain = "local-file";
  // Strip protocol and path
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (domain.startsWith("www.")) domain = domain.slice(4);
  if (!domain) return;

  const result = await chrome.storage.local.get("config");
  const config = result.config || { ...DEFAULT_CONFIG };
  if (isStrictModeActive(config)) return;
  if (!config.productivitySites.includes(domain)) {
    config.productivitySites.push(domain);
    justAddedSite = domain;
    await chrome.storage.local.set({ config });
  }
  siteInput.value = "";
}

async function removeSite(domain) {
  const result = await chrome.storage.local.get("config");
  const config = result.config || { ...DEFAULT_CONFIG };
  if (isStrictModeActive(config)) return;
  config.productivitySites = config.productivitySites.filter((s) => s !== domain);
  await chrome.storage.local.set({ config });
}

// ── Live Updates ─────────────────────────────────────────────────────────────

render();
chrome.storage.onChanged.addListener(() => render());
