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
