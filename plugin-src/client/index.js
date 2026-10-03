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
const ui = { open: false, tab: 'lanes', jobId: null, laneFilter: null };
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
 * point: two lanes of the same product (say `lore` and `models`, both gpt)
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

function Drawer() {
  const text = pickText();
  const { payload, failure } = useFeed();
  const state = useUi();

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
    } else {
      for (const block of JobsTab(text, payload, state)) body.push(block);
    }
  }

  const tabs = [['lanes', text.tabLanes], ['jobs', text.tabJobs]].map(([id, caption]) => h('button', {
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
}
