// formatMsVerbose, isCurrentlyFreeTime, DEFAULT_CONFIG are in shared.js

const progressBar = document.getElementById("progressBar");
const progressTrack = document.getElementById("progressTrack");
const progressText = document.getElementById("progressText");
const earnedText = document.getElementById("earnedText");
const requiredText = document.getElementById("requiredText");
const remainingText = document.getElementById("remainingText");

async function update() {
  const result = await chrome.storage.local.get(["config", "today"]);
  const config = result.config || { ...DEFAULT_CONFIG };
  const today = result.today || {};

  applyTheme(config.darkMode);

  if (isCurrentlyFreeTime(config)) {
    document.querySelector("h1").textContent = "Free Time!";
    document.querySelector("h1").style.color = "var(--color-free-time)";
    document.querySelector(".subtitle").textContent = "Entertainment limits are off. This page will close momentarily.";
    progressBar.style.width = "100%";
    progressTrack.setAttribute("aria-valuenow", "100");
    progressText.textContent = "Enjoy your free time!";
    return;
  }

  if (today.state !== "BLOCKED") {
    document.querySelector(".subtitle").textContent = "Entertainment is now unlocked!";
    progressBar.style.width = "100%";
    progressTrack.setAttribute("aria-valuenow", "100");
    progressText.textContent = "Unlocked!";
    return;
  }

  const requiredMs = config.productivityRequiredMinutes * 60_000;
  const earnedMs = today.productivityMsSinceBlock || 0;
  const remainingMs = Math.max(0, requiredMs - earnedMs);
  const pct = requiredMs > 0 ? Math.min(100, (earnedMs / requiredMs) * 100) : 0;

  progressBar.style.width = pct.toFixed(1) + "%";
  progressTrack.setAttribute("aria-valuenow", Math.round(pct));

  // Update structured progress details
  earnedText.textContent = formatMsVerbose(earnedMs);
  requiredText.textContent = formatMsVerbose(requiredMs);
  remainingText.textContent = formatMsVerbose(remainingMs);
}

update();
setInterval(update, 5000);

chrome.storage.onChanged.addListener(() => update());
