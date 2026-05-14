const TELEGRAM_DRIVE_URL = "https://sachinmandawi.github.io/Telegram-Drive/";
const RELEASE_URL = "https://github.com/sachinmandawi/Telegram-Drive/releases/latest";

function openUrl(url) {
  chrome.tabs.create({ url });
}

document.getElementById("openApp")?.addEventListener("click", () => {
  openUrl(TELEGRAM_DRIVE_URL);
});

document.getElementById("openRelease")?.addEventListener("click", () => {
  openUrl(RELEASE_URL);
});
