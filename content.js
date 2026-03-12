// Styles Youtube Shorts pages

const style = document.createElement("style");
style.textContent = `
  yt-shorts-video-title-view-model h2 {
    max-height: unset !important;
    -webkit-line-clamp: unset !important;

    & > span {
      white-space: normal !important;
      line-height: 1.5 !important;

      &:nth-of-type(1) { margin-left: .75rem !important }

      a {
        color: hsl(0 0 50) !important;
        font-weight: 300 !important;
      }
    }
  }
`;
document.head.appendChild(style);

// Title override for Shorts pages
let titleObserver = null;

function setShortsTitle() {
  if (document.title !== "YT Shorts") {
    document.title = "YT Shorts";
  }
}

function startTitleOverride() {
  setShortsTitle();
  if (titleObserver) return;
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  titleObserver = new MutationObserver(setShortsTitle);
  titleObserver.observe(titleEl, { childList: true });
}

function stopTitleOverride() {
  if (titleObserver) {
    titleObserver.disconnect();
    titleObserver = null;
  }
}

function handleNavigation() {
  if (location.pathname.startsWith("/shorts/")) {
    startTitleOverride();
  } else {
    stopTitleOverride();
  }
}

document.addEventListener("yt-navigate-finish", handleNavigation);
handleNavigation();
