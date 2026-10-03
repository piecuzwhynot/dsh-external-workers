window.__ModuleLoader__.load({
  id: "dsh-external-workers",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../.dsh/DSH-Plugins/dsh-external-workers/plugin-src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var React = __toESM(require("react"), 1);
var name = "external-workers-panel";
var inject = ["slots"];
var h = React.createElement;
var POLL_MS = 6e3;
var COLORS = {
  running: "var(--dsw-alias-brand-primary)",
  queued: "var(--dsw-alias-label-secondary)",
  completed: "var(--dsw-alias-state-success-primary)",
  failed: "var(--dsw-alias-state-error-primary)",
  blocked: "var(--dsw-alias-state-warn-primary)",
  retryable: "var(--dsw-alias-state-warn-primary)",
  canceled: "var(--dsw-alias-label-secondary)"
};
var TEXT = {
  zh: {
    title: "\u5916\u90E8 worker",
    detail: "\u8BE6\u60C5",
    close: "\u5173\u95ED",
    back: "\u8FD4\u56DE",
    tabLanes: "\u6CF3\u9053",
    tabJobs: "\u4F5C\u4E1A",
    running: "\u8FD0\u884C\u4E2D",
    queued: "\u6392\u961F",
    completed: "\u5B8C\u6210",
    failed: "\u5931\u8D25",
    blocked: "\u53D7\u963B",
    retryable: "\u53EF\u91CD\u8BD5",
    canceled: "\u5DF2\u53D6\u6D88",
    lane: "\u6CF3\u9053",
    role: "\u5206\u5DE5",
    model: "\u8BF7\u6C42\u6A21\u578B",
    actual: "\u5B9E\u9645\u8DD1\u7684",
    state: "\u72B6\u6001",
    session: "\u4F1A\u8BDD",
    cwd: "\u5DE5\u4F5C\u76EE\u5F55",
    jobsOf: "\u4E2A\u4F5C\u4E1A",
    lastModel: "\u4E0A\u6B21\u5B9E\u9645\u7528\u7684",
    quota: "\u989D\u5EA6",
    quotaNotReported: "\u8BE5\u4EA7\u54C1\u4E0D\u4E0A\u62A5\u989D\u5EA6",
    quotaCredits: "\u5C06\u7528 credits",
    creditsSpent: "\u26A0\uFE0F \u8FD9\u6B21\u82B1\u4E86 credits",
    settingsTitle: "\u5916\u90E8 worker",
    warnAt: "\u9884\u8B66\u9608\u503C",
    product: "\u4EA7\u54C1",
    save: "\u4FDD\u5B58",
    clear: "\u6E05\u7A7A",
    remove: "\u5220\u9664",
    addLane: "\u65B0\u5EFA\u6CF3\u9053",
    create: "\u521B\u5EFA",
    configFile: "\u914D\u7F6E\u6587\u4EF6",
    workspace: "\u5DE5\u4F5C\u76EE\u5F55",
    settingsHint: "\u6539\u4E86\u7ACB\u523B\u751F\u6548\uFF0C\u4E0D\u7528\u91CD\u542F\uFF1B\u65B0\u5EFA\u7684\u6CF3\u9053\u4E0B\u4E00\u6B21\u6D3E\u6D3B\u5C31\u4F1A\u5F00\u81EA\u5DF1\u7684\u4F1A\u8BDD\u3002",
    tabConversation: "\u5BF9\u8BDD",
    conversation: "\u5BF9\u8BDD",
    turns: "\u8F6E",
    you: "\u4F60",
    worker: "worker",
    tool: "\u5DE5\u5177",
    thinking: "\u601D\u8003",
    toolResult: "\u7ED3\u679C",
    noTurns: "\u8FD9\u6761\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5185\u5BB9\u3002",
    noSession: "(\u8FD8\u6CA1\u6709\u4F1A\u8BDD)",
    cannotRead: "\u8FD9\u4E2A\u4EA7\u54C1\u7684\u4F1A\u8BDD\u8BB0\u5F55\u73B0\u5728\u8FD8\u8BFB\u4E0D\u51FA\u6765\uFF1A",
    working: "\u6B63\u5728\u8DD1",
    send: "\u53D1\u9001",
    sending: "\u53D1\u9001\u4E2D\u2026",
    sayPlaceholder: "\u76F4\u63A5\u8DDF\u8FD9\u4E2A worker \u8BF4 \u2014\u2014 \u4F1A\u8FDB\u5B83\u81EA\u5DF1\u7684\u4F1A\u8BDD\uFF0C\u5B83\u8BB0\u5F97\u4E4B\u524D\u7684\u4E8B",
    sendHint: "\u4E00\u8F6E\u4E00\u6761\u6D88\u606F\uFF0C\u8FDB\u7684\u662F\u540C\u4E00\u6761\u4F1A\u8BDD\uFF1B\u4EA7\u51FA\u4F1A\u5728\u4E0A\u9762\u51FA\u73B0",
    continueAnyway: "\u6211\u786E\u8BA4\uFF0C\u7EE7\u7EED",
    spendCredits: "\u6211\u786E\u8BA4\uFF0C\u7528 credits",
    newSession: "\u5F00\u65B0\u4F1A\u8BDD\uFF08\u4E0D\u7EED\u63A5\uFF09",
    defaultModel: "(\u4EA7\u54C1\u9ED8\u8BA4)",
    noRole: "(\u672A\u5206\u5DE5)",
    none: "\u65E0",
    task: "\u4EFB\u52A1",
    artifacts: "\u4EA7\u7269",
    error: "\u9519\u8BEF",
    stderr: "stderr \u5C3E\u90E8",
    result: "\u5B8C\u6574\u7ED3\u679C",
    paths: "\u6587\u4EF6\u4F4D\u7F6E",
    attempts: "\u6267\u884C",
    exitCode: "\u9000\u51FA\u7801",
    all: "\u5168\u90E8",
    viewJobs: "\u770B\u5B83\u7684\u4F5C\u4E1A",
    empty: "\u8FD8\u6CA1\u6709\u4F5C\u4E1A\u3002",
    loading: "\u8BFB\u53D6\u4E2D\u2026",
    feedError: "\u53D6\u6570\u636E\u5931\u8D25",
    continues: "\u7EED\u63A5\u81EA",
    openHint: "\u70B9\u4EFB\u610F\u4E00\u884C\u770B\u5B8C\u6574\u5185\u5BB9 \xB7 Esc \u6216\u53F3\u4E0A\u89D2\u5173\u95ED"
  },
  en: {
    title: "External workers",
    detail: "details",
    close: "close",
    back: "back",
    tabLanes: "Lanes",
    tabJobs: "Jobs",
    running: "running",
    queued: "queued",
    completed: "done",
    failed: "failed",
    blocked: "blocked",
    retryable: "retryable",
    canceled: "canceled",
    lane: "lane",
    role: "role",
    model: "requested",
    actual: "ran on",
    state: "state",
    session: "session",
    cwd: "working dir",
    jobsOf: "jobs",
    lastModel: "last ran on",
    quota: "quota",
    quotaNotReported: "not reported by this product",
    quotaCredits: "will spend credits",
    creditsSpent: "\u26A0\uFE0F this run spent credits",
    settingsTitle: "External workers",
    warnAt: "warn at",
    product: "product",
    save: "save",
    clear: "clear",
    remove: "remove",
    addLane: "Add a lane",
    create: "create",
    configFile: "config file",
    workspace: "workspace",
    settingsHint: "Changes apply immediately, no restart. A new lane opens its own session on its first delegation.",
    tabConversation: "Conversation",
    conversation: "Conversation",
    turns: "turns",
    you: "you",
    worker: "worker",
    tool: "tool",
    thinking: "thinking",
    toolResult: "result",
    noTurns: "Nothing in this session yet.",
    noSession: "(no session yet)",
    cannotRead: "This product\u2019s conversation cannot be read yet:",
    working: "working",
    send: "send",
    sending: "sending\u2026",
    sayPlaceholder: "Say something to this worker \u2014 it goes into its own session, and it remembers",
    sendHint: "one message per turn, into the same session; what it produces appears above",
    continueAnyway: "continue anyway",
    spendCredits: "spend credits",
    newSession: "new session (do not continue)",
    defaultModel: "(product default)",
    noRole: "(no role)",
    none: "none",
    task: "task",
    artifacts: "artifacts",
    error: "error",
    stderr: "stderr tail",
    result: "full result",
    paths: "files",
    attempts: "attempts",
    exitCode: "exit code",
    all: "all",
    viewJobs: "view its jobs",
    empty: "No jobs yet.",
    loading: "loading\u2026",
    feedError: "feed failed",
    continues: "continues",
    openHint: "click any row for the full content \xB7 Esc or the \u2715 closes this"
  }
};
function pickText() {
  try {
    const language = typeof navigator !== "undefined" && navigator.language ? String(navigator.language) : "en";
    return /^zh/i.test(language) ? TEXT.zh : TEXT.en;
  } catch {
    return TEXT.en;
  }
}
var ui = {
  open: false,
  tab: "lanes",
  jobId: null,
  laneFilter: null,
  // the conversation tab: which lane, the draft, and whether a message is in flight
  conversationLane: null,
  draft: "",
  newSession: false,
  sending: false,
  gate: null
};
var watchers = /* @__PURE__ */ new Set();
function patchUi(next) {
  Object.assign(ui, next);
  for (const watcher of [...watchers]) {
    try {
      watcher();
    } catch {
    }
  }
}
function useUi() {
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    const watcher = () => bump((value) => value + 1);
    watchers.add(watcher);
    return () => {
      watchers.delete(watcher);
    };
  }, []);
  return ui;
}
function label(text, status) {
  return text[status] !== void 0 ? text[status] : status;
}
function clock(ms) {
  if (typeof ms !== "number" || ms <= 0) return "";
  try {
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return "";
  }
}
function duration(job) {
  const from = typeof job.startedAt === "number" ? job.startedAt : job.createdAt;
  const to = typeof job.finishedAt === "number" ? job.finishedAt : Date.now();
  if (typeof from !== "number" || typeof to !== "number") return "";
  const seconds = Math.max(0, Math.round((to - from) / 1e3));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}
function modelChip(job) {
  const name2 = typeof job.actualModel === "string" && job.actualModel.length > 0 ? job.actualModel : job.model;
  if (typeof name2 !== "string" || name2.length === 0) return null;
  const effort = typeof job.effort === "string" && job.effort.length > 0 ? ` (${job.effort})` : "";
  return `${name2}${effort}`;
}
function dot(color, size) {
  const px = size === void 0 ? 7 : size;
  return h("span", {
    style: { display: "inline-block", width: px, height: px, borderRadius: "50%", background: color, flex: "0 0 auto" }
  });
}
async function getJson(url) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable");
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (response.ok !== true || body === null) {
    throw new Error(body && body.error ? String(body.error) : `HTTP ${response.status}`);
  }
  return body;
}
function useFeed() {
  const [payload, setPayload] = React.useState(null);
  const [failure, setFailure] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await getJson("/api/external-workers/jobs");
        if (!alive) return;
        if (next && next.ok === true) {
          setPayload(next);
          setFailure(null);
        }
      } catch (error) {
        if (alive) setFailure(String(error && error.message || error));
      }
    };
    void load();
    let timer = null;
    try {
      timer = setInterval(() => {
        void load();
      }, POLL_MS);
    } catch {
      timer = null;
    }
    return () => {
      alive = false;
      if (timer !== null) {
        try {
          clearInterval(timer);
        } catch {
        }
      }
    };
  }, []);
  return { payload, failure };
}
function useJobDetail(jobId) {
  const [detail, setDetail] = React.useState(null);
  const [failure, setFailure] = React.useState(null);
  React.useEffect(() => {
    if (jobId === null || jobId === void 0) {
      setDetail(null);
      setFailure(null);
      return void 0;
    }
    let alive = true;
    setDetail(null);
    setFailure(null);
    void (async () => {
      try {
        const next = await getJson(`/api/external-workers/job?id=${encodeURIComponent(jobId)}`);
        if (alive) setDetail(next);
      } catch (error) {
        if (alive) setFailure(String(error && error.message || error));
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);
  return { detail, failure };
}
function summarize(text, counts) {
  const active = (counts.running || 0) + (counts.queued || 0);
  const parts = [h("span", {
    key: "badge",
    style: { display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--dsw-alias-label-primary)" }
  }, dot(active > 0 ? COLORS.running : "var(--dsw-alias-label-secondary)"), text.title)];
  for (const key of ["running", "queued", "completed", "failed", "blocked", "retryable"]) {
    const value = counts[key] || 0;
    if (value === 0) continue;
    parts.push(h("span", {
      key,
      style: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--dsw-alias-label-secondary)" }
    }, dot(COLORS[key], 6), `${value} ${label(text, key)}`));
  }
  return parts;
}
function DockRow() {
  const text = pickText();
  const { payload } = useFeed();
  const state = useUi();
  const total = payload && typeof payload.total === "number" ? payload.total : 0;
  if (total === 0 && state.open !== true) return null;
  const counts = payload && payload.counts || {};
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "nowrap",
        overflow: "hidden",
        whiteSpace: "nowrap",
        border: "1px solid var(--dsw-alias-border-l1)",
        background: "var(--dsw-alias-bg-layer-1)",
        borderRadius: 8,
        padding: "4px 10px",
        fontSize: 12,
        lineHeight: "20px",
        marginBottom: 6,
        minWidth: 0
      }
    },
    // `0 1 auto`, not `1 1 auto`: the group sizes to its own content so the
    // button lands beside it. It can still shrink, which is what keeps the row
    // on one line when the numbers get long.
    h("div", {
      style: { display: "flex", alignItems: "center", gap: 14, flex: "0 1 auto", minWidth: 0, overflow: "hidden" }
    }, summarize(text, counts), h("span", { key: "total", style: { color: "var(--dsw-alias-label-secondary)" } }, `\xB7 ${total}`)),
    h("button", {
      type: "button",
      onClick: () => patchUi({ open: state.open !== true }),
      style: {
        flex: "0 0 auto",
        cursor: "pointer",
        border: "1px solid var(--dsw-alias-border-l1)",
        background: "transparent",
        color: "var(--dsw-alias-label-primary)",
        borderRadius: 6,
        padding: "2px 10px",
        fontSize: 12
      }
    }, text.detail)
  );
}
var box = {
  border: "1px solid var(--dsw-alias-border-l1)",
  background: "var(--dsw-alias-bg-layer-2)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  lineHeight: 1.5
};
var mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, overflowWrap: "anywhere" };
function field(text, key, value) {
  if (value === null || value === void 0 || value === "" || value === false) return null;
  return h(
    "div",
    { key, style: { display: "flex", gap: 8, minWidth: 0 } },
    h("span", { style: { flex: "0 0 82px", color: "var(--dsw-alias-label-secondary)" } }, text[key] !== void 0 ? text[key] : key),
    h("span", { style: { flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere", color: "var(--dsw-alias-label-primary)" } }, String(value))
  );
}
function pre(body, key) {
  if (typeof body !== "string" || body.length === 0) return null;
  return h("pre", {
    key,
    style: {
      margin: "6px 0 0",
      padding: 8,
      maxHeight: 420,
      overflow: "auto",
      background: "var(--dsw-alias-bg-layer-1)",
      border: "1px solid var(--dsw-alias-border-l1)",
      borderRadius: 6,
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11,
      lineHeight: 1.5
    }
  }, body);
}
function LanesTab(text, payload, state) {
  const lanes = Array.isArray(payload.lanes) ? payload.lanes : [];
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const blocks = [];
  for (const lane of lanes) {
    const own = jobs.filter((job) => (job.lane || job.worker) === lane.id);
    const active = own.filter((job) => job.status === "running" || job.status === "queued").length;
    const model = [lane.model || text.defaultModel, lane.effort ? `effort ${lane.effort}` : null, lane.speed ? `speed ${lane.speed}` : null].filter((part) => part !== null).join(" \xB7 ");
    blocks.push(h(
      "div",
      { key: lane.id, style: Object.assign({}, box, { marginBottom: 8 }) },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
        dot(active > 0 ? COLORS.running : "var(--dsw-alias-label-secondary)"),
        h("strong", { style: { color: "var(--dsw-alias-label-primary)" } }, lane.id),
        h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, lane.worker),
        h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, `${own.length} ${text.jobsOf}`),
        h("button", {
          type: "button",
          onClick: () => patchUi({ tab: "jobs", laneFilter: lane.id, jobId: null }),
          style: { marginLeft: "auto", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1)", background: "transparent", color: "var(--dsw-alias-label-secondary)", borderRadius: 6, padding: "1px 8px", fontSize: 11 }
        }, text.viewJobs)
      ),
      field(text, "role", lane.role || text.noRole),
      field(text, "model", model),
      field(text, "lastModel", lane.lastModel || null),
      field(text, "state", lane.state),
      field(text, "session", lane.sessionId),
      h(
        "div",
        { key: "cwd", style: { display: "flex", gap: 8 } },
        h("span", { style: { flex: "0 0 82px", color: "var(--dsw-alias-label-secondary)" } }, text.cwd),
        h("span", { style: Object.assign({}, mono, { flex: "1 1 auto", color: "var(--dsw-alias-label-primary)" }) }, `~/.dsh/workers/${lane.id}`)
      )
    ));
  }
  if (blocks.length === 0) blocks.push(h("div", { key: "none", style: { color: "var(--dsw-alias-label-secondary)" } }, text.empty));
  return blocks;
}
function JobsTab(text, payload, state) {
  const all = Array.isArray(payload.jobs) ? payload.jobs : [];
  const filter = state.laneFilter;
  const jobs = filter === null ? all : all.filter((job) => (job.lane || job.worker) === filter);
  const chips = [];
  const names = [...new Set(all.map((job) => job.lane || job.worker))];
  for (const name2 of [null].concat(names)) {
    const active = name2 === filter;
    chips.push(h("button", {
      key: name2 === null ? "__all__" : name2,
      type: "button",
      onClick: () => patchUi({ laneFilter: name2, jobId: null }),
      style: {
        cursor: "pointer",
        border: `1px solid ${active ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l1)"}`,
        background: "transparent",
        color: active ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-label-secondary)",
        borderRadius: 999,
        padding: "1px 10px",
        fontSize: 11
      }
    }, name2 === null ? text.all : name2));
  }
  const order = { running: 0, queued: 1, retryable: 2, blocked: 3, failed: 4, completed: 5, canceled: 6 };
  const rows = [];
  for (const job of jobs.slice().sort((a, b) => {
    const delta = (order[a.status] !== void 0 ? order[a.status] : 9) - (order[b.status] !== void 0 ? order[b.status] : 9);
    return delta !== 0 ? delta : (b.createdAt || 0) - (a.createdAt || 0);
  })) {
    rows.push(h(
      "button",
      {
        key: job.id,
        type: "button",
        onClick: () => patchUi({ tab: "jobs", jobId: job.id }),
        style: {
          display: "block",
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          border: "1px solid var(--dsw-alias-border-l1)",
          background: "var(--dsw-alias-bg-layer-2)",
          color: "inherit",
          borderRadius: 8,
          padding: "7px 10px",
          marginBottom: 6,
          fontSize: 12,
          lineHeight: 1.45
        }
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
        dot(COLORS[job.status] !== void 0 ? COLORS[job.status] : "var(--dsw-alias-label-secondary)"),
        h("strong", { style: { color: "var(--dsw-alias-label-primary)" } }, job.worker),
        h("span", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 11, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 999, padding: "0 6px" } }, job.lane || job.worker),
        h("span", { style: { color: COLORS[job.status] !== void 0 ? COLORS[job.status] : "inherit" } }, label(text, job.status)),
        modelChip(job) === null ? null : h("span", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }, modelChip(job)),
        h("span", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 11 } }, `#${job.id} \xB7 ${duration(job)}${Array.isArray(job.artifacts) && job.artifacts.length > 0 ? ` \xB7 ${job.artifacts.length} ${text.artifacts}` : ""}`)
      ),
      h("div", { style: { color: "var(--dsw-alias-label-secondary)", marginTop: 2, overflowWrap: "anywhere" } }, job.task),
      job.lastError ? h("div", { style: { color: "var(--dsw-alias-state-error-primary)", marginTop: 2, overflowWrap: "anywhere" } }, job.lastError) : null
    ));
  }
  if (rows.length === 0) rows.push(h("div", { key: "none", style: { color: "var(--dsw-alias-label-secondary)" } }, text.empty));
  return [h("div", { key: "chips", style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 } }, chips)].concat(rows);
}
function JobDetail(props) {
  const text = props.text;
  const jobId = props.jobId;
  const { detail, failure } = useJobDetail(jobId);
  if (failure !== null && failure !== void 0) {
    return h("div", { style: { color: "var(--dsw-alias-state-error-primary)" } }, failure);
  }
  if (detail === null || detail.job === void 0) {
    return h("div", { style: { color: "var(--dsw-alias-label-secondary)" } }, text.loading);
  }
  const job = detail.job;
  const blocks = [
    h(
      "div",
      { key: "head", style: Object.assign({}, box, { marginBottom: 8 }) },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" } },
        dot(COLORS[job.status] !== void 0 ? COLORS[job.status] : "var(--dsw-alias-label-secondary)"),
        h("strong", null, `${job.worker} \xB7 #${job.id}`),
        h("span", { style: { color: COLORS[job.status] !== void 0 ? COLORS[job.status] : "inherit" } }, label(text, job.status)),
        job.retryable ? h("span", { style: { color: "var(--dsw-alias-state-warn-primary)" } }, `(${text.retryable})`) : null
      ),
      field(text, "task", job.task),
      field(text, "lane", job.lane || job.worker),
      field(text, "session", job.sessionId),
      field(text, "model", [job.model || text.defaultModel, job.effort ? `effort ${job.effort}` : null, job.speed ? `speed ${job.speed}` : null].filter((part) => part !== null).join(" \xB7 ")),
      field(text, "actual", job.actualModel || null),
      Number.isFinite(job.creditsSpent) ? field(text, "creditsSpent", `$${Number(job.creditsSpent).toFixed(4)}`) : null,
      field(text, "state", [clock(job.createdAt), clock(job.finishedAt)].filter((part) => part.length > 0).join("  \u2192  ")),
      field(text, "attempts", `${job.attempts}${job.exitCode === null || job.exitCode === void 0 ? "" : ` \xB7 ${text.exitCode} ${job.exitCode}`}`),
      field(text, "cwd", job.cwd),
      job.parentJobId ? field(text, "continues", job.parentJobId) : null
    )
  ];
  if (job.lastError) {
    blocks.push(h(
      "div",
      { key: "error", style: Object.assign({}, box, { marginBottom: 8, borderColor: "var(--dsw-alias-state-error-primary)" }) },
      h("div", { style: { color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 } }, `${text.error}${job.failureKind ? ` (${job.failureKind})` : ""}`),
      pre(job.lastError, "e")
    ));
  }
  if (Array.isArray(job.artifacts) && job.artifacts.length > 0) {
    blocks.push(h(
      "div",
      { key: "artifacts", style: Object.assign({}, box, { marginBottom: 8 }) },
      h("div", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, text.artifacts),
      ...job.artifacts.map((artifact, index) => h("div", { key: `a${index}`, style: Object.assign({}, mono, { color: "var(--dsw-alias-label-secondary)" }) }, artifact))
    ));
  }
  if (typeof job.resultText === "string" && job.resultText.length > 0) {
    blocks.push(h(
      "div",
      { key: "result", style: Object.assign({}, box, { marginBottom: 8 }) },
      h("div", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, `${text.result} (${job.resultText.length})`),
      pre(job.resultText, "r")
    ));
  }
  if (typeof job.stderrTail === "string" && job.stderrTail.length > 0) {
    blocks.push(h(
      "div",
      { key: "stderr", style: Object.assign({}, box, { marginBottom: 8 }) },
      h("div", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, text.stderr),
      pre(job.stderrTail, "s")
    ));
  }
  blocks.push(h(
    "div",
    { key: "paths", style: Object.assign({}, box) },
    h("div", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginBottom: 4 } }, text.paths),
    ...["packetPath", "stdoutPath", "stderrPath", "jobDir"].filter((key) => typeof job[key] === "string" && job[key].length > 0).map((key) => h("div", { key, style: Object.assign({}, mono, { color: "var(--dsw-alias-label-secondary)" }) }, job[key]))
  ));
  return h("div", { key: "jobdetail" }, blocks);
}
function QuotaStrip(text, payload) {
  const entries = Array.isArray(payload.quota) ? payload.quota : [];
  if (entries.length === 0) return null;
  const threshold = typeof payload.threshold === "number" ? payload.threshold : 90;
  const rows = [];
  for (const entry of entries) {
    if (entry.readable !== true) {
      rows.push(h(
        "div",
        { key: entry.product, style: { display: "flex", gap: 8, color: "var(--dsw-alias-label-secondary)", fontSize: 11 } },
        h("span", { style: { fontWeight: 600, minWidth: 62 } }, entry.product),
        h("span", null, text.quotaNotReported)
      ));
      continue;
    }
    const worst = [entry.short, entry.long].filter((item) => item !== null && item !== void 0).reduce((max, item) => Math.max(max, item.usedPercent), 0);
    const color = entry.willUseCredits === true ? "var(--dsw-alias-state-error-primary)" : worst >= threshold ? "var(--dsw-alias-state-warn-primary)" : "var(--dsw-alias-label-secondary)";
    rows.push(h(
      "div",
      { key: entry.product, style: { display: "flex", gap: 8, fontSize: 11, alignItems: "baseline" } },
      h("span", { style: { fontWeight: 600, minWidth: 62, color: "var(--dsw-alias-label-primary)" } }, entry.product),
      h("span", { style: { color } }, entry.text),
      entry.willUseCredits === true ? h("span", { style: { color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 } }, text.quotaCredits) : null
    ));
  }
  return h(
    "div",
    { key: "quota", style: Object.assign({}, box, { marginBottom: 8 }) },
    h("div", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginBottom: 4 } }, text.quota),
    ...rows
  );
}
function useConversation(laneId) {
  const [state, setState] = React.useState({ data: null, failure: null });
  React.useEffect(() => {
    if (laneId === null || laneId === void 0) {
      setState({ data: null, failure: null });
      return void 0;
    }
    let alive = true;
    const load = async () => {
      try {
        const next = await getJson(`/api/external-workers/conversation?lane=${encodeURIComponent(laneId)}&limit=120`);
        if (alive) setState({ data: next, failure: null });
      } catch (error) {
        if (alive) setState((previous) => ({ data: previous.data, failure: String(error && error.message || error) }));
      }
    };
    void load();
    let timer = null;
    try {
      timer = setInterval(() => {
        void load();
      }, 5e3);
    } catch {
      timer = null;
    }
    return () => {
      alive = false;
      if (timer !== null) {
        try {
          clearInterval(timer);
        } catch {
        }
      }
    };
  }, [laneId]);
  return state;
}
function Turn(text, turn, index) {
  const role = turn.role === "user" ? text.you : turn.workerLabel === true ? turn.workerLabelText : text.worker;
  const who = turn.kind === "tool" ? `${role} \xB7 ${turn.name}` : role;
  const color = turn.role === "user" ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-label-secondary)";
  if (turn.kind === "tool") {
    return h(
      "div",
      { key: index, style: { display: "flex", gap: 8, fontSize: 11, padding: "1px 0" } },
      h("span", { style: { flex: "0 0 96px", color, textAlign: "right" } }, text.tool),
      h("span", { style: Object.assign({}, mono, { flex: "1 1 auto", color: "var(--dsw-alias-label-primary)", overflowWrap: "anywhere" }) }, `${turn.name} ${turn.detail || ""}`.trim())
    );
  }
  if (turn.kind === "result" || turn.kind === "reasoning") {
    const label2 = turn.kind === "reasoning" ? text.thinking : text.toolResult;
    return h(
      "details",
      { key: index, style: { fontSize: 11, padding: "1px 0" } },
      h("summary", { style: { cursor: "pointer", color: "var(--dsw-alias-label-secondary)" } }, `${label2} \xB7 ${String(turn.text || "").slice(0, 70)}`),
      h("pre", { style: { margin: "4px 0 4px 12px", padding: 6, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "var(--dsw-alias-bg-layer-1)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }, turn.text)
    );
  }
  return h(
    "div",
    { key: index, style: { display: "flex", gap: 8, padding: "2px 0" } },
    h("span", { style: { flex: "0 0 96px", color, textAlign: "right", fontSize: 11 } }, who),
    h("span", { style: { flex: "1 1 auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--dsw-alias-label-primary)" } }, turn.text)
  );
}
var IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
function ConversationTab(text, payload, state, conversation) {
  const lanes = Array.isArray(payload.lanes) ? payload.lanes : [];
  const selected = state.conversationLane === null || state.conversationLane === void 0 ? lanes[0] === void 0 ? null : lanes[0].id : state.conversationLane;
  const chips = lanes.map((lane2) => {
    const active = lane2.id === selected;
    return h("button", {
      key: lane2.id,
      type: "button",
      onClick: () => patchUi({ conversationLane: lane2.id, draft: "", gate: null }),
      style: {
        cursor: "pointer",
        border: `1px solid ${active ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l1)"}`,
        background: "transparent",
        color: active ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-label-secondary)",
        borderRadius: 999,
        padding: "1px 10px",
        fontSize: 11
      }
    }, `${lane2.id} \xB7 ${lane2.worker}`);
  });
  const blocks = [h("div", { key: "chips", style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 } }, chips)];
  if (selected === null) {
    blocks.push(h("div", { key: "none", style: { color: "var(--dsw-alias-label-secondary)" } }, text.empty));
    return blocks;
  }
  const data = conversation === null || conversation === void 0 ? null : conversation.data;
  const convFailure = conversation === null || conversation === void 0 ? null : conversation.failure;
  if (convFailure !== null && convFailure !== void 0) {
    blocks.push(h("div", { key: "feed", style: { color: "var(--dsw-alias-state-warn-primary)", marginBottom: 8 } }, `${text.feedError}: ${convFailure}`));
  }
  if (data === null || data === void 0 || data.lane === void 0) {
    blocks.push(h("div", { key: "loading", style: { color: "var(--dsw-alias-label-secondary)" } }, text.loading));
    return blocks;
  }
  const lane = data.lane;
  blocks.push(h(
    "div",
    { key: "head", style: Object.assign({}, box, { marginBottom: 8, fontSize: 11 }) },
    h(
      "div",
      { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
      h("span", { style: { color: "var(--dsw-alias-label-primary)", fontWeight: 600 } }, `${lane.id} \xB7 ${lane.worker}`),
      h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, lane.model === null ? text.defaultModel : `${lane.model}${lane.model_actual === null ? "" : ` \u2192 ${lane.model_actual}`}`),
      h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, lane.sessionId === null ? text.noSession : `${text.session} ${String(lane.sessionId).slice(0, 8)}\u2026`),
      h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, lane.state)
    ),
    h("div", { style: Object.assign({}, mono, { color: "var(--dsw-alias-label-secondary)", marginTop: 4 }) }, lane.cwd)
  ));
  if (data.running !== null && data.running !== void 0) {
    blocks.push(h(
      "div",
      { key: "running", style: Object.assign({}, box, { marginBottom: 8, borderColor: "var(--dsw-alias-brand-primary)" }) },
      h("div", { style: { color: "var(--dsw-alias-brand-primary)", fontWeight: 600, marginBottom: 4 } }, `${text.working} \xB7 ${data.running.id}`),
      h("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 11 } }, data.running.task)
    ));
  }
  if (data.supported !== true) {
    blocks.push(h(
      "div",
      { key: "unsupported", style: Object.assign({}, box, { marginBottom: 8, color: "var(--dsw-alias-state-warn-primary)" }) },
      text.cannotRead,
      h("div", { style: { marginTop: 4, fontSize: 11, color: "var(--dsw-alias-label-secondary)" } }, String(data.reason ?? ""))
    ));
  } else if (data.turns.length === 0) {
    blocks.push(h("div", { key: "empty", style: { color: "var(--dsw-alias-label-secondary)" } }, text.noTurns));
  }
  blocks.push(h(
    "div",
    { key: "turns", style: Object.assign({}, box, { marginBottom: 8 }) },
    h("div", { style: { fontWeight: 600, marginBottom: 6 } }, `${text.conversation} \xB7 ${data.total} ${text.turns}`),
    ...data.turns.map((turn, index) => Turn(text, turn, index))
  ));
  const jobBlocks = [];
  for (const job of data.jobs ?? []) {
    const files = Array.isArray(job.artifacts) ? job.artifacts : [];
    if (files.length === 0) continue;
    jobBlocks.push(h(
      "div",
      { key: `j${job.id}`, style: { marginBottom: 6 } },
      h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", marginBottom: 4 } }, `#${job.id} \xB7 ${job.status} \xB7 ${job.task}`),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
        ...files.map((file) => {
          const url = `/api/external-workers/artifact?lane=${encodeURIComponent(lane.id)}&job=${encodeURIComponent(job.id)}&path=${encodeURIComponent(file)}`;
          const isImage = IMAGE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));
          if (isImage !== true) {
            return h("div", { key: file, style: Object.assign({}, mono, { color: "var(--dsw-alias-label-secondary)" }) }, file);
          }
          return h(
            "a",
            { key: file, href: url, target: "_blank", rel: "noreferrer", title: file, style: { display: "block" } },
            h("img", { src: url, alt: file, loading: "lazy", style: { maxWidth: 220, maxHeight: 160, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1)", display: "block" } })
          );
        })
      )
    ));
  }
  if (jobBlocks.length > 0) {
    blocks.push(h(
      "div",
      { key: "artifacts", style: Object.assign({}, box, { marginBottom: 8 }) },
      h("div", { style: { fontWeight: 600, marginBottom: 6 } }, text.artifacts),
      ...jobBlocks
    ));
  }
  if (state.gate !== null && state.gate !== void 0) {
    const gate = state.gate;
    blocks.push(h("div", { key: "gate", style: Object.assign({}, box, { marginBottom: 8, borderColor: "var(--dsw-alias-state-warn-primary)", whiteSpace: "pre-wrap", color: "var(--dsw-alias-state-warn-primary)" }) }, gate.text));
    if (gate.reason !== void 0 && gate.reason !== null) {
      blocks.push(h(
        "div",
        { key: "gatebtn", style: { marginBottom: 8 } },
        h("button", {
          type: "button",
          onClick: () => {
            void sendDraft(lane.id, gate.reason === "credits" ? { allowCredits: true } : { allowQuota: true });
          },
          style: buttonStyle("var(--dsw-alias-state-warn-primary)")
        }, gate.reason === "credits" ? text.spendCredits : text.continueAnyway)
      ));
    }
  }
  blocks.push(h(
    "div",
    { key: "composer", style: Object.assign({}, box, { marginBottom: 8 }) },
    h("textarea", {
      value: state.draft ?? "",
      onChange: (event) => patchUi({ draft: event.target.value }),
      placeholder: text.sayPlaceholder,
      rows: 3,
      style: Object.assign({}, mono, { width: "100%", boxSizing: "border-box", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, padding: 6, resize: "vertical", fontFamily: "inherit", fontSize: 12 })
    }),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 } },
      h(
        "label",
        { style: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--dsw-alias-label-secondary)" } },
        h("input", { type: "checkbox", checked: state.newSession === true, onChange: () => patchUi({ newSession: state.newSession !== true }) }),
        text.newSession
      ),
      h("button", {
        type: "button",
        disabled: state.sending === true || String(state.draft ?? "").trim().length === 0,
        onClick: () => {
          void sendDraft(lane.id, {});
        },
        style: Object.assign(buttonStyle("var(--dsw-alias-brand-primary)"), { marginLeft: "auto" })
      }, state.sending === true ? text.sending : text.send),
      h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" } }, text.sendHint)
    )
  ));
  return blocks;
}
async function sendDraft(laneId, approvals) {
  const message = String(ui.draft ?? "").trim();
  if (message.length === 0) return;
  patchUi({ sending: true, gate: null });
  try {
    const response = await fetch("/api/external-workers/say", {
      method: "POST",
      headers: { "content-type": "application/json", "x-external-workers": "1" },
      body: JSON.stringify({ lane: laneId, message, new_session: ui.newSession === true, ...approvals })
    });
    const result = await response.json().catch(() => null);
    if (result !== null && result.blocked === true) {
      patchUi({ sending: false, gate: { text: result.error ?? "", reason: result.reason ?? null } });
      return;
    }
    if (response.ok !== true) throw new Error(result && result.error ? String(result.error) : `HTTP ${response.status}`);
    patchUi({ sending: false, draft: "", gate: null, note: `sent \xB7 ${result.jobId}` });
  } catch (error) {
    patchUi({ sending: false, gate: { text: `${text_of_error(error)}`, reason: null } });
  }
}
function text_of_error(error) {
  return String(error && error.message || error);
}
function Drawer() {
  const text = pickText();
  const { payload, failure } = useFeed();
  const state = useUi();
  const lanes = payload !== null && Array.isArray(payload.lanes) ? payload.lanes : [];
  const conversationLane = state.tab === "conversation" && state.open === true && state.jobId === null ? state.conversationLane === null || state.conversationLane === void 0 ? lanes[0] === void 0 ? null : lanes[0].id : state.conversationLane : null;
  const conversation = useConversation(conversationLane);
  React.useEffect(() => {
    if (state.open !== true) return void 0;
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return void 0;
    const onKey = (event) => {
      if (event && event.key === "Escape") patchUi({ open: false });
    };
    try {
      document.addEventListener("keydown", onKey);
      return () => {
        try {
          document.removeEventListener("keydown", onKey);
        } catch {
        }
      };
    } catch {
      return void 0;
    }
  }, [state.open]);
  if (state.open !== true) return null;
  const body = [];
  if (failure !== null && failure !== void 0) {
    body.push(h("div", { key: "feed", style: { color: "var(--dsw-alias-state-warn-primary)", marginBottom: 8 } }, `${text.feedError}: ${failure}`));
  }
  if (payload === null) {
    body.push(h("div", { key: "loading", style: { color: "var(--dsw-alias-label-secondary)" } }, text.loading));
  } else if (state.jobId !== null) {
    body.push(h("button", {
      key: "back",
      type: "button",
      onClick: () => patchUi({ jobId: null }),
      style: { cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1)", background: "transparent", color: "var(--dsw-alias-label-secondary)", borderRadius: 6, padding: "2px 10px", fontSize: 11, marginBottom: 10 }
    }, `\u2190 ${text.back}`));
    body.push(h(JobDetail, { key: "job", text, jobId: state.jobId }));
  } else {
    const strip = QuotaStrip(text, payload);
    if (strip !== null) body.push(strip);
    if (state.tab === "lanes") {
      for (const block of LanesTab(text, payload, state)) body.push(block);
    } else if (state.tab === "conversation") {
      for (const block of ConversationTab(text, payload, state, conversation)) body.push(block);
    } else {
      for (const block of JobsTab(text, payload, state)) body.push(block);
    }
  }
  const tabs = [["lanes", text.tabLanes], ["conversation", text.tabConversation], ["jobs", text.tabJobs]].map(([id, caption]) => h("button", {
    key: id,
    type: "button",
    onClick: () => patchUi({ tab: id, jobId: null }),
    style: {
      cursor: "pointer",
      border: "none",
      borderBottom: `2px solid ${state.tab === id && state.jobId === null ? "var(--dsw-alias-brand-primary)" : "transparent"}`,
      background: "transparent",
      color: state.tab === id && state.jobId === null ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-label-secondary)",
      padding: "4px 2px",
      fontSize: 12,
      fontWeight: 600
    }
  }, caption));
  return h(
    "div",
    {
      style: {
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(620px, 94vw)",
        display: "flex",
        flexDirection: "column",
        background: "var(--dsw-alias-bg-overlay)",
        borderLeft: "1px solid var(--dsw-alias-border-l2)",
        boxShadow: "-12px 0 32px rgba(0, 0, 0, 0.28)",
        pointerEvents: "auto",
        zIndex: 40
      }
    },
    h(
      "div",
      {
        style: { flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--dsw-alias-border-l1)" }
      },
      h("strong", { style: { color: "var(--dsw-alias-label-primary)", fontSize: 13 } }, text.title),
      h("div", { style: { display: "flex", gap: 14 } }, tabs),
      h("button", {
        type: "button",
        onClick: () => patchUi({ open: false }),
        style: { marginLeft: "auto", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1)", background: "transparent", color: "var(--dsw-alias-label-primary)", borderRadius: 6, padding: "2px 10px", fontSize: 12 }
      }, `\u2715 ${text.close}`)
    ),
    h("div", {
      style: { flex: "1 1 auto", overflowY: "auto", overflowX: "hidden", padding: "12px 14px", minHeight: 0 }
    }, body),
    h("div", {
      style: { flex: "0 0 auto", padding: "6px 14px", borderTop: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-secondary)", fontSize: 11 }
    }, text.openHint)
  );
}
function SettingsPage(props) {
  const text = pickText();
  const [state, setState] = React.useState({ payload: null, failure: null, busy: false, note: null });
  const [draft, setDraft] = React.useState({});
  const [newLane, setNewLane] = React.useState({ lane: "", worker: "" });
  const load = React.useCallback(async () => {
    try {
      const next = await getJson("/api/external-workers/settings");
      setState((previous) => ({ ...previous, payload: next, failure: null }));
    } catch (error) {
      setState((previous) => ({ ...previous, failure: String(error && error.message || error) }));
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  const send = React.useCallback(async (body) => {
    setState((previous) => ({ ...previous, busy: true, note: null }));
    try {
      const response = await fetch("/api/external-workers/settings", {
        method: "POST",
        headers: { "content-type": "application/json", "x-external-workers": "1" },
        body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => null);
      if (response.ok !== true) throw new Error(result && result.error ? String(result.error) : `HTTP ${response.status}`);
      setState((previous) => ({ ...previous, payload: result, busy: false, note: result.message ?? "saved", failure: null }));
    } catch (error) {
      setState((previous) => ({ ...previous, busy: false, failure: String(error && error.message || error) }));
    }
  }, []);
  if (state.payload === null || state.payload === void 0) {
    return h("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, state.failure === null ? text.loading : `${text.feedError}: ${state.failure}`);
  }
  const payload = state.payload;
  const newLaneId = (newLane.lane ?? "").trim();
  const newLaneWorker = newLane.worker ?? "";
  const productIds = (payload.products ?? []).map((product) => product.id);
  const blocks = [];
  if (state.failure !== null) {
    blocks.push(h("div", { key: "err", style: Object.assign({}, box, { marginBottom: 10, borderColor: "var(--dsw-alias-state-error-primary)", color: "var(--dsw-alias-state-error-primary)" }) }, state.failure));
  }
  if (state.note !== null) {
    blocks.push(h("div", { key: "note", style: Object.assign({}, box, { marginBottom: 10, color: "var(--dsw-alias-state-success-primary)" }) }, state.note));
  }
  const quotaRows = (payload.quota ?? []).map((entry) => h(
    "div",
    { key: entry.product, style: { display: "flex", gap: 8, fontSize: 12 } },
    h("span", { style: { minWidth: 74, fontWeight: 600 } }, entry.product),
    h("span", { style: { color: entry.willUseCredits === true ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)" } }, entry.readable === true ? entry.text : text.quotaNotReported)
  ));
  blocks.push(h(
    "div",
    { key: "quota", style: Object.assign({}, box, { marginBottom: 10 }) },
    h("div", { style: { fontWeight: 600, marginBottom: 6 } }, `${text.quota} \xB7 ${text.warnAt} ${payload.quotaWarnAtPercent}%`),
    ...quotaRows
  ));
  for (const lane of payload.lanes) {
    const edit = draft[lane.id] ?? { role: lane.role ?? "", model: lane.model ?? "", effort: lane.effort ?? "", speed: lane.speed ?? "" };
    const setField = (field2) => (event) => setDraft((previous) => ({ ...previous, [lane.id]: { ...edit, [field2]: event.target.value } }));
    const input = (field2, width) => h("input", {
      value: edit[field2],
      onChange: setField(field2),
      placeholder: field2 === "role" ? text.noRole : text.defaultModel,
      style: Object.assign({}, mono, { flex: "1 1 auto", minWidth: width, background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, padding: "3px 6px" })
    });
    blocks.push(h(
      "div",
      { key: lane.id, style: Object.assign({}, box, { marginBottom: 8 }) },
      h(
        "div",
        { style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" } },
        h("strong", { style: { fontSize: 13 } }, lane.id),
        h("span", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 11 } }, lane.worker),
        h("span", { style: Object.assign({}, mono, { color: "var(--dsw-alias-label-secondary)" }) }, `~/.dsh/workers/${lane.id}`),
        h(
          "span",
          { style: { marginLeft: "auto", fontSize: 11, color: "var(--dsw-alias-label-secondary)" } },
          `${lane.state}${lane.sessionId === null ? "" : ` \xB7 ${String(lane.sessionId).slice(0, 8)}\u2026`}${lane.lastModel === null ? "" : ` \xB7 ${text.lastModel} ${lane.lastModel}`}`
        )
      ),
      h(
        "div",
        { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 } },
        h("span", { style: { flex: "0 0 52px", fontSize: 11, color: "var(--dsw-alias-label-secondary)", alignSelf: "center" } }, text.role),
        input("role", 160)
      ),
      h(
        "div",
        { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 } },
        h("span", { style: { flex: "0 0 52px", fontSize: 11, color: "var(--dsw-alias-label-secondary)", alignSelf: "center" } }, text.model),
        input("model", 120)
      ),
      h(
        "div",
        { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
        h("span", { style: { flex: "0 0 52px", fontSize: 11, color: "var(--dsw-alias-label-secondary)", alignSelf: "center" } }, text.effort),
        input("effort", 60),
        h("span", { style: { flex: "0 0 auto", fontSize: 11, color: "var(--dsw-alias-label-secondary)", alignSelf: "center" } }, text.speed),
        input("speed", 60),
        h("button", {
          type: "button",
          disabled: state.busy,
          onClick: () => {
            void send({ action: "set", lane: lane.id, role: edit.role, model: edit.model, effort: edit.effort, speed: edit.speed });
          },
          style: buttonStyle("var(--dsw-alias-brand-primary)")
        }, text.save),
        h("button", {
          type: "button",
          disabled: state.busy,
          onClick: () => {
            void send({ action: "set", lane: lane.id, clear: true });
          },
          style: buttonStyle("var(--dsw-alias-label-secondary)")
        }, text.clear),
        h("button", {
          type: "button",
          disabled: state.busy,
          onClick: () => {
            void send({ action: "remove", lane: lane.id });
          },
          style: buttonStyle("var(--dsw-alias-state-error-primary)")
        }, text.remove)
      )
    ));
  }
  blocks.push(h(
    "div",
    { key: "add", style: Object.assign({}, box, { marginBottom: 10 }) },
    h("div", { style: { fontWeight: 600, marginBottom: 6 } }, text.addLane),
    h(
      "div",
      { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
      h("input", {
        value: newLaneId,
        onChange: (event) => setNewLane((previous) => ({ ...previous, lane: event.target.value })),
        placeholder: "lane id (e.g. review)",
        style: Object.assign({}, mono, { flex: "1 1 140px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, padding: "3px 6px" })
      }),
      h("select", {
        value: newLaneWorker,
        onChange: (event) => setNewLane((previous) => ({ ...previous, worker: event.target.value })),
        style: Object.assign({}, mono, { flex: "0 1 140px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, padding: "3px 6px" })
      }, [h("option", { key: "", value: "" }, text.product), ...productIds.map((id) => h("option", { key: id, value: id }, id))]),
      h("button", {
        type: "button",
        disabled: state.busy || newLaneId.length === 0 || newLaneWorker.length === 0,
        onClick: () => {
          void send({ action: "add", lane: newLaneId.toLowerCase(), worker: newLaneWorker });
          setNewLane({ lane: "", worker: "" });
        },
        style: buttonStyle("var(--dsw-alias-brand-primary)")
      }, text.create)
    )
  ));
  blocks.push(h(
    "div",
    { key: "where", style: Object.assign({}, box, { fontSize: 11, color: "var(--dsw-alias-label-secondary)" }) },
    h("div", null, `${text.product}: ${(payload.products ?? []).map((product) => `${product.id}${product.builtIn === true ? "" : " (custom)"}`).join(" \xB7 ")}`),
    h("div", { style: mono }, `${text.configFile}: ${payload.configPath}`),
    h("div", { style: mono }, `${text.workspace}: ${payload.workspaceRoot}`),
    h("div", null, text.settingsHint)
  ));
  return h("div", { style: { padding: "4px 2px", fontSize: 12, display: "flex", flexDirection: "column" } }, blocks);
}
function buttonStyle(color) {
  return {
    cursor: "pointer",
    border: `1px solid ${color}`,
    background: "transparent",
    color,
    borderRadius: 6,
    padding: "2px 10px",
    fontSize: 11,
    flex: "0 0 auto"
  };
}
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === void 0) return;
  slots.inject("conversation.input.dock", () => slots.register(
    { name: "conversation.input.dock", id: "external-workers", order: 30, label: "External workers" },
    () => h(DockRow, null)
  ));
  slots.inject("shell.overlay", () => slots.register(
    { name: "shell.overlay", id: "external-workers-drawer", order: 30, label: "External worker details" },
    () => h("div", { style: { pointerEvents: "none" } }, h(Drawer, null))
  ));
  slots.inject("settings.section", () => slots.register(
    { name: "settings.section", id: "external-workers", order: 30, label: () => pickText().settingsTitle },
    () => h(SettingsPage, null)
  ));
}

    return module.exports;
  }
});
