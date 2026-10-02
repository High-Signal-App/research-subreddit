import { availableCollections, collectionDates, collectionPreview } from "./home-model.mjs";
import { snapshotPath, snapshotPostPath } from "./paths.mjs";

const $ = id => document.getElementById(id);
const create = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const number = value => new Intl.NumberFormat("en").format(value);
const dateLabel = date => new Date(date + "T00:00:00Z").toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const stamp = value => new Date(value).toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
let catalog = [], generation = 0, expiryTimer;

function clearPreview(message) {
  clearTimeout(expiryTimer);
  $("open-snapshot").disabled = true;
  $("glimpse").hidden = true;
  $("preview-posts").replaceChildren();
  $("all-posts").removeAttribute("href");
  $("sample-foot").hidden = true;
  $("sample-posts").textContent = "";
  $("sample-comments").textContent = "";
  $("sample-label").textContent = "Collection preview";
  $("sample-title").textContent = message;
  $("sample-details").replaceChildren();
  $("sample-note").textContent = "The exact UTC collection window appears with each snapshot.";
  document.querySelector(".sample").setAttribute("aria-busy", "true");
}
function setDates() {
  const previous = $("home-date").value;
  const dates = collectionDates(availableCollections(catalog), $("home-community").value);
  $("home-date").replaceChildren(...dates.map(date => {
    const option = create("option", dateLabel(date)); option.value = date; return option;
  }));
  if (dates.includes(previous)) $("home-date").value = previous;
  $("home-date").disabled = dates.length === 0;
}
function paintDate(entry) {
  const date = new Date(entry.date + "T00:00:00Z");
  $("sample-day").textContent = String(date.getUTCDate()).padStart(2, "0");
  $("sample-month").textContent = date.toLocaleDateString("en", { month: "long", timeZone: "UTC" });
  $("sample-year").textContent = String(date.getUTCFullYear());
  $("sample-weekday").textContent = date.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" });
  $("sample-community").textContent = `r/${entry.subreddit}`;
}
async function loadPreview() {
  const token = ++generation;
  clearPreview("Loading this day's captured conversation…");
  $("home-status").textContent = "Loading the selected collection…";
  $("retry").hidden = true;
  const entry = availableCollections(catalog).find(row => row.subreddit === $("home-community").value && row.date === $("home-date").value);
  if (!entry) { unavailable("No unexpired collection is available for this selection."); return; }
  paintDate(entry);
  try {
    const query = new URLSearchParams({ run: entry.source.run, revision: entry.source.revision });
    const response = await fetch(`/api/snapshots/${entry.date}/${encodeURIComponent(entry.subreddit)}?${query}`, { cache: "no-store" });
    const data = await response.json();
    if (token !== generation) return;
    if (!response.ok) throw new Error(data.message || "This collection is unavailable.");
    if (Date.parse(data.expiresAt) <= Date.now()) throw new Error("This collection has expired. Reload to find available collections.");
    const preview = collectionPreview(data);
    const path = snapshotPath(data, true);
    document.querySelector(".sample").setAttribute("aria-busy", "false");
    $("open-snapshot").disabled = false;
    $("sample-foot").hidden = false;
    $("sample-posts").textContent = number(data.posts.length);
    $("sample-comments").textContent = number(data.comments.length);
    $("sample-note").textContent = `${data.coverage.status === "complete" ? "Collection completed" : data.coverage.status === "partial" ? "Partial collection" : "Collection failed"} · Comments are filtered. Available until ${stamp(data.expiresAt)} UTC.`;
    $("home-status").textContent = `${dateLabel(data.date)} selected. ${number(data.posts.length)} captured posts.`;
    if (preview.leader) {
      $("sample-label").textContent = "Most reported replies";
      const link = create("a", preview.leader.title); link.href = snapshotPostPath(data, preview.leader.id);
      $("sample-title").replaceChildren(link);
      $("sample-details").append(create("span", `${number(preview.leader.score)} recorded score`), create("span", `${number(preview.leader.commentCount)} reported replies`));
    } else {
      $("sample-title").textContent = data.coverage.status === "failed" ? "This collection failed." : !data.posts.length ? "A quiet collection. No posts captured." : "No post preview available.";
      $("sample-details").append(create("span", preview.reason));
      if (data.coverage.status === "failed") $("home-status").textContent = "This collection failed. Open its coverage details; no activity claim is made.";
    }
    if (preview.posts.length) {
      $("glimpse").hidden = false;
      $("glimpse-note").textContent = `Captured posts from r/${data.subreddit}, ${dateLabel(data.date)}. Scores and reply totals were recorded at capture time.${data.coverage.status === "partial" ? " This collection is partial." : ""}`;
      for (const post of preview.posts) {
        const row = create("a", undefined, "record"); row.href = snapshotPostPath(data, post.id);
        const title = create("div");
        title.append(create("span", post.flair || "Captured post", "record-label"), create("h3", post.title));
        row.append(title);
        for (const [value, label] of [[post.score, "recorded score"], [post.commentCount, "reported replies"]]) {
          const metric = create("div", undefined, "record-stat"); metric.append(create("strong", number(value)), create("span", label)); row.append(metric);
        }
        $("preview-posts").append(row);
      }
      $("all-posts").href = path;
      $("all-posts").textContent = `Open all ${number(data.posts.length)} captured posts ↗`;
    }
    expiryTimer = setTimeout(() => {
      generation++;
      clearPreview("This collection has expired.");
      $("availability").textContent = "Collection availability has changed. Reload to find available collections.";
      $("date-range").textContent = "The selected collection has expired.";
      unavailable("This collection has expired. Reload to find available collections.");
    }, Math.min(Date.parse(data.expiresAt) - Date.now(), 2147483647));
  } catch (error) {
    if (token !== generation) return;
    clearPreview("This collection is unavailable.");
    unavailable(error.message || "The collection could not be loaded. Please retry.");
  }
}
function unavailable(message) {
  document.querySelector(".sample").setAttribute("aria-busy", "false");
  $("home-status").textContent = message;
  $("retry").hidden = false;
}
async function init() {
  const token = ++generation;
  clearPreview("Choose a day. Follow its conversation.");
  $("home-status").textContent = "Loading available collections…";
  $("retry").hidden = true;
  $("home-community").disabled = true; $("home-date").disabled = true;
  try {
    const response = await fetch("/api/snapshots/catalog", { cache: "no-store" });
    const data = await response.json();
    if (token !== generation) return;
    if (!response.ok || !Array.isArray(data.entries)) throw new Error(data.message || "The collection catalog is unavailable.");
    catalog = availableCollections(data.entries);
    if (!catalog.length) {
      $("home-community").replaceChildren(create("option", "No collections available"));
      $("home-date").replaceChildren(create("option", "No available dates"));
      $("sample-day").textContent = "—"; $("sample-month").textContent = "No available day";
      $("sample-year").textContent = ""; $("sample-weekday").textContent = ""; $("sample-community").textContent = "Your community";
      $("availability").textContent = "No unexpired collections are currently available.";
      $("date-range").textContent = "Availability is checked against the collection catalog.";
      unavailable("No unexpired collections are currently available. Please try again later."); return;
    }
    const names = [...new Set(catalog.map(entry => entry.subreddit))].sort((a, b) => a.localeCompare(b));
    const previous = $("home-community").value;
    $("home-community").replaceChildren(...names.map(name => { const option = create("option", `r/${name}`); option.value = name; return option; }));
    $("home-community").value = names.includes(previous) ? previous : names.includes("AI_Agents") ? "AI_Agents" : names[0];
    $("home-community").disabled = false;
    setDates();
    $("availability").replaceChildren(create("strong", `${number(names.length)} ${names.length === 1 ? "community" : "communities"}`), document.createTextNode(" with available collections. Find the one you follow."));
    const dates = [...new Set(catalog.map(entry => entry.date))].sort();
    $("date-range").textContent = `${dates.length} ${dates.length === 1 ? "collection date" : "collection dates"} · ${dateLabel(dates[0])}${dates.length > 1 ? ` – ${dateLabel(dates.at(-1))}` : ""}`;
    await loadPreview();
  } catch (error) {
    if (token !== generation) return;
    $("availability").textContent = "Collection availability could not be checked.";
    $("date-range").textContent = "Reload the catalog to try again.";
    unavailable(error.message || "The collection catalog could not be loaded.");
  }
}
$("home-community").onchange = () => { setDates(); void loadPreview(); };
$("home-date").onchange = () => { void loadPreview(); };
$("retry").onclick = () => { void init(); };
$("lookup").onsubmit = event => {
  event.preventDefault();
  if (!$("open-snapshot").disabled) location.assign(snapshotPath({ subreddit: $("home-community").value, date: $("home-date").value }));
};
// Static Pages must keep earlier root query links readable, like the local server.
if (["subreddit", "date", "run", "revision"].some(key => new URL(location.href).searchParams.has(key))) {
  location.replace(`/snapshots/${location.search}${location.hash}`);
} else {
  void init();
}
