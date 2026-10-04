import * as React from 'react';

/**
 * Client half of dsh-external-workers.
 *
 * Two seats, one shared piece of UI state:
 *   - `conversation.input.dock` — a single-line summary above the composer. It
 *     never wraps and never grows, so it can never push the composer around.
 *   - `shell.overlay` — the detail drawer: Lanes / Jobs tabs, a per-job full
 *     view, its own scroll container, and three ways to close it.
 *
 * The dock row renders nothing while the ledger is empty, so a session that
 * never delegates keeps a completely untouched composer.
 *
 * Data comes from the host half's two read-only routes
 * (`GET /api/external-workers/jobs` and `.../job?id=`): plain GETs, no
 * descriptor generation, and they can never mutate anything.
 *
 * @module dsh-external-workers/client
 */

export const name = 'external-workers-panel';
export const inject = ['slots'];

const h = React.createElement;
const POLL_MS = 6000;

const COLORS = {
  running: 'var(--dsw-alias-brand-primary)',
  queued: 'var(--dsw-alias-label-secondary)',
  completed: 'var(--dsw-alias-state-success-primary)',
  failed: 'var(--dsw-alias-state-error-primary)',
  blocked: 'var(--dsw-alias-state-warn-primary)',
  retryable: 'var(--dsw-alias-state-warn-primary)',
  canceled: 'var(--dsw-alias-label-secondary)',
};

const TEXT = {
  zh: {
    title: '外部 worker', detail: '详情', close: '关闭', back: '返回',
    tabLanes: '泳道', tabJobs: '作业',
    running: '运行中', queued: '排队', completed: '完成', failed: '失败', blocked: '受阻', retryable: '可重试', canceled: '已取消',
    lane: '泳道', role: '分工', model: '请求模型', actual: '实际跑的', state: '状态', session: '会话', cwd: '工作目录', jobsOf: '个作业', lastModel: '上次实际用的',
    quota: '额度', quotaNotReported: '该产品不上报额度', quotaCredits: '将用 credits', creditsSpent: '⚠️ 这次花了 credits',
    denials: '⚠️ 被拒绝的工具调用', denialsHint: '它想做的事被权限挡了 —— 结果可能是绕过去的替代品，不是真东西。',
    settingsTitle: '外部 worker', warnAt: '预警阈值', product: '产品', save: '保存', clear: '清空', remove: '删除',
    addLane: '新建泳道', create: '创建', configFile: '配置文件', workspace: '工作目录',
    settingsHint: '改了立刻生效，不用重启；新建的泳道下一次派活就会开自己的会话。',
    tabConversation: '对话', conversation: '对话', turns: '轮', you: '你', worker: 'worker', tool: '工具',
    thinking: '思考', toolResult: '结果', noTurns: '这条会话还没有内容。', noSession: '(还没有会话)',
    cannotRead: '这个产品的会话记录现在还读不出来：', working: '正在跑', send: '发送', sending: '发送中…',
    sayPlaceholder: '直接跟这个 worker 说 —— 会进它自己的会话，它记得之前的事',
    sendHint: '一轮一条消息，进的是同一条会话；产出会在上面出现',
    continueAnyway: '我确认，继续', spendCredits: '我确认，用 credits', newSession: '开新会话（不续接）',
    defaultModel: '(产品默认)', noRole: '(未分工)', none: '无',
    task: '任务', artifacts: '产物', error: '错误', stderr: 'stderr 尾部', result: '完整结果', paths: '文件位置',
    attempts: '执行', exitCode: '退出码', all: '全部', viewJobs: '看它的作业', empty: '还没有作业。',
    loading: '读取中…', feedError: '取数据失败', continues: '续接自', openHint: '点任意一行看完整内容 · Esc 或右上角关闭',
  },
  en: {
    title: 'External workers', detail: 'details', close: 'close', back: 'back',
    tabLanes: 'Lanes', tabJobs: 'Jobs',
    running: 'running', queued: 'queued', completed: 'done', failed: 'failed', blocked: 'blocked', retryable: 'retryable', canceled: 'canceled',
    lane: 'lane', role: 'role', model: 'requested', actual: 'ran on', state: 'state', session: 'session', cwd: 'working dir', jobsOf: 'jobs', lastModel: 'last ran on',
    quota: 'quota', quotaNotReported: 'not reported by this product', quotaCredits: 'will spend credits', creditsSpent: '⚠️ this run spent credits',
    denials: '⚠️ refused tool calls', denialsHint: 'It tried to do something and permission blocked it — the result may be a workaround, not the real thing.',
    settingsTitle: 'External workers', warnAt: 'warn at', product: 'product', save: 'save', clear: 'clear', remove: 'remove',
    addLane: 'Add a lane', create: 'create', configFile: 'config file', workspace: 'workspace',
    settingsHint: 'Changes apply immediately, no restart. A new lane opens its own session on its first delegation.',
    tabConversation: 'Conversation', conversation: 'Conversation', turns: 'turns', you: 'you', worker: 'worker', tool: 'tool',
    thinking: 'thinking', toolResult: 'result', noTurns: 'Nothing in this session yet.', noSession: '(no session yet)',
    cannotRead: 'This product’s conversation cannot be read yet:', working: 'working', send: 'send', sending: 'sending…',
    sayPlaceholder: 'Say something to this worker — it goes into its own session, and it remembers',
    sendHint: 'one message per turn, into the same session; what it produces appears above',
    continueAnyway: 'continue anyway', spendCredits: 'spend credits', newSession: 'new session (do not continue)',
    defaultModel: '(product default)', noRole: '(no role)', none: 'none',
    task: 'task', artifacts: 'artifacts', error: 'error', stderr: 'stderr tail', result: 'full result', paths: 'files',
    attempts: 'attempts', exitCode: 'exit code', all: 'all', viewJobs: 'view its jobs', empty: 'No jobs yet.',
    loading: 'loading…', feedError: 'feed failed', continues: 'continues', openHint: 'click any row for the full content · Esc or the ✕ closes this',
  },
};

function pickText() {
  try {
    const language = typeof navigator !== 'undefined' && navigator.language ? String(navigator.language) : 'en';
    return /^zh/i.test(language) ? TEXT.zh : TEXT.en;
  } catch {
    return TEXT.en;
  }
}

// ── shared UI state (one page, one plugin instance) ────────────────────────
const ui = {
  open: false,
  tab: 'lanes',
  jobId: null,
  laneFilter: null,
  // the conversation tab: which lane, the draft, and whether a message is in flight
  conversationLane: null,
  draft: '',
  newSession: false,
  sending: false,
  gate: null,
};
const watchers = new Set();

function patchUi(next) {
  Object.assign(ui, next);
  for (const watcher of [...watchers]) {
    try { watcher(); } catch { /* ignore a broken watcher */ }
  }
}

function useUi() {
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    const watcher = () => bump((value) => value + 1);
    watchers.add(watcher);
    return () => { watchers.delete(watcher); };
  }, []);
  return ui;
}

// ── helpers ───────────────────────────────────────────────────────────────
function label(text, status) {
  return text[status] !== undefined ? text[status] : status;
}

function clock(ms) {
  if (typeof ms !== 'number' || ms <= 0) return '';
  try {
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return '';
  }
}

function duration(job) {
  const from = typeof job.startedAt === 'number' ? job.startedAt : job.createdAt;
  const to = typeof job.finishedAt === 'number' ? job.finishedAt : Date.now();
  if (typeof from !== 'number' || typeof to !== 'number') return '';
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

/** "gpt-6.1-sol (high)" — prefer the model the product says it actually ran. */
function modelChip(job) {
  const name = typeof job.actualModel === 'string' && job.actualModel.length > 0 ? job.actualModel : job.model;
  if (typeof name !== 'string' || name.length === 0) return null;
  const effort = typeof job.effort === 'string' && job.effort.length > 0 ? ` (${job.effort})` : '';
  return `${name}${effort}`;
}

function dot(color, size) {
  const px = size === undefined ? 7 : size;
  return h('span', {
    style: { display: 'inline-block', width: px, height: px, borderRadius: '50%', background: color, flex: '0 0 auto' },
  });
}

async function getJson(url) {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable');
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (response.ok !== true || body === null) {
    throw new Error(body && body.error ? String(body.error) : `HTTP ${response.status}`);
  }
  return body;
}

// ── feeds ─────────────────────────────────────────────────────────────────
function useFeed() {
  const [payload, setPayload] = React.useState(null);
  const [failure, setFailure] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await getJson('/api/external-workers/jobs');
        if (!alive) return;
        if (next && next.ok === true) { setPayload(next); setFailure(null); }
      } catch (error) {
        if (alive) setFailure(String((error && error.message) || error));
      }
    };
    void load();
    let timer = null;
    try { timer = setInterval(() => { void load(); }, POLL_MS); } catch { timer = null; }
    return () => {
      alive = false;
      if (timer !== null) { try { clearInterval(timer); } catch { /* ignore */ } }
    };
  }, []);

  return { payload, failure };
}

function useJobDetail(jobId) {
  const [detail, setDetail] = React.useState(null);
  const [failure, setFailure] = React.useState(null);

  React.useEffect(() => {
    if (jobId === null || jobId === undefined) { setDetail(null); setFailure(null); return undefined; }
    let alive = true;
    setDetail(null);
    setFailure(null);
    void (async () => {
      try {
        const next = await getJson(`/api/external-workers/job?id=${encodeURIComponent(jobId)}`);
        if (alive) setDetail(next);
      } catch (error) {
        if (alive) setFailure(String((error && error.message) || error));
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  return { detail, failure };
}

// ── dock row (never wraps, never grows) ───────────────────────────────────
function summarize(text, counts) {
  const active = (counts.running || 0) + (counts.queued || 0);
  const parts = [h('span', {
    key: 'badge',
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  }, dot(active > 0 ? COLORS.running : 'var(--dsw-alias-label-secondary)'), text.title)];
  for (const key of ['running', 'queued', 'completed', 'failed', 'blocked', 'retryable']) {
    const value = counts[key] || 0;
    if (value === 0) continue;
    parts.push(h('span', {
      key,
      style: { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--dsw-alias-label-secondary)' },
    }, dot(COLORS[key], 6), `${value} ${label(text, key)}`));
  }
  return parts;
}

/**
 * The single-line row above the composer.
 *
 * The open button deliberately sits **right after the counts** instead of being
 * pushed to the far right: this row is shared with other plugins' dock rows, and
 * a control pinned to the right edge can end up underneath whatever else claims
 * that corner. Keeping it next to its own numbers also makes it obvious which
 * row it belongs to.
 */
function DockRow() {
  const text = pickText();
  const { payload } = useFeed();
  const state = useUi();
  const total = payload && typeof payload.total === 'number' ? payload.total : 0;
  if (total === 0 && state.open !== true) return null;
  const counts = (payload && payload.counts) || {};

  return h('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      flexWrap: 'nowrap',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      borderRadius: 8,
      padding: '4px 10px',
      fontSize: 12,
      lineHeight: '20px',
      marginBottom: 6,
      minWidth: 0,
    },
  },
    // `0 1 auto`, not `1 1 auto`: the group sizes to its own content so the
    // button lands beside it. It can still shrink, which is what keeps the row
    // on one line when the numbers get long.
    h('div', {
      style: { display: 'flex', alignItems: 'center', gap: 14, flex: '0 1 auto', minWidth: 0, overflow: 'hidden' },
    }, summarize(text, counts), h('span', { key: 'total', style: { color: 'var(--dsw-alias-label-secondary)' } }, `· ${total}`)),
    h('button', {
      type: 'button',
      onClick: () => patchUi({ open: state.open !== true }),
      style: {
        flex: '0 0 auto',
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        padding: '2px 10px',
        fontSize: 12,
      },
    }, text.detail),
  );
}

// ── drawer pieces ─────────────────────────────────────────────────────────
const box = {
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-2)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 12,
  lineHeight: 1.5,
};

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, overflowWrap: 'anywhere' };

function field(text, key, value) {
  if (value === null || value === undefined || value === '' || value === false) return null;
  return h('div', { key, style: { display: 'flex', gap: 8, minWidth: 0 } },
    h('span', { style: { flex: '0 0 82px', color: 'var(--dsw-alias-label-secondary)' } }, text[key] !== undefined ? text[key] : key),
    h('span', { style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-primary)' } }, String(value)));
}

function pre(body, key) {
  if (typeof body !== 'string' || body.length === 0) return null;
  return h('pre', {
    key,
    style: {
      margin: '6px 0 0',
      padding: 8,
      maxHeight: 420,
      overflow: 'auto',
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 6,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 11,
      lineHeight: 1.5,
    },
  }, body);
}

/**
 * One card per lane. A lane is a product + a model + a role, and it owns its
 * OWN persistent session and its OWN working directory — which is the whole
 * point: two lanes of the same product (two gpt lanes on different models)
 * must never share a session, or the two jobs pollute each other's context.
 * So session, model and directory are shown per lane, never per product.
 */
function LanesTab(text, payload, state) {
  const lanes = Array.isArray(payload.lanes) ? payload.lanes : [];
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const blocks = [];
  for (const lane of lanes) {
    const own = jobs.filter((job) => (job.lane || job.worker) === lane.id);
    const active = own.filter((job) => job.status === 'running' || job.status === 'queued').length;
    const model = [lane.model || text.defaultModel, lane.effort ? `effort ${lane.effort}` : null, lane.speed ? `speed ${lane.speed}` : null]
      .filter((part) => part !== null).join(' · ');
    blocks.push(h('div', { key: lane.id, style: Object.assign({}, box, { marginBottom: 8 }) },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
        dot(active > 0 ? COLORS.running : 'var(--dsw-alias-label-secondary)'),
        h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, lane.id),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, lane.worker),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `${own.length} ${text.jobsOf}`),
        h('button', {
          type: 'button',
          onClick: () => patchUi({ tab: 'jobs', laneFilter: lane.id, jobId: null }),
          style: { marginLeft: 'auto', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', borderRadius: 6, padding: '1px 8px', fontSize: 11 },
        }, text.viewJobs)),
      field(text, 'role', lane.role || text.noRole),
      field(text, 'model', model),
      field(text, 'lastModel', lane.lastModel || null),
      field(text, 'state', lane.state),
      field(text, 'session', lane.sessionId),
      h('div', { key: 'cwd', style: { display: 'flex', gap: 8 } },
        h('span', { style: { flex: '0 0 82px', color: 'var(--dsw-alias-label-secondary)' } }, text.cwd),
        h('span', { style: Object.assign({}, mono, { flex: '1 1 auto', color: 'var(--dsw-alias-label-primary)' }) }, `~/.dsh/workers/${lane.id}`)),
    ));
  }
  if (blocks.length === 0) blocks.push(h('div', { key: 'none', style: { color: 'var(--dsw-alias-label-secondary)' } }, text.empty));
  return blocks;
}

function JobsTab(text, payload, state) {
  const all = Array.isArray(payload.jobs) ? payload.jobs : [];
  const filter = state.laneFilter;
  const jobs = filter === null ? all : all.filter((job) => (job.lane || job.worker) === filter);

  const chips = [];
  const names = [...new Set(all.map((job) => job.lane || job.worker))];
  for (const name of [null].concat(names)) {
    const active = name === filter;
    chips.push(h('button', {
      key: name === null ? '__all__' : name,
      type: 'button',
      onClick: () => patchUi({ laneFilter: name, jobId: null }),
      style: {
        cursor: 'pointer',
        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
        background: 'transparent',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        borderRadius: 999,
        padding: '1px 10px',
        fontSize: 11,
      },
    }, name === null ? text.all : name));
  }

  const order = { running: 0, queued: 1, retryable: 2, blocked: 3, failed: 4, completed: 5, canceled: 6 };
  const rows = [];
  for (const job of jobs.slice().sort((a, b) => {
    const delta = (order[a.status] !== undefined ? order[a.status] : 9) - (order[b.status] !== undefined ? order[b.status] : 9);
    return delta !== 0 ? delta : (b.createdAt || 0) - (a.createdAt || 0);
  })) {
    rows.push(h('button', {
      key: job.id,
      type: 'button',
      onClick: () => patchUi({ tab: 'jobs', jobId: job.id }),
      style: {
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'inherit',
        borderRadius: 8,
        padding: '7px 10px',
        marginBottom: 6,
        fontSize: 12,
        lineHeight: 1.45,
      },
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        dot(COLORS[job.status] !== undefined ? COLORS[job.status] : 'var(--dsw-alias-label-secondary)'),
        h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, job.worker),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '0 6px' } }, job.lane || job.worker),
        h('span', { style: { color: COLORS[job.status] !== undefined ? COLORS[job.status] : 'inherit' } }, label(text, job.status)),
        modelChip(job) === null ? null : h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, modelChip(job)),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, `#${job.id} · ${duration(job)}${Array.isArray(job.artifacts) && job.artifacts.length > 0 ? ` · ${job.artifacts.length} ${text.artifacts}` : ''}`),
      ),
      h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: 2, overflowWrap: 'anywhere' } }, job.task),
      job.lastError ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', marginTop: 2, overflowWrap: 'anywhere' } }, job.lastError) : null,
    ));
  }
  if (rows.length === 0) rows.push(h('div', { key: 'none', style: { color: 'var(--dsw-alias-label-secondary)' } }, text.empty));

  return [h('div', { key: 'chips', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } }, chips)].concat(rows);
}

/**
 * A REAL component, because it calls hooks: it must own its own hook slots.
 * Calling it as a plain function from Drawer's body added hooks to Drawer's list
 * on the render where a job was selected, React rejected that (hook order
 * changed) and tore the subtree down — which is what made the drawer impossible
 * to reopen until the page was reloaded.
 */
function JobDetail(props) {
  const text = props.text;
  const jobId = props.jobId;
  const { detail, failure } = useJobDetail(jobId);
  if (failure !== null && failure !== undefined) {
    return h('div', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, failure);
  }
  if (detail === null || detail.job === undefined) {
    return h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, text.loading);
  }
  const job = detail.job;
  const blocks = [
    h('div', { key: 'head', style: Object.assign({}, box, { marginBottom: 8 }) },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
        dot(COLORS[job.status] !== undefined ? COLORS[job.status] : 'var(--dsw-alias-label-secondary)'),
        h('strong', null, `${job.worker} · #${job.id}`),
        h('span', { style: { color: COLORS[job.status] !== undefined ? COLORS[job.status] : 'inherit' } }, label(text, job.status)),
        job.retryable ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, `(${text.retryable})`) : null,
      ),
      field(text, 'task', job.task),
      field(text, 'lane', job.lane || job.worker),
      field(text, 'session', job.sessionId),
      field(text, 'model', [job.model || text.defaultModel, job.effort ? `effort ${job.effort}` : null, job.speed ? `speed ${job.speed}` : null].filter((part) => part !== null).join(' · ')),
      field(text, 'actual', job.actualModel || null),
      Number.isFinite(job.creditsSpent) ? field(text, 'creditsSpent', `$${Number(job.creditsSpent).toFixed(4)}`) : null,
      field(text, 'state', [clock(job.createdAt), clock(job.finishedAt)].filter((part) => part.length > 0).join('  →  ')),
      field(text, 'attempts', `${job.attempts}${job.exitCode === null || job.exitCode === undefined ? '' : ` · ${text.exitCode} ${job.exitCode}`}`),
      field(text, 'cwd', job.cwd),
      job.parentJobId ? field(text, 'continues', job.parentJobId) : null,
    ),
  ];
  if (Array.isArray(job.denials) && job.denials.length > 0) {
    blocks.push(h('div', { key: 'denials', style: Object.assign({}, box, { marginBottom: 8, borderColor: 'var(--dsw-alias-state-warn-primary)' }) },
      h('div', { style: { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 } }, `${text.denials} (${job.denials.length})`),
      h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, text.denialsHint),
      ...job.denials.map((item, index) => pre(item, `d${index}`))));
  }
  if (job.lastError) {
    blocks.push(h('div', { key: 'error', style: Object.assign({}, box, { marginBottom: 8, borderColor: 'var(--dsw-alias-state-error-primary)' }) },
      h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600 } }, `${text.error}${job.failureKind ? ` (${job.failureKind})` : ''}`),
      pre(job.lastError, 'e')));
  }
  if (Array.isArray(job.artifacts) && job.artifacts.length > 0) {
    blocks.push(h('div', { key: 'artifacts', style: Object.assign({}, box, { marginBottom: 8 }) },
      h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, text.artifacts),
      ...job.artifacts.map((artifact, index) => h('div', { key: `a${index}`, style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-secondary)' }) }, artifact))));
  }
  if (typeof job.resultText === 'string' && job.resultText.length > 0) {
    blocks.push(h('div', { key: 'result', style: Object.assign({}, box, { marginBottom: 8 }) },
      h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, `${text.result} (${job.resultText.length})`),
      pre(job.resultText, 'r')));
  }
  if (typeof job.stderrTail === 'string' && job.stderrTail.length > 0) {
    blocks.push(h('div', { key: 'stderr', style: Object.assign({}, box, { marginBottom: 8 }) },
      h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, text.stderr),
      pre(job.stderrTail, 's')));
  }
  blocks.push(h('div', { key: 'paths', style: Object.assign({}, box) },
    h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 } }, text.paths),
    ...['packetPath', 'stdoutPath', 'stderrPath', 'jobDir']
      .filter((key) => typeof job[key] === 'string' && job[key].length > 0)
      .map((key) => h('div', { key, style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-secondary)' }) }, job[key]))));
  return h('div', { key: 'jobdetail' }, blocks);
}

/**
 * Plan quota, one line per product that reports it. A product that does not
 * report quota says so instead of showing a fake 0%.
 *
 * Colours follow the configured threshold rather than a fixed 90: the number
 * that matters is the one the user chose to be warned at.
 */
function QuotaStrip(text, payload) {
  const entries = Array.isArray(payload.quota) ? payload.quota : [];
  if (entries.length === 0) return null;
  const threshold = typeof payload.threshold === 'number' ? payload.threshold : 90;
  const rows = [];
  for (const entry of entries) {
    if (entry.readable !== true) {
      rows.push(h('div', { key: entry.product, style: { display: 'flex', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } },
        h('span', { style: { fontWeight: 600, minWidth: 62 } }, entry.product),
        h('span', null, text.quotaNotReported)));
      continue;
    }
    const worst = [entry.short, entry.long].filter((item) => item !== null && item !== undefined)
      .reduce((max, item) => Math.max(max, item.usedPercent), 0);
    const color = entry.willUseCredits === true
      ? 'var(--dsw-alias-state-error-primary)'
      : worst >= threshold ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)';
    rows.push(h('div', { key: entry.product, style: { display: 'flex', gap: 8, fontSize: 11, alignItems: 'baseline' } },
      h('span', { style: { fontWeight: 600, minWidth: 62, color: 'var(--dsw-alias-label-primary)' } }, entry.product),
      h('span', { style: { color } }, entry.text),
      entry.willUseCredits === true
        ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600 } }, text.quotaCredits)
        : null));
  }
  return h('div', { key: 'quota', style: Object.assign({}, box, { marginBottom: 8 }) },
    h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 } }, text.quota),
    ...rows);
}

// ── the conversation ──────────────────────────────────────────────────────
/**
 * The worker's own conversation, so a person can see the working and not just
 * the result — and can say something back into that same session.
 *
 * The composer sends a message as a normal job (the host route runs the same
 * quota gate the tools do), so "talk to the worker" can never become a way to
 * spend credits without the approval that path requires.
 */
function useConversation(laneId) {
  const [state, setState] = React.useState({ data: null, failure: null });
  React.useEffect(() => {
    if (laneId === null || laneId === undefined) { setState({ data: null, failure: null }); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const next = await getJson(`/api/external-workers/conversation?lane=${encodeURIComponent(laneId)}&limit=120`);
        if (alive) setState({ data: next, failure: null });
      } catch (error) {
        if (alive) setState((previous) => ({ data: previous.data, failure: String((error && error.message) || error) }));
      }
    };
    void load();
    let timer = null;
    try { timer = setInterval(() => { void load(); }, 5000); } catch { timer = null; }
    return () => {
      alive = false;
      if (timer !== null) { try { clearInterval(timer); } catch { /* ignore */ } }
    };
  }, [laneId]);
  return state;
}

/** One turn. `<details>` gives collapsing with no React state to get wrong. */
function Turn(text, turn, index) {
  const role = turn.role === 'user' ? text.you : turn.workerLabel === true ? turn.workerLabelText : text.worker;
  const who = turn.kind === 'tool' ? `${role} · ${turn.name}` : role;
  const color = turn.role === 'user' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)';
  if (turn.kind === 'tool') {
    return h('div', { key: index, style: { display: 'flex', gap: 8, fontSize: 11, padding: '1px 0' } },
      h('span', { style: { flex: '0 0 96px', color, textAlign: 'right' } }, text.tool),
      h('span', { style: Object.assign({}, mono, { flex: '1 1 auto', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }) }, `${turn.name} ${turn.detail || ''}`.trim()));
  }
  if (turn.kind === 'result' || turn.kind === 'reasoning') {
    const label = turn.kind === 'reasoning' ? text.thinking : text.toolResult;
    return h('details', { key: index, style: { fontSize: 11, padding: '1px 0' } },
      h('summary', { style: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' } }, `${label} · ${String(turn.text || '').slice(0, 70)}`),
      h('pre', { style: { margin: '4px 0 4px 12px', padding: 6, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, turn.text));
  }
  return h('div', { key: index, style: { display: 'flex', gap: 8, padding: '2px 0' } },
    h('span', { style: { flex: '0 0 96px', color, textAlign: 'right', fontSize: 11 } }, who),
    h('span', { style: { flex: '1 1 auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-primary)' } }, turn.text));
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

function ConversationTab(text, payload, state, conversation) {
  const lanes = Array.isArray(payload.lanes) ? payload.lanes : [];
  const selected = state.conversationLane === null || state.conversationLane === undefined
    ? (lanes[0] === undefined ? null : lanes[0].id)
    : state.conversationLane;
  const chips = lanes.map((lane) => {
    const active = lane.id === selected;
    return h('button', {
      key: lane.id,
      type: 'button',
      onClick: () => patchUi({ conversationLane: lane.id, draft: '', gate: null }),
      style: {
        cursor: 'pointer',
        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
        background: 'transparent',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        borderRadius: 999,
        padding: '1px 10px',
        fontSize: 11,
      },
    }, `${lane.id} · ${lane.worker}`);
  });

  const blocks = [h('div', { key: 'chips', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } }, chips)];
  if (selected === null) {
    blocks.push(h('div', { key: 'none', style: { color: 'var(--dsw-alias-label-secondary)' } }, text.empty));
    return blocks;
  }

  const data = conversation === null || conversation === undefined ? null : conversation.data;
  const convFailure = conversation === null || conversation === undefined ? null : conversation.failure;
  if (convFailure !== null && convFailure !== undefined) {
    blocks.push(h('div', { key: 'feed', style: { color: 'var(--dsw-alias-state-warn-primary)', marginBottom: 8 } }, `${text.feedError}: ${convFailure}`));
  }
  if (data === null || data === undefined || data.lane === undefined) {
    blocks.push(h('div', { key: 'loading', style: { color: 'var(--dsw-alias-label-secondary)' } }, text.loading));
    return blocks;
  }

  const lane = data.lane;
  blocks.push(h('div', { key: 'head', style: Object.assign({}, box, { marginBottom: 8, fontSize: 11 }) },
    h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
      h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } }, `${lane.id} · ${lane.worker}`),
      h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, lane.model === null ? text.defaultModel : `${lane.model}${lane.model_actual === null ? '' : ` → ${lane.model_actual}`}`),
      h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, lane.sessionId === null ? text.noSession : `${text.session} ${String(lane.sessionId).slice(0, 8)}…`),
      h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, lane.state)),
    h('div', { style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }) }, lane.cwd)));

  if (data.running !== null && data.running !== undefined) {
    blocks.push(h('div', { key: 'running', style: Object.assign({}, box, { marginBottom: 8, borderColor: 'var(--dsw-alias-brand-primary)' }) },
      h('div', { style: { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600, marginBottom: 4 } }, `${text.working} · ${data.running.id}`),
      h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, data.running.task)));
  }

  if (data.supported !== true) {
    blocks.push(h('div', { key: 'unsupported', style: Object.assign({}, box, { marginBottom: 8, color: 'var(--dsw-alias-state-warn-primary)' }) },
      text.cannotRead, h('div', { style: { marginTop: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, String(data.reason ?? ''))));
  } else if (data.turns.length === 0) {
    blocks.push(h('div', { key: 'empty', style: { color: 'var(--dsw-alias-label-secondary)' } }, text.noTurns));
  }

  blocks.push(h('div', { key: 'turns', style: Object.assign({}, box, { marginBottom: 8 }) },
    h('div', { style: { fontWeight: 600, marginBottom: 6 } }, `${text.conversation} · ${data.total} ${text.turns}`),
    ...data.turns.map((turn, index) => Turn(text, turn, index))));

  // Artifacts, with pictures shown as pictures: judging a model or a screenshot
  // by reading a file path is not judging it.
  const jobBlocks = [];
  for (const job of data.jobs ?? []) {
    const files = Array.isArray(job.artifacts) ? job.artifacts : [];
    if (files.length === 0) continue;
    jobBlocks.push(h('div', { key: `j${job.id}`, style: { marginBottom: 6 } },
      h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 } }, `#${job.id} · ${job.status} · ${job.task}`),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        ...files.map((file) => {
          const url = `/api/external-workers/artifact?lane=${encodeURIComponent(lane.id)}&job=${encodeURIComponent(job.id)}&path=${encodeURIComponent(file)}`;
          const isImage = IMAGE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));
          if (isImage !== true) {
            return h('div', { key: file, style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-secondary)' }) }, file);
          }
          return h('a', { key: file, href: url, target: '_blank', rel: 'noreferrer', title: file, style: { display: 'block' } },
            h('img', { src: url, alt: file, loading: 'lazy', style: { maxWidth: 220, maxHeight: 160, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', display: 'block' } }));
        }))));
  }
  if (jobBlocks.length > 0) {
    blocks.push(h('div', { key: 'artifacts', style: Object.assign({}, box, { marginBottom: 8 }) },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } }, text.artifacts), ...jobBlocks));
  }

  // The composer: one message per turn, into the existing session unless asked
  // otherwise. Never a placeholder for "live chat" — each send is a real run.
  if (state.gate !== null && state.gate !== undefined) {
    const gate = state.gate;
    blocks.push(h('div', { key: 'gate', style: Object.assign({}, box, { marginBottom: 8, borderColor: 'var(--dsw-alias-state-warn-primary)', whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-state-warn-primary)' }) }, gate.text));
    if (gate.reason !== undefined && gate.reason !== null) {
      blocks.push(h('div', { key: 'gatebtn', style: { marginBottom: 8 } },
        h('button', {
          type: 'button',
          onClick: () => { void sendDraft(lane.id, gate.reason === 'credits' ? { allowCredits: true } : { allowQuota: true }); },
          style: buttonStyle('var(--dsw-alias-state-warn-primary)'),
        }, gate.reason === 'credits' ? text.spendCredits : text.continueAnyway)));
    }
  }

  blocks.push(h('div', { key: 'composer', style: Object.assign({}, box, { marginBottom: 8 }) },
    h('textarea', {
      value: state.draft ?? '',
      onChange: (event) => patchUi({ draft: event.target.value }),
      placeholder: text.sayPlaceholder,
      rows: 3,
      style: Object.assign({}, mono, { width: '100%', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: 6, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }),
    }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
        h('input', { type: 'checkbox', checked: state.newSession === true, onChange: () => patchUi({ newSession: state.newSession !== true }) }),
        text.newSession),
      h('button', {
        type: 'button',
        disabled: state.sending === true || String(state.draft ?? '').trim().length === 0,
        onClick: () => { void sendDraft(lane.id, {}); },
        style: Object.assign(buttonStyle('var(--dsw-alias-brand-primary)'), { marginLeft: 'auto' }),
      }, state.sending === true ? text.sending : text.send),
      h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, text.sendHint))));

  return blocks;
}

/** Send the composer's draft into a lane, and surface whatever comes back. */
async function sendDraft(laneId, approvals) {
  const message = String(ui.draft ?? '').trim();
  if (message.length === 0) return;
  patchUi({ sending: true, gate: null });
  try {
    const response = await fetch('/api/external-workers/say', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-external-workers': '1' },
      body: JSON.stringify({ lane: laneId, message, new_session: ui.newSession === true, ...approvals }),
    });
    const result = await response.json().catch(() => null);
    if (result !== null && result.blocked === true) {
      patchUi({ sending: false, gate: { text: result.error ?? '', reason: result.reason ?? null } });
      return;
    }
    if (response.ok !== true) throw new Error(result && result.error ? String(result.error) : `HTTP ${response.status}`);
    patchUi({ sending: false, draft: '', gate: null, note: `sent · ${result.jobId}` });
  } catch (error) {
    patchUi({ sending: false, gate: { text: `${text_of_error(error)}`, reason: null } });
  }
}

function text_of_error(error) {
  return String((error && error.message) || error);
}

function Drawer() {
  const text = pickText();
  const { payload, failure } = useFeed();
  const state = useUi();
  // Polled only while the conversation tab is the one on screen: the transcript
  // reads every product's private files, so it is not fetched for nothing.
  const lanes = payload !== null && Array.isArray(payload.lanes) ? payload.lanes : [];
  const conversationLane = state.tab === 'conversation' && state.open === true && state.jobId === null
    ? (state.conversationLane === null || state.conversationLane === undefined
      ? (lanes[0] === undefined ? null : lanes[0].id)
      : state.conversationLane)
    : null;
  const conversation = useConversation(conversationLane);

  React.useEffect(() => {
    if (state.open !== true) return undefined;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
    const onKey = (event) => { if (event && event.key === 'Escape') patchUi({ open: false }); };
    try {
      document.addEventListener('keydown', onKey);
      return () => { try { document.removeEventListener('keydown', onKey); } catch { /* ignore */ } };
    } catch {
      return undefined;
    }
  }, [state.open]);

  if (state.open !== true) return null;

  const body = [];
  if (failure !== null && failure !== undefined) {
    body.push(h('div', { key: 'feed', style: { color: 'var(--dsw-alias-state-warn-primary)', marginBottom: 8 } }, `${text.feedError}: ${failure}`));
  }
  if (payload === null) {
    body.push(h('div', { key: 'loading', style: { color: 'var(--dsw-alias-label-secondary)' } }, text.loading));
  } else if (state.jobId !== null) {
    body.push(h('button', {
      key: 'back',
      type: 'button',
      onClick: () => patchUi({ jobId: null }),
      style: { cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', borderRadius: 6, padding: '2px 10px', fontSize: 11, marginBottom: 10 },
    }, `← ${text.back}`));
    body.push(h(JobDetail, { key: 'job', text, jobId: state.jobId }));
  } else {
    // Quota sits above the tabs on purpose: "should I even start this?" is a
    // question about the whole product, not about one lane or one job.
    const strip = QuotaStrip(text, payload);
    if (strip !== null) body.push(strip);
    if (state.tab === 'lanes') {
      for (const block of LanesTab(text, payload, state)) body.push(block);
    } else if (state.tab === 'conversation') {
      for (const block of ConversationTab(text, payload, state, conversation)) body.push(block);
    } else {
      for (const block of JobsTab(text, payload, state)) body.push(block);
    }
  }

  const tabs = [['lanes', text.tabLanes], ['conversation', text.tabConversation], ['jobs', text.tabJobs]].map(([id, caption]) => h('button', {
    key: id,
    type: 'button',
    onClick: () => patchUi({ tab: id, jobId: null }),
    style: {
      cursor: 'pointer',
      border: 'none',
      borderBottom: `2px solid ${state.tab === id && state.jobId === null ? 'var(--dsw-alias-brand-primary)' : 'transparent'}`,
      background: 'transparent',
      color: state.tab === id && state.jobId === null ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
      padding: '4px 2px',
      fontSize: 12,
      fontWeight: 600,
    },
  }, caption));

  return h('div', {
    style: {
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: 'min(620px, 94vw)',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--dsw-alias-bg-overlay)',
      borderLeft: '1px solid var(--dsw-alias-border-l2)',
      boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.28)',
      pointerEvents: 'auto',
      zIndex: 40,
    },
  },
    h('div', {
      style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
    },
      h('strong', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 13 } }, text.title),
      h('div', { style: { display: 'flex', gap: 14 } }, tabs),
      h('button', {
        type: 'button',
        onClick: () => patchUi({ open: false }),
        style: { marginLeft: 'auto', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', borderRadius: 6, padding: '2px 10px', fontSize: 12 },
      }, `✕ ${text.close}`),
    ),
    h('div', {
      style: { flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden', padding: '12px 14px', minHeight: 0 },
    }, body),
    h('div', {
      style: { flex: '0 0 auto', padding: '6px 14px', borderTop: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
    }, text.openHint),
  );
}

// ── settings page ─────────────────────────────────────────────────────────
/**
 * The External workers settings section.
 *
 * It edits the SAME lanes the `worker_config` tool edits — the route it posts to
 * runs the same host functions, so the page and the model can never disagree
 * about what a lane is. It is a page rather than a preference row because a
 * roster needs room: one block per lane, plus the products and their quota.
 */
function SettingsPage(props) {
  const text = pickText();
  const [state, setState] = React.useState({ payload: null, failure: null, busy: false, note: null });
  const [draft, setDraft] = React.useState({});
  const [newLane, setNewLane] = React.useState({ lane: '', worker: '' });

  const load = React.useCallback(async () => {
    try {
      const next = await getJson('/api/external-workers/settings');
      setState((previous) => ({ ...previous, payload: next, failure: null }));
    } catch (error) {
      setState((previous) => ({ ...previous, failure: String((error && error.message) || error) }));
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const send = React.useCallback(async (body) => {
    setState((previous) => ({ ...previous, busy: true, note: null }));
    try {
      const response = await fetch('/api/external-workers/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-external-workers': '1' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (response.ok !== true) throw new Error(result && result.error ? String(result.error) : `HTTP ${response.status}`);
      setState((previous) => ({ ...previous, payload: result, busy: false, note: result.message ?? 'saved', failure: null }));
    } catch (error) {
      setState((previous) => ({ ...previous, busy: false, failure: String((error && error.message) || error) }));
    }
  }, []);

  if (state.payload === null || state.payload === undefined) {
    return h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, state.failure === null ? text.loading : `${text.feedError}: ${state.failure}`);
  }

  const payload = state.payload;
  const newLaneId = (newLane.lane ?? '').trim();
  const newLaneWorker = newLane.worker ?? '';
  const productIds = (payload.products ?? []).map((product) => product.id);
  const blocks = [];

  if (state.failure !== null) {
    blocks.push(h('div', { key: 'err', style: Object.assign({}, box, { marginBottom: 10, borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' }) }, state.failure));
  }
  if (state.note !== null) {
    blocks.push(h('div', { key: 'note', style: Object.assign({}, box, { marginBottom: 10, color: 'var(--dsw-alias-state-success-primary)' }) }, state.note));
  }

  // quota first: it is the one number that decides whether work should start
  const quotaRows = (payload.quota ?? []).map((entry) => h('div', { key: entry.product, style: { display: 'flex', gap: 8, fontSize: 12 } },
    h('span', { style: { minWidth: 74, fontWeight: 600 } }, entry.product),
    h('span', { style: { color: entry.willUseCredits === true ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' } }, entry.readable === true ? entry.text : text.quotaNotReported)));
  blocks.push(h('div', { key: 'quota', style: Object.assign({}, box, { marginBottom: 10 }) },
    h('div', { style: { fontWeight: 600, marginBottom: 6 } }, `${text.quota} · ${text.warnAt} ${payload.quotaWarnAtPercent}%`),
    ...quotaRows));

  for (const lane of payload.lanes) {
    const edit = draft[lane.id] ?? { role: lane.role ?? '', model: lane.model ?? '', effort: lane.effort ?? '', speed: lane.speed ?? '' };
    const setField = (field) => (event) => setDraft((previous) => ({ ...previous, [lane.id]: { ...edit, [field]: event.target.value } }));
    const input = (field, width) => h('input', {
      value: edit[field],
      onChange: setField(field),
      placeholder: field === 'role' ? text.noRole : text.defaultModel,
      style: Object.assign({}, mono, { flex: '1 1 auto', minWidth: width, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '3px 6px' }),
    });
    blocks.push(h('div', { key: lane.id, style: Object.assign({}, box, { marginBottom: 8 }) },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
        h('strong', { style: { fontSize: 13 } }, lane.id),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, lane.worker),
        h('span', { style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-secondary)' }) }, `~/.dsh/workers/${lane.id}`),
        h('span', { style: { marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          `${lane.state}${lane.sessionId === null ? '' : ` · ${String(lane.sessionId).slice(0, 8)}…`}${lane.lastModel === null ? '' : ` · ${text.lastModel} ${lane.lastModel}`}`)),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
        h('span', { style: { flex: '0 0 52px', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' } }, text.role), input('role', 160)),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
        h('span', { style: { flex: '0 0 52px', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' } }, text.model), input('model', 120)),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        h('span', { style: { flex: '0 0 52px', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' } }, text.effort), input('effort', 60),
        h('span', { style: { flex: '0 0 auto', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' } }, text.speed), input('speed', 60),
        h('button', {
          type: 'button',
          disabled: state.busy,
          onClick: () => { void send({ action: 'set', lane: lane.id, role: edit.role, model: edit.model, effort: edit.effort, speed: edit.speed }); },
          style: buttonStyle('var(--dsw-alias-brand-primary)'),
        }, text.save),
        h('button', {
          type: 'button',
          disabled: state.busy,
          onClick: () => { void send({ action: 'set', lane: lane.id, clear: true }); },
          style: buttonStyle('var(--dsw-alias-label-secondary)'),
        }, text.clear),
        h('button', {
          type: 'button',
          disabled: state.busy,
          onClick: () => { void send({ action: 'remove', lane: lane.id }); },
          style: buttonStyle('var(--dsw-alias-state-error-primary)'),
        }, text.remove))));
  }

  blocks.push(h('div', { key: 'add', style: Object.assign({}, box, { marginBottom: 10 }) },
    h('div', { style: { fontWeight: 600, marginBottom: 6 } }, text.addLane),
    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      h('input', {
        value: newLaneId,
        onChange: (event) => setNewLane((previous) => ({ ...previous, lane: event.target.value })),
        placeholder: 'lane id (e.g. review)',
        style: Object.assign({}, mono, { flex: '1 1 140px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '3px 6px' }),
      }),
      h('select', {
        value: newLaneWorker,
        onChange: (event) => setNewLane((previous) => ({ ...previous, worker: event.target.value })),
        style: Object.assign({}, mono, { flex: '0 1 140px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '3px 6px' }),
      }, [h('option', { key: '', value: '' }, text.product), ...productIds.map((id) => h('option', { key: id, value: id }, id))]),
      h('button', {
        type: 'button',
        disabled: state.busy || newLaneId.length === 0 || newLaneWorker.length === 0,
        onClick: () => { void send({ action: 'add', lane: newLaneId.toLowerCase(), worker: newLaneWorker }); setNewLane({ lane: '', worker: '' }); },
        style: buttonStyle('var(--dsw-alias-brand-primary)'),
      }, text.create))));

  blocks.push(h('div', { key: 'where', style: Object.assign({}, box, { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }) },
    h('div', null, `${text.product}: ${(payload.products ?? []).map((product) => `${product.id}${product.builtIn === true ? '' : ' (custom)'}`).join(' · ')}`),
    h('div', { style: mono }, `${text.configFile}: ${payload.configPath}`),
    h('div', { style: mono }, `${text.workspace}: ${payload.workspaceRoot}`),
    h('div', null, text.settingsHint)));

  return h('div', { style: { padding: '4px 2px', fontSize: 12, display: 'flex', flexDirection: 'column' } }, blocks);
}

function buttonStyle(color) {
  return {
    cursor: 'pointer',
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    borderRadius: 6,
    padding: '2px 10px',
    fontSize: 11,
    flex: '0 0 auto',
  };
}

// ── registration ──────────────────────────────────────────────────────────
export function apply(ctx) {
  const slots = ctx.get('slots');
  if (slots === undefined) return;

  slots.inject('conversation.input.dock', () => slots.register(
    { name: 'conversation.input.dock', id: 'external-workers', order: 30, label: 'External workers' },
    () => h(DockRow, null),
  ));

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'external-workers-drawer', order: 30, label: 'External worker details' },
    () => h('div', { style: { pointerEvents: 'none' } }, h(Drawer, null)),
  ));

  // A real settings page, because a roster needs room. It edits the same lanes
  // the worker_config tool does; the route behind it calls the same host code.
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'external-workers', order: 30, label: () => pickText().settingsTitle },
    () => h(SettingsPage, null),
  ));
}
