import { renderNotes } from "./notes.js";

const info = window.__UPDATE__ ?? { version: "?", current: "?", notes: "", releaseUrl: null };
const $ = (id) => document.getElementById(id);

$("title").textContent = `Tally ${info.version} is available`;
$("sub").textContent = `You have ${info.current}.`;

if (info.notes && info.notes.trim()) {
  renderNotes(document, $("notes"), info.notes);
} else {
  $("notes").textContent = "This release has no notes.";
}
if (info.releaseUrl) {
  const a = $("github");
  a.href = info.releaseUrl;
  a.hidden = false;
}

// The app watches for these three links (src/update.rs) and does the rest.
// Esc and the window's close button mean "Later".
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") location.href = "https://tally-update.invalid/later";
});

// Called by the app once "Update now" is chosen: the download has started.
window.__busy = () => {
  for (const el of document.querySelectorAll("[data-choice]")) {
    el.setAttribute("aria-disabled", "true");
    el.removeAttribute("href");
  }
  $("status").hidden = false;
  $("status").textContent = "Downloading the update. Tally will restart when it is done.";
};
$("install").focus();
