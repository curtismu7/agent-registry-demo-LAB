// Presenter mode: the chrome steps back, the text grows and admin-only controls hide.
// The Present button in the header turns it on; ?presenter=1 turns it on at load; the
// button or Esc turns it off. Kept in the page only (the URL decides on a fresh load).
// The CSS keys on data-presenter="on" (the older data-present="1" is kept for tests).
let on = false;
const apply = () => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.presenter = on ? "on" : "off";
  if (on) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present;
};
export function setPresenter(next) {
  on = Boolean(next);
  try { localStorage.setItem("areg.present", on ? "1" : "0"); } catch { /* not remembered */ }
  apply();
}
export function initPresenter() {
  try { if (new URLSearchParams(window.location.search).get("presenter") === "1") on = true; } catch { /* no URL */ }
  apply();
}
export function presenterOn() { return on; }
