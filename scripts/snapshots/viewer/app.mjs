const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat("en").format(value);
const dateLabel = date => new Date(date + "T00:00:00Z").toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const stamp = value => new Date(value).toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const exactStamp = value => new Date(value).toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
let catalog = [], snapshot, visible = 50, month, generation = 0, comparisonGeneration = 0;
let selection = parseSnapshotLocation(location.href);
let comparisonLoaded = false;
const create = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
function choices() { return catalog.filter(entry => entry.subreddit === $("community").value); }
function clearContent() {
  if ($("thread").open) $("thread").close();
  snapshot = undefined;
  for (const id of ["summary", "content", "limits", "coverage-badge", "share-fallback", "recover", "insights"]) $(id).hidden = true;
  comparisonGeneration++; comparisonLoaded = false;
  $("share-status").textContent = "";
  $("posts").replaceChildren();
  $("status").hidden = false;
}
function renderCalendar() {
  const restoreCalendarFocus = $("calendar").contains(document.activeElement);
  const selected = $("date").value;
  month = month || selected.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  $("month-label").textContent = new Date(Date.UTC(year, monthNumber - 1)).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  const dates = [...new Set(choices().map(entry => entry.date))].sort();
  $("available-date").replaceChildren(...dates.slice().reverse().map(date => { const option = create("option", dateLabel(date)); option.value = date; return option; }));
  if (!dates.includes(selected)) { const option = create("option", `${dateLabel(selected)} · unavailable`); option.value = selected; option.disabled = true; $("available-date").prepend(option); }
  $("available-date").value = selected; $("available-date").disabled = dates.length === 0;
  const available = new Set(dates);
  $("calendar").replaceChildren();
  const offset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  for (let index = 0; index < offset; index++) $("calendar").append(create("span"));
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const button = create("button", String(day), `${available.has(date) ? "available" : ""} ${date === selected ? "selected" : ""}`);
    button.dataset.date = date;
    button.disabled = !available.has(date);
    button.setAttribute("aria-label", `${dateLabel(date)}${available.has(date) ? ", collection available" : ", no archived collection"}`);
    if (date === selected) button.setAttribute("aria-current", "date");
    button.onclick = () => { $("date").value = date; void load(); };
    $("calendar").append(button);
  }
  if (restoreCalendarFocus) [...$("calendar").children].find(button => button.dataset.date === selected && !button.disabled)?.focus();
  const earlier = dates.filter(date => date < selected).at(-1), later = dates.find(date => date > selected);
  $("previous").disabled = !earlier; $("next").disabled = !later;
  $("previous").onclick = () => chooseDate(earlier); $("next").onclick = () => chooseDate(later);
  $("archive-count").textContent = `${dates.length} collection ${dates.length === 1 ? "date" : "dates"} available for this community.`;
}
function chooseDate(date) { $("date").value = date; month = date.slice(0, 7); void load(); }
async function load(pinned = false, replace = false) {
  const linkedPost = /^#post-[a-z0-9]{1,32}$/.test(location.hash) ? location.hash : "";
  const token = ++generation;
  clearContent(); visible = 50;
  $("announcement").textContent = "";
  const subreddit = $("community").value, date = $("date").value;
  if (!date) { $("status").textContent = "Choose a collection date."; return; }
  $("heading").textContent = `r/${subreddit}`;
  $("subtitle").textContent = dateLabel(date);
  $("status").className = "status"; $("status").textContent = "Loading the captured posts and discussion…";
  renderCalendar();
  const params = new URLSearchParams();
  if (pinned) for (const key of ["run", "revision", "version"]) if (selection[key]) params.set(key === "version" ? "v" : key, selection[key]);
  const route = `/api/snapshots/${date}/${encodeURIComponent(subreddit)}`;
  const previous = parseSnapshotLocation(location.href);
  const changed = previous.subreddit !== subreddit || previous.date !== date;
  if (!pinned) history[!replace && changed ? "pushState" : "replaceState"](null, "", snapshotPath({ subreddit, date }));
  try {
    const response = await fetch(`${route}?${params}`);
    const data = await response.json();
    if (token !== generation) return;
    if (!response.ok) {
      $("status").className = "status error";
      $("status").textContent = data.message || "The selected snapshot is unavailable.";
      const latest = choices().find(entry => Date.parse(entry.expiresAt) > Date.now());
      $("recover").hidden = !latest; $("recover").onclick = () => chooseDate(latest.date);
      return;
    }
    snapshot = data;
    history.replaceState(null, "", snapshotPath(data, pinned) + (pinned ? linkedPost : ""));
    document.title = `r/${data.subreddit} · ${dateLabel(data.date)} · Reddit Insights`;
    $("status").hidden = true;
    $("summary").hidden = false; $("limits").hidden = false;
    $("coverage-badge").hidden = false;
    $("coverage-badge").className = `badge ${data.coverage.status === "complete" ? "" : "partial"}`;
    $("coverage-badge").textContent = data.coverage.status === "complete" ? "Collection completed" : data.coverage.status === "partial" ? "Partial collection" : "Collection failed";
    $("announcement").textContent = `Loaded r/${data.subreddit}, ${dateLabel(data.date)}: ${number(data.posts.length)} captured posts, ${number(data.comments.length)} retained comments. ${$("coverage-badge").textContent}.`;
    $("post-count").textContent = number(data.posts.length); $("comment-count").textContent = number(data.comments.length);
    $("window").textContent = `${exactStamp(data.window.start)} → ${exactStamp(data.window.end)} UTC`;
    $("coverage-note").textContent = `${number(data.coverage.commentsSeen)} comments encountered; ${number(data.coverage.comments)} retained and ${number(data.coverage.commentsDropped)} filtered out. Reddit reported ${number(data.coverage.reportedReplies)} replies across these posts.${data.coverage.listingCapped ? " The post listing reached its collection cap." : ""}${data.coverage.commentFailures ? ` ${data.coverage.commentFailures} comment requests failed.` : ""}${data.coverage.unresolvedMore ? ` ${data.coverage.unresolvedMore} additional comment branches were unresolved.` : ""}`;
    $("capture-note").textContent = `Collection completed ${stamp(data.capturedAt)} UTC. The window includes its start and excludes its end. ${data.coverage.note}`;
    $("source-note").textContent = `Snapshot available until ${exactStamp(data.expiresAt)} UTC. The exact snapshot link preserves this captured version; collection details are included in the JSON download.`;
    $("share-expiry").textContent = `Link and downloads available until ${exactStamp(data.expiresAt)} UTC.`;
    $("content").hidden = data.coverage.status === "failed";
    if (data.coverage.status === "failed") { $("status").hidden = false; $("status").className = "status error"; $("status").textContent = "Collection failed for this community. Captured counts do not establish its activity."; return; }
    for (const [id, format] of [["json-download", "json"], ["posts-download", "posts.csv"], ["comments-download", "comments.csv"]]) {
      $(id).href = `${route}?${new URLSearchParams({ run: data.source.run, revision: data.source.revision, format, download: "1" })}`;
      $(id).setAttribute("download", "");
    }
    renderPosts();
    renderInsights();
    openLinkedThread();
  } catch {
    if (token !== generation) return;
    $("status").className = "status error"; $("status").textContent = "Snapshot storage is unavailable. Please try again later.";
  }
}
function renderPosts(append = false) {
  if (!snapshot) return;
  const term = $("search").value.trim().toLowerCase();
  const field = { score: "score", latest: "createdUtc", replies: "commentCount" }[$("sort").value];
  const rows = snapshot.posts.filter(post => `${post.title}\n${post.body}`.toLowerCase().includes(term)).sort((a, b) => b[field] - a[field] || a.id.localeCompare(b.id));
  $("list-count").textContent = `${number(rows.length)} ${term ? "matching" : "captured"} posts`;
  const start = append ? $("posts").children.length : 0;
  if (!append) $("posts").replaceChildren();
  for (const post of rows.slice(start, visible)) {
    const row = create("li", undefined, "post-row"), text = create("div");
    const button = create("button", post.title, "post-title"); button.dataset.postId = post.id; button.onclick = () => openThread(post);
    text.append(button, create("p", `${stamp(post.createdUtc * 1000)} UTC${post.flair ? ` · ${post.flair}` : ""}${post.nsfw ? " · NSFW" : ""}`, "post-meta"));
    const score = create("div", number(post.score), "metric"); score.append(create("small", "recorded score"));
    const replies = create("div", number(post.commentCount), "metric"); replies.append(create("small", "reported replies"));
    row.append(text, score, replies); $("posts").append(row);
  }
  $("no-results").hidden = rows.length !== 0;
  $("no-results").textContent = snapshot.posts.length === 0 && !term ? "Collection completed with no captured posts in this window." : "No posts match your search. Try a different phrase.";
  $("more").hidden = visible >= rows.length;
}
function renderInsights() {
  const data = snapshotInsights(snapshot);
  $("insights").hidden = false;
  $("insight-facts").replaceChildren();
  $("insights-preview").textContent = data.available ? `Median score ${number(data.medianScore)} · ${number(data.posts)} posts` : "Limited evidence";
  $("insights-note").textContent = data.available ? `${data.status === "partial" ? "Partial capture. " : ""}Descriptive observations from captured posts. Scores reflect different post ages.${data.excludedRemoved ? ` ${data.excludedRemoved} removed posts excluded.` : ""}` : data.reason;
  if (data.available) {
    for (const [label, leader, sentence] of [
      ["Highest recorded score", data.highestScore, `${number(data.highestScore.score)} recorded score. The median was ${number(data.medianScore)}; ${number(data.lowScorePosts)} of ${number(data.posts)} posts scored 1 or less.`],
      ["Most discussed thread", data.mostDiscussed, `${number(data.mostDiscussed.replies)} reported replies${data.mostDiscussed.share === null ? ". No reported replies across these posts." : ` — ${data.mostDiscussed.share}% of reported replies across these posts.`}`],
    ]) {
      const row = create("li", undefined, "insight-row"), title = create("h3", label);
      const button = create("button", leader.title, "post-title");
      button.onclick = () => openThread(snapshot.posts.find(post => post.id === leader.id));
      row.append(title, button, create("p", sentence)); $("insight-facts").append(row);
    }
    const mix = create("li", undefined, "insight-row");
    mix.append(create("h3", "Content mix · post labels"), create("p", data.contentMix.slice(0, 4).map(item => `${item.label}: ${number(item.count)} (${item.percent}%)`).join(" · ")));
    if (data.contentMix.length > 4) { const remaining = data.contentMix.length - 4; mix.append(create("p", `${remaining} other ${remaining === 1 ? "label is" : "labels are"} represented; all labels remain in the downloaded data.`)); }
    $("insight-facts").append(mix);
  }
  $("comparison").textContent = "Open insights to compare with the previous collection.";
  if ($("insights").open) void loadComparison();
}
async function loadComparison() {
  if (!snapshot || comparisonLoaded) return;
  comparisonLoaded = true;
  const token = ++comparisonGeneration, current = snapshot;
  const previous = choices().find(entry => entry.date < current.date);
  if (!previous) { $("comparison").textContent = compareCollections(current, null).reason; return; }
  $("comparison").textContent = "Checking the previous collection…";
  try {
    const response = await fetch(`/api/snapshots/${previous.date}/${encodeURIComponent(previous.subreddit)}?v=${previous.source.revision.slice(0, 12)}`);
    const data = await response.json();
    if (token !== comparisonGeneration) return;
    if (!response.ok) { $("comparison").textContent = "The earlier collection is unavailable; no change comparison is shown."; return; }
    const result = compareCollections(current, data);
    if (!result.comparable) { $("comparison").textContent = result.reason; return; }
    const change = result.postChangePercent === 0 ? "unchanged" : `${Math.abs(result.postChangePercent)}% ${result.postChangePercent < 0 ? "fewer" : "more"}`;
    $("comparison").textContent = `${number(result.currentPosts)} captured posts, ${change} compared with ${number(result.previousPosts)} on ${dateLabel(result.previousDate)}. ${result.note}`;
  } catch { if (token === comparisonGeneration) $("comparison").textContent = "The earlier collection could not be verified; no change comparison is shown."; }
}
function openThread(post) {
  $("thread-heading").textContent = post.title;
  $("thread-meta").textContent = `${number(post.score)} recorded score · ${stamp(post.createdUtc * 1000)} UTC · captured ${stamp(post.retrievedAt)} UTC`;
  $("thread-source").href = `https://www.reddit.com${post.permalink}`;
  $("thread-body").textContent = post.body || "No self-post text was captured. Open the source for linked content.";
  const comments = snapshot.comments.filter(comment => comment.postId === post.id);
  $("reply-heading").textContent = `${number(comments.length)} retained comments / ${number(post.commentCount)} reported replies`;
  $("replies").replaceChildren();
  const children = new Map(), ids = new Set(comments.map(comment => `t1_${comment.id}`));
  for (const comment of comments) {
    const parent = ids.has(comment.parentId) ? comment.parentId : "root";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(comment);
  }
  const visited = new Set();
  function add(parent, depth) {
    for (const comment of (children.get(parent) || []).sort((a, b) => a.createdUtc - b.createdUtc)) {
      if (visited.has(comment.id)) continue; visited.add(comment.id);
      const entry = create("article", undefined, "reply"); entry.style.setProperty("--depth", Math.min(depth, 5));
      const missing = comment.parentId.startsWith("t1_") && !ids.has(comment.parentId);
      entry.append(create("p", `${number(comment.score)} recorded score · ${stamp(comment.createdUtc * 1000)} UTC${comment.isSubmitter ? " · original poster" : ""}${missing ? " · parent reply not retained" : ""}`, "reply-meta"), create("p", comment.body, "prose"));
      $("replies").append(entry); add(`t1_${comment.id}`, depth + 1);
    }
  }
  add("root", 0);
  // Malformed/cyclic captured parent relationships remain visible, once each.
  for (const comment of comments) if (!visited.has(comment.id)) { children.set("orphan", [comment]); add("orphan", 0); }
  if (!comments.length) $("replies").append(create("p", "No retained comments were captured for this post.", "empty"));
  $("thread").showModal();
  document.body.classList.add("thread-open");
  $("thread").scrollTop = 0;
}
function openLinkedThread() {
  const match = /^#post-([a-z0-9]{1,32})$/.exec(location.hash);
  if (!match || !snapshot || $("thread").open) return;
  const post = snapshot.posts.find(row => row.id === match[1] && !row.removalState && row.title !== "[removed]" && row.body !== "[removed]" && row.body !== "[deleted]");
  if (!post) return;
  const opener = [...$("posts").querySelectorAll("button")].find(button => button.dataset.postId === post.id);
  (opener || $("snapshot")).focus({ preventScroll: true });
  openThread(post);
}
window.addEventListener("hashchange", openLinkedThread);
$("thread").addEventListener("close", () => document.body.classList.remove("thread-open"));
$("close-thread").onclick = () => $("thread").close();
$("thread").onclick = event => { if (event.target === $("thread")) { const rect = $("thread").getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $("thread").close(); } };
$("search").oninput = () => { visible = 50; renderPosts(); };
$("sort").onchange = () => { visible = 50; renderPosts(); };
$("more").onclick = () => {
  const firstNew = $("posts").children.length;
  const position = scrollY;
  visible += 50; renderPosts(true);
  scrollTo({ top: position, behavior: "instant" });
  // Keep the document at its reading position and move focus to the new evidence.
  $("posts").children[firstNew]?.querySelector("button")?.focus({ preventScroll: true });
};
$("insights").ontoggle = () => { if ($("insights").open) void loadComparison(); };
$("community").onchange = () => { $("search").value = ""; void load(); };
$("date").onchange = () => { month = $("date").value.slice(0, 7); void load(); };
$("available-date").onchange = () => chooseDate($("available-date").value);
for (const [id, direction] of [["month-prev", -1], ["month-next", 1]]) $(id).onclick = () => { if (!month) return; const [year, value] = month.split("-").map(Number); month = new Date(Date.UTC(year, value - 1 + direction)).toISOString().slice(0, 7); renderCalendar(); };
$("share").onclick = async () => {
  if (!snapshot) return;
  const link = new URL(snapshotPath(snapshot, true), location.origin).href;
  try { await navigator.clipboard.writeText(link); $("share-status").textContent = "Snapshot link copied."; }
  catch { $("share-fallback").hidden = false; $("share-url").value = link; $("share-url").focus(); $("share-url").select(); $("share-status").textContent = "Copy the snapshot link above."; }
};
async function initialize() {
  try {
    if (selection.invalid) throw new Error("This snapshot address is invalid. Use a subreddit and collection date, for example /r/AI_Agents/2026-10-01/.");
    const response = await fetch("/api/snapshots/catalog"), data = await response.json();
    if (!response.ok) throw new Error(data.message);
    catalog = data.entries;
    if (!catalog.length) throw new Error("No daily collections have been published yet.");
    const communities = [...new Set(catalog.map(entry => entry.subreddit))].sort((a, b) => a.localeCompare(b));
    const requested = selection.subreddit;
    if (requested && !communities.some(name => name.toLowerCase() === requested.toLowerCase())) {
      if (!/^[A-Za-z0-9_]{2,30}$/.test(requested)) throw new Error("Choose a valid subreddit.");
      communities.push(requested);
    }
    $("community").replaceChildren(...communities.map(name => { const option = create("option", `r/${name}`); option.value = name; return option; }));
    $("community").value = communities.find(name => requested && name.toLowerCase() === requested.toLowerCase()) || (communities.includes("AI_Agents") ? "AI_Agents" : communities[0]);
    $("date").value = selection.date || choices()[0]?.date || catalog[0].date;
    $("community").disabled = false; $("date").disabled = false;
    await load(selection.pinned, true);
  } catch (error) { clearContent(); $("status").className = "status error"; $("status").textContent = error.message || "Snapshot storage is unavailable."; }
}
addEventListener("popstate", () => { selection = parseSnapshotLocation(location.href); void initialize(); });
void initialize();
import { parseSnapshotLocation, snapshotPath } from "./paths.mjs";
import { snapshotInsights, compareCollections } from "./insights.mjs";
