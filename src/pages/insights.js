// Insights: analytics over a 7 / 30 / 90-day window (90D = 13 weekly
// buckets), each stat compared with the window just before it.
// Demo mode shows team delivery metrics; live mode (the viewer's own
// connectors) shows calendar load, who they meet, inbox mix, tasks and focus.

import '../styles/pages/insights.css';
import { gsap, reduced, fadeUp, revealCards, countTo, flipList } from '../lib/motion.js';
import { qs, qsa, esc, icon, startOfDay, addDays, daysBetween, fmtDate, fmtTime, weekday, download, toCsv } from '../lib/dom.js';
import { state, subscribe, project, member, firstName, boardTasks, openHours, doneBetween, focusMinutesBetween } from '../store.js';
import {
  pageHead, headIntro, card, avatar, projectChip, segmented, bindSegmented, emptyState, sourceNote, sourceReady,
} from '../ui/components.js';
import { notify, openTask, bindCardExpand } from '../ui/overlays.js';
import { lineChart, donutChart, barChart } from '../charts.js';

const DAY = 86_400_000;
const RANGES = [['7', '7D'], ['30', '30D'], ['90', '90D']];
const FMT = {
  int: (v) => Math.round(v).toLocaleString('en-US'),
  pct: (v) => `${Math.round(v)}%`,
  days: (v) => `${v.toFixed(1)}d`,
  hm: (v) => (v >= 60 ? `${(v / 60).toFixed(1)}h` : `${Math.round(v)}m`),
};
const hfmt = (v) => (v === 0 || v >= 10 ? `${Math.round(v)}h` : `${v.toFixed(1)}h`);

let root;
let range = 30;
let data = null;
let thru = null;
let thruTimer = null;
let tableOn = false;
let hbRO = null;
const isLive = () => !state.demo;

// ---------- small helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pctChange = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : 0);
const signed = (n, unit = '') => (n > 0 ? `+${n}${unit}` : n < 0 ? `−${Math.abs(n)}${unit}` : 'same');
const iso = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const span = (d) => `${d.R} days`;

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return [1, 2, 2.5, 5, 10].find((s) => n <= s) * mag;
}

function tweenNum(el, from, to, fmt) {
  if (!el) return;
  if (reduced() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const o = { v: from };
  el.textContent = fmt(from);
  gsap.to(o, { v: to, duration: 0.9, ease: 'power3.out', onUpdate: () => (el.textContent = fmt(o.v)) });
}

// ---------- data ----------
function bucketsFor(R) {
  const weekly = R === 90;
  const n = weekly ? 13 : R;
  const step = weekly ? 7 : 1;
  const today = startOfDay();
  const buckets = Array.from({ length: n }, (_, i) => {
    const a = addDays(today, 1 - (n - i) * step);
    const b = addDays(a, step);
    const pa = addDays(a, -n * step);
    return { a: a.getTime(), b: b.getTime(), pa: pa.getTime(), pb: addDays(pa, step).getTime(), label: R === 7 ? weekday(a) : fmtDate(a) };
  });
  return { weekly, n, buckets, start: buckets[0].a, end: buckets[n - 1].b, prevStart: buckets[0].pa };
}

function compute(R) {
  const { weekly, n, buckets, start, end, prevStart } = bucketsFor(R);

  const done = doneBetween(start, end);
  const prev = doneBetween(prevStart, start);
  const earliest = Math.min(...state.tasks.filter((t) => t.doneAt).map((t) => t.doneAt));
  const hasPrev = earliest <= start - (end - start) / 2;

  const onTimeOf = (t) => daysBetween(t.due, t.doneAt) <= 0;
  const inB = (t, a, b) => t.doneAt >= a && t.doneAt < b;
  const cur = buckets.map((k) => done.filter((t) => inB(t, k.a, k.b)).length);
  const prevVals = buckets.map((k) => prev.filter((t) => inB(t, k.pa, k.pb)).length);
  const onPer = buckets.map((k) => done.filter((t) => inB(t, k.a, k.b) && onTimeOf(t)).length);
  const focusPer = buckets.map((k) => focusMinutesBetween(k.a, k.b) / 60);

  const onTime = done.filter(onTimeOf).length;
  const prevOnTime = prev.filter(onTimeOf).length;
  const rate = done.length ? (onTime / done.length) * 100 : 0;
  const prevRate = prev.length ? (prevOnTime / prev.length) * 100 : 0;
  const cycleOf = (list) => (list.length ? list.reduce((s, t) => s + (t.doneAt - t.created), 0) / list.length / DAY : 0);

  const byProject = new Map();
  done.forEach((t) => byProject.set(t.projectId, (byProject.get(t.projectId) || 0) + 1));
  const parts = [...byProject]
    .map(([id, count]) => ({ p: project(id), count }))
    .filter((x) => x.p)
    .sort((a, b) => b.count - a.count);

  return {
    R, weekly, n, buckets, start, end, hasPrev, done, prev, cur, prevVals, onPer, focusPer, parts,
    onTime, late: done.length - onTime, rate, prevRate,
    focusH: Math.round(focusMinutesBetween(start, end) / 60),
    prevFocusH: Math.round(focusMinutesBetween(prevStart, start) / 60),
    cycle: cycleOf(done), prevCycle: cycleOf(prev),
  };
}

function statList(d) {
  const p = d.hasPrev;
  const ch = pctChange(d.done.length, d.prev.length);
  const pts = Math.round(d.rate) - Math.round(d.prevRate);
  const fch = pctChange(d.focusH, d.prevFocusH);
  const cd = Math.round((d.cycle - d.prevCycle) * 10) / 10;
  return [
    { key: 'done', label: 'Completed', value: d.done.length, delta: p ? signed(ch, '%') : '', tone: ch >= 0 ? 'up' : 'down' },
    { key: 'rate', label: 'On-time rate', value: Math.round(d.rate), fmt: 'pct', delta: p ? signed(pts, ' pts') : '', tone: pts > 0 ? 'up' : pts < 0 ? 'down' : 'plain' },
    { key: 'focus', label: 'Focus hours', value: d.focusH, suffix: 'h', delta: p ? signed(fch, '%') : '', tone: fch >= 0 ? 'up' : 'down' },
    { key: 'cycle', label: 'Avg cycle time', value: Math.round(d.cycle * 10) / 10, fmt: 'days', delta: p ? (cd === 0 ? 'same' : cd < 0 ? `−${Math.abs(cd).toFixed(1)}d` : `+${cd.toFixed(1)}d`) : '', tone: cd < 0 ? 'up' : cd > 0 ? 'down' : 'plain' },
  ];
}

function statsHtml(list, d) {
  return `<dl class="head__stats">${list
    .map((s) => `<div class="stat" data-stat="${s.key}"><dt>${esc(s.label)}</dt><dd><b data-n="${s.value}" data-f="${s.fmt || 'int'}">0</b>${
      s.suffix ? `<small>${esc(s.suffix)}</small>` : ''
    }<small class="delta delta--${s.tone}" title="Compared with the previous ${span(d)}">${esc(s.delta)}</small></dd></div>`)
    .join('')}</dl>`;
}

// ---------- throughput ----------
function seriesOf(d) {
  return [
    { name: `Last ${span(d)}`, tone: 'accent', values: d.cur },
    ...(d.hasPrev ? [{ name: `Previous ${span(d)}`, tone: 'muted', values: d.prevVals }] : []),
  ];
}

function thruTopHtml(d) {
  const total = d.done.length;
  const ch = pctChange(total, d.prev.length);
  const delta = d.hasPrev
    ? `<span class="delta delta--${ch >= 0 ? 'up' : 'down'}">${esc(signed(ch, '%'))} vs previous ${span(d)}</span>`
    : '<span class="delta delta--plain">No earlier history to compare</span>';
  return `<p class="ins-sum"><b data-k="thru">${FMT.int(total)}</b><span>finished</span>${delta}</p>
    <ul class="ins-key"><li><i class="key-line"></i>Last ${span(d)}</li><li ${d.hasPrev ? '' : 'hidden'}><i class="key-line key-line--dash"></i>Previous ${span(d)}</li></ul>`;
}

function tableHtml(d) {
  const unit = d.weekly ? 'Week of' : 'Day';
  const rows = d.buckets.map((k, i) => ({ label: d.weekly ? fmtDate(k.a) : d.R === 7 ? `${k.label} ${fmtDate(k.a)}` : k.label, cur: d.cur[i], prev: d.prevVals[i] })).reverse();
  const chip = (n) => (n === 0 ? '<span class="muted">–</span>' : `<span class="delta delta--${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : '−'}${Math.abs(n)}</span>`);
  const dash = '<span class="muted">–</span>';
  const tc = d.done.length;
  const tp = d.prev.length;
  return `<table class="itable"><caption class="sr">Tasks finished per ${d.weekly ? 'week' : 'day'}, last ${span(d)}</caption>
    <thead><tr><th scope="col">${unit}</th><th scope="col">Finished</th><th scope="col">Previous</th><th scope="col">Change</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${r.cur}</td><td>${d.hasPrev ? r.prev : dash}</td><td>${d.hasPrev ? chip(r.cur - r.prev) : dash}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Total</th><td>${tc}</td><td>${d.hasPrev ? tp : dash}</td><td>${d.hasPrev ? `<span class="delta delta--${tc >= tp ? 'up' : 'down'}">${esc(signed(pctChange(tc, tp), '%'))}</span>` : dash}</td></tr></tfoot></table>`;
}

const toggleHtml = () =>
  tableOn ? `${icon('chart')}<span>Chart</span>` : `${icon('list')}<span>Table</span>`;

function mountThru() {
  thru = null;
  thruTimer?.kill();
  const host = qs('.thru__chart', root);
  const make = () => {
    const h = clamp(Math.round(innerWidth * 0.17), 220, 300);
    thru = lineChart(host, { series: seriesOf(data), labels: data.buckets.map((k) => k.label), height: h, fmt: FMT.int });
    chartKeys(host, 'Throughput chart');
  };
  if (reduced()) make();
  else thruTimer = gsap.delayedCall(0.45, make);
}

// Arrow keys step through the chart by replaying its pointer handler.
function chartKeys(host, label) {
  host.tabIndex = 0;
  host.setAttribute('aria-label', `${label}. Use the left and right arrow keys to read each point.`);
  let i = -1;
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const svg = qs('svg', host);
    const n = data?.n;
    if (!svg || !n) return;
    e.preventDefault();
    i = i < 0 ? n - 1 : clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, n - 1);
    const r = svg.getBoundingClientRect();
    const w = svg.viewBox.baseVal.width || r.width;
    const x = 34 + (i * (w - 42)) / Math.max(1, n - 1);
    svg.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + (x / w) * r.width, clientY: r.top + 10 }));
  });
  host.addEventListener('blur', () => {
    i = -1;
    qs('svg', host)?.dispatchEvent(new PointerEvent('pointerleave'));
  });
}

function toggleTable(btn) {
  tableOn = !tableOn;
  const views = qs('.thru__views', root) || document.querySelector('.thru__views');
  const chart = qs('.thru__chart', views);
  const table = qs('.thru__table', views);
  btn.setAttribute('aria-pressed', tableOn);
  btn.innerHTML = toggleHtml();
  const swap = () => {
    views.classList.toggle('is-table', tableOn);
    table.hidden = !tableOn;
    const incoming = tableOn ? table : chart;
    if (!reduced()) {
      gsap.fromTo(incoming, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out', clearProps: 'opacity,transform' });
      if (tableOn) fadeUp(qsa('tbody tr', table).slice(0, 12), { y: 6, stagger: 0.02 });
    }
  };
  if (reduced()) return swap();
  gsap.to(tableOn ? chart : table, { opacity: 0, y: -6, duration: 0.16, ease: 'power2.in', onComplete: () => {
    gsap.set(tableOn ? chart : table, { clearProps: 'opacity,transform' });
    swap();
  } });
}

// ---------- focus bars ----------
function focusTopHtml(d) {
  const per = d.focusH / d.n;
  return `<p class="ins-sum"><b data-k="focus">${FMT.int(d.focusH)}</b><span>hours</span><span class="muted">about ${per.toFixed(1)}h a ${d.weekly ? 'week' : 'day'}</span></p>`;
}

function hbHtml(d) {
  const max = niceCeil(Math.max(...d.focusPer) * 1.05);
  return `<div class="hb__grid" aria-hidden="true">${[max, max / 2, 0].map((v) => `<span><em>${hfmt(v)}</em></span>`).join('')}</div>
    <div class="hb__cols">${d.focusPer
      .map((v, i) => `<div class="hb__col ${i === d.n - 1 ? 'is-hi' : ''}" role="listitem" aria-label="${esc(d.buckets[i].label)}: ${hfmt(v)}">
        <div class="hb__track"><i class="hb__bar" style="height:${(v / max) * 100}%"><em class="hb__tip">${hfmt(v)}</em></i></div>
        <span class="hb__lab">${esc(d.buckets[i].label)}</span></div>`)
      .join('')}</div>`;
}

function tickLabels() {
  const hb = qs('.hb', root);
  if (!hb) return;
  const cols = qsa('.hb__col', hb);
  const n = cols.length;
  const k = Math.ceil(n / Math.max(2, Math.floor((hb.clientWidth - 40) / 54)));
  cols.forEach((c, i) => c.classList.toggle('is-tick', (n - 1 - i) % k === 0));
}

function renderBars(d, animate) {
  const hb = qs('.hb', root);
  const old = qsa('.hb__bar', hb).map((b) => parseFloat(b.style.height) || 0);
  const sameCount = old.length === d.n;
  hb.innerHTML = hbHtml(d);
  hb.setAttribute('aria-label', `Focus hours per ${d.weekly ? 'week' : 'day'}, last ${span(d)}`);
  tickLabels();
  if (!animate || reduced()) return;
  const bars = qsa('.hb__bar', hb);
  if (sameCount) {
    bars.forEach((b, i) => gsap.fromTo(b, { height: `${old[i]}%` }, { height: b.style.height, duration: 0.75, ease: 'power3.inOut' }));
  } else {
    gsap.fromTo(bars, { scaleY: 0 }, { scaleY: 1, transformOrigin: '50% 100%', duration: 0.9, ease: 'power3.out', stagger: Math.min(0.035, 0.5 / d.n), delay: 0.05, clearProps: 'transform' });
    fadeUp(qsa('.hb__lab', hb), { y: 4, stagger: 0.01 });
  }
}

// ---------- by project ----------
function legendHtml(d) {
  if (!d.parts.length) return '';
  const total = d.done.length || 1;
  return `<table class="plegend"><caption class="sr">Finished tasks by project</caption>
    <thead class="sr"><tr><th scope="col">Project</th><th scope="col">Tasks</th><th scope="col">Share</th></tr></thead>
    <tbody>${d.parts
      .map((x, i) => `<tr class="plegend__row hue--${x.p.hue}" data-i="${i}" tabindex="0"><th scope="row"><i aria-hidden="true"></i><span>${esc(x.p.name)}</span></th><td>${x.count}</td><td class="muted">${Math.round((x.count / total) * 100)}%</td></tr>`)
      .join('')}</tbody></table>`;
}

function renderProj(d, animate) {
  const box = qs('.proj', root);
  if (!d.parts.length) {
    box.classList.add('is-empty');
    box.innerHTML = emptyState('Nothing finished', 'Nothing finished in this window.', 'chart');
    return;
  }
  box.classList.remove('is-empty');
  box.innerHTML = `<div class="proj__donut"></div>${legendHtml(d)}`;
  const host = qs('.proj__donut', box);
  const draw = () =>
    donutChart(host, {
      segments: d.parts.map((x) => ({ label: x.p.name, value: x.count, tone: x.p.hue })),
      size: 160,
      stroke: 18,
      center: `<b>${d.done.length}</b><span>finished</span>`,
    });
  draw();
  if (animate) fadeUp(qsa('.plegend__row', box), { y: 6, stagger: 0.03 });
}

// Legend <-> donut highlight; each .proj box (projects, people) has its own pair.
function hotProject(i, box = null) {
  (box ? [box] : qsa('.proj', root)).forEach((b) => {
    const donut = qs('.donut', b);
    if (!donut) return;
    const on = i != null;
    donut.classList.toggle('is-dim', on);
    qsa('.donut__seg', donut).forEach((s) => s.classList.toggle('is-hot', on && s.dataset.i === String(i)));
    qsa('.plegend__row', b).forEach((r) => r.classList.toggle('is-dim', on && r.dataset.i !== String(i)));
  });
}

// ---------- workload ----------
function workRows() {
  const rows = state.members.map((m) => {
    const load = openHours(m.id);
    const ratio = load / (m.capacity || 1);
    return { m, load, cap: m.capacity, ratio, tone: ratio > 1 ? 'over' : ratio >= 0.85 ? 'near' : 'ok' };
  });
  rows.sort((a, b) => b.ratio - a.ratio || b.load - a.load);
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.load, r.cap))) * 1.04;
  return { rows, scale, over: rows.filter((r) => r.tone === 'over').length };
}

function workHtml({ rows, scale }) {
  return rows
    .map(({ m, load, cap, tone }) => `<li class="wl__row is-${tone}" data-key="${m.id}">
      <a class="wl__who" href="#/team/${m.id}">${avatar(m.id, 'sm')}<span><b>${esc(m.name)}</b><small>${esc(m.role)}</small></span></a>
      <div class="wl__bar" role="meter" aria-valuemin="0" aria-valuemax="${Math.max(load, cap)}" aria-valuenow="${load}"
        aria-valuetext="${load} of ${cap} hours${tone === 'over' ? ', over capacity' : ''}" aria-label="${esc(m.name)} workload">
        <i class="wl__fill" style="width:${(load / scale) * 100}%"></i><i class="wl__cap" style="left:${(cap / scale) * 100}%"></i></div>
      <span class="wl__num"><b>${load}h</b><small>/ ${cap}h</small></span></li>`)
    .join('');
}

const workBadge = (over) => (over ? `<span class="badge badge--danger">${over} over</span>` : '<span class="badge">All within capacity</span>');

function renderWork(animate) {
  const w = workRows();
  const ul = qs('.wl', root);
  const badge = qs('[data-work-badge]', root);
  if (badge) badge.innerHTML = workBadge(w.over);
  const old = new Map(qsa('.wl__row', ul).map((r) => [r.dataset.key, qs('.wl__fill', r).style.width]));
  if (!animate || reduced()) {
    ul.innerHTML = workHtml(w);
    return;
  }
  flipList(ul, () => (ul.innerHTML = workHtml(w)));
  qsa('.wl__row', ul).forEach((r) => {
    const f = qs('.wl__fill', r);
    const from = old.get(r.dataset.key);
    if (from && from !== f.style.width) gsap.fromTo(f, { width: from }, { width: f.style.width, duration: 0.7, ease: 'power3.inOut' });
  });
}

// ---------- on time ----------
function slowTasks() {
  const sod = startOfDay().getTime();
  const open = boardTasks().filter((t) => t.status !== 'done');
  const late = open.filter((t) => t.due < sod).sort((a, b) => a.due - b.due);
  const rest = open.filter((t) => t.due >= sod).sort((a, b) => a.created - b.created);
  return [...late, ...rest].slice(0, 3).map((t) => {
    const isLate = t.due < sod;
    return { t, isLate, age: Math.max(1, isLate ? daysBetween(t.due, new Date()) : daysBetween(t.created, new Date())) };
  });
}

function timeHtml(d) {
  const r = Math.round(d.rate);
  const none = !d.done.length;
  const slow = slowTasks();
  return `<div class="ot__big"><b data-k="rate">${r}</b><span class="ot__unit">%</span><p>finished on or before the due day</p></div>
    <div class="ot__bar ${none ? 'is-empty' : ''}" role="img" aria-label="${d.onTime} on time, ${d.late} late">
      <i class="ot__on" style="width:calc(${none ? 50 : r}% - 2px)"></i><i class="ot__late" style="width:calc(${none ? 50 : 100 - r}% - 2px)"></i></div>
    <ul class="ot__keys"><li><i class="ot__dot ot__dot--on"></i>${d.onTime} on time</li><li><i class="ot__dot ot__dot--late"></i>${d.late} late</li></ul>
    <h3 class="slow__h">Slowest open tasks</h3>
    ${slow.length
      ? `<div class="slow">${slow
        .map(({ t, isLate, age }) => `<button type="button" class="slow__row" data-task="${t.id}">${avatar(t.assignee, 'sm')}
          <span class="slow__main"><b>${esc(t.title)}</b><small>${projectChip(t.projectId)}<span>${esc(firstName(t.assignee))}</span></small></span>
          <span class="slow__age ${isLate ? 'is-late' : ''}"><b>${age}d</b><small>${isLate ? 'late' : 'open'}</small></span></button>`)
        .join('')}</div>`
      : emptyState('No open work', 'Every task is finished.', 'check')}`;
}

function playTimeBar(delay = 0) {
  if (reduced()) return;
  gsap.from(qsa('.ot__on', root), { scaleX: 0, transformOrigin: '0 50%', duration: 1.1, ease: 'power3.out', delay: delay + 0.15, clearProps: 'transform' });
  gsap.from(qsa('.ot__late', root), { scaleX: 0, transformOrigin: '100% 50%', duration: 0.8, ease: 'power3.out', delay: delay + 0.7, clearProps: 'transform' });
}

// ---------- page render ----------
function render() {
  data = compute(range);
  const d = data;
  const w = workRows();
  const head = pageHead({
    title: 'Insights',
    sub: `How the team worked over the last <span data-sub>${span(d)}</span>`,
    actions: `${segmented('Range', RANGES, String(range), 'ins-range')}<button type="button" class="btn btn--glass" data-act="csv">${icon('download')}Export CSV</button>`,
  }).trim().replace(/<\/header>$/, `${statsHtml(statList(d), d)}</header>`);

  root.innerHTML = `${head}<div class="insights">
    ${card({
      id: 'i-thru', cls: 'ins-thru', title: 'Throughput', expand: true,
      sub: `<span data-thru-sub>Tasks finished each ${d.weekly ? 'week' : 'day'}</span>`,
      tools: `<button type="button" class="btn btn--glass btn--sm thru__toggle" aria-pressed="${tableOn}" aria-controls="thru-table">${toggleHtml()}</button>`,
      body: `<div class="ins-top">${thruTopHtml(d)}</div>
        <div class="thru__views ${tableOn ? 'is-table' : ''}"><div class="thru__chart"></div>
        <div class="thru__table" id="thru-table" tabindex="0" ${tableOn ? '' : 'hidden'}>${tableHtml(d)}</div></div>`,
    })}
    ${card({ id: 'i-proj', cls: 'ins-proj', title: 'By project', sub: 'Where the finished work went', body: '<div class="proj"></div>' })}
    ${card({
      id: 'i-focus', cls: 'ins-focus', title: 'Focus',
      sub: `<span data-focus-sub>Team focus hours each ${d.weekly ? 'week' : 'day'}</span>`,
      body: `<div class="ins-top" data-focus-top>${focusTopHtml(d)}</div><div class="hb" role="list"></div>`,
    })}
    ${card({
      id: 'i-work', cls: 'ins-work', title: 'Workload', sub: 'Open task hours against weekly capacity',
      tools: `<span data-work-badge>${workBadge(w.over)}</span>`,
      body: `<ul class="wl__key"><li><i class="wl__key-fill"></i>Open work</li><li><i class="wl__key-cap"></i>Capacity</li><li><i class="wl__key-over"></i>Over capacity</li></ul><ul class="wl"></ul>`,
    })}
    ${card({ id: 'i-time', cls: 'ins-time', title: 'On time', sub: `<span data-time-sub>Tasks finished in the last ${span(d)}</span>`, body: `<div class="ot">${timeHtml(d)}</div>` })}
  </div>`;

  bindSegmented(qs('.ins-range', root), (v) => {
    range = +v;
    refresh(true);
  });
  renderBars(d, false);
  renderWork(false);
  mountThru();
  if (!hbRO) hbRO = new ResizeObserver(tickLabels);
  hbRO.disconnect();
  hbRO.observe(qs('.hb', root));
}

function intro() {
  headIntro(root);
  qsa('.head [data-n]', root).forEach((el) => countTo(el, +el.dataset.n, FMT[el.dataset.f] || FMT.int));
  revealCards(qsa('.card', root), { y: 30, stagger: 0.06, delay: 0.12 });
  const d = data;
  const t = reduced() ? 0 : 0.45;
  if (reduced()) {
    renderProj(d, false);
    return;
  }
  // Hide what will grow in, then play the second wave.
  qsa('[data-k]', root).forEach((el) => (el.textContent = '0'));
  gsap.set(qsa('.hb__bar', root), { scaleY: 0, transformOrigin: '50% 100%' });
  gsap.set(qsa('.wl__fill', root), { scaleX: 0, transformOrigin: '0 50%' });
  gsap.set(qsa('.ot__on, .ot__late', root), { scaleX: 0 });
  gsap.delayedCall(t, () => {
    if (data !== d) return;
    gsap.to(qsa('.hb__bar', root), { scaleY: 1, duration: 0.9, ease: 'power3.out', stagger: Math.min(0.035, 0.5 / d.n), delay: 0.05, clearProps: 'transform' });
    renderProj(d, true);
    qsa('.wl__fill', root).forEach((f, i) => gsap.to(f, { scaleX: 1, duration: 1, ease: 'power3.out', delay: 0.1 + i * 0.04, clearProps: 'transform' }));
    gsap.set(qsa('.ot__on, .ot__late', root), { clearProps: 'transform' });
    playTimeBar();
    fadeUp(qsa('.wl__row, .slow__row, .ins-key li, .ot__keys li', root), { y: 8, stagger: 0.025 });
    tweenNum(qs('[data-k="thru"]', root), 0, d.done.length, FMT.int);
    tweenNum(qs('[data-k="focus"]', root), 0, d.focusH, FMT.int);
    tweenNum(qs('[data-k="rate"]', root), 0, Math.round(d.rate), FMT.int);
  });
}

function flash(el) {
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  if (!reduced()) gsap.fromTo(el, { y: -4, scale: 1.06 }, { y: 0, scale: 1, duration: 0.6, ease: 'back.out(2.4)', clearProps: 'transform' });
}

function updateTiles(list, d, animate) {
  list.forEach((s) => {
    const tile = qs(`[data-stat="${s.key}"]`, root);
    if (!tile) return;
    const b = qs('b', tile);
    const delta = qs('.delta', tile);
    const changed = b.dataset.n !== String(s.value);
    b.dataset.n = s.value;
    if (changed || !animate) countTo(b, s.value, FMT[s.fmt || 'int']);
    delta.textContent = s.delta;
    delta.className = `delta delta--${s.tone}`;
    delta.title = `Compared with the previous ${span(d)}`;
    if (changed && animate) flash(tile);
  });
}

// In-place update with animation (range change or live store change).
function refresh(animate) {
  const last = data;
  data = compute(range);
  const d = data;
  const lbl = d.weekly ? 'week' : 'day';

  qs('[data-sub]', root).textContent = span(d);
  updateTiles(statList(d), d, animate);

  // throughput
  const thruCard = document.getElementById('i-thru');
  qs('[data-thru-sub]', thruCard).textContent = `Tasks finished each ${lbl}`;
  qs('.ins-top', thruCard).innerHTML = thruTopHtml(d);
  tweenNum(qs('[data-k="thru"]', thruCard), last ? last.done.length : 0, d.done.length, FMT.int);
  qs('.thru__table', thruCard).innerHTML = tableHtml(d);
  if (thru) thru.update(seriesOf(d), d.buckets.map((k) => k.label));

  // focus
  qs('[data-focus-sub]', root).textContent = `Team focus hours each ${lbl}`;
  qs('[data-focus-top]', root).innerHTML = focusTopHtml(d);
  tweenNum(qs('[data-k="focus"]', root), last ? last.focusH : 0, d.focusH, FMT.int);
  renderBars(d, animate);

  // by project / workload / on time
  renderProj(d, animate);
  renderWork(animate);
  qs('[data-time-sub]', root).textContent = `Tasks finished in the last ${span(d)}`;
  const ot = qs('.ot', root);
  const oldOn = qs('.ot__on', ot)?.style.width;
  const oldLate = qs('.ot__late', ot)?.style.width;
  ot.innerHTML = timeHtml(d);
  tweenNum(qs('[data-k="rate"]', ot), last ? Math.round(last.rate) : 0, Math.round(d.rate), FMT.int);
  if (animate && !reduced()) {
    const on = qs('.ot__on', ot);
    const late = qs('.ot__late', ot);
    gsap.fromTo(on, { width: oldOn }, { width: on.style.width, duration: 0.8, ease: 'power3.inOut' });
    gsap.fromTo(late, { width: oldLate }, { width: late.style.width, duration: 0.8, ease: 'power3.inOut' });
    fadeUp(qsa('.slow__row', ot), { y: 6, stagger: 0.03 });
  }
}

function csvRows(d) {
  const unit = d.weekly ? 'Week of' : 'Day';
  if (d.live) {
    const rows = [[unit, 'Meeting hours', 'Previous period (hours)', 'Meetings', 'Tasks completed', 'Focus minutes']];
    d.buckets.forEach((k, i) =>
      rows.push([iso(k.a), (d.cur[i] / 60).toFixed(2), d.hasPrev ? (d.prevVals[i] / 60).toFixed(2) : '', d.countPer[i], d.donePer[i], Math.round(d.focusPer[i])]),
    );
    return rows;
  }
  const rows = [[unit, 'Finished', 'Previous period', 'Focus hours', 'On time', 'Late']];
  d.buckets.forEach((k, i) =>
    rows.push([iso(k.a), d.cur[i], d.hasPrev ? d.prevVals[i] : '', d.focusPer[i].toFixed(1), d.onPer[i], d.cur[i] - d.onPer[i]]),
  );
  return rows;
}

async function exportCsv() {
  const d = data || (isLive() ? computeLive(range) : compute(range));
  try {
    const saved = await download(`lumen-insights-${d.R}d.csv`, toCsv(csvRows(d)));
    if (saved !== false) notify(`Exported the last ${span(d)}`, { ico: 'download' });
  } catch {
    notify('Couldn’t export the CSV. Try again.', { ico: 'x', tone: 'warn' });
  }
}

// =============================== live mode ===============================
// Everything below reads the viewer's own calendar, inbox, tasks and focus.
// Calendar numbers only count timed meetings/reviews the viewer hasn't
// declined, merged so overlapping meetings never count twice.

const HOUR = 3_600_000;
const MIN = 60_000;
const MEET_KINDS = new Set(['meeting', 'review']);
const HISTORY_DAYS = 95; // how far back the store loads the calendar
const WORK = [9, 18]; // working hours, weekdays
const BIG_MEETING = 12; // larger meetings say little about who you work with
const WHO_TONES = ['blue', 'purple', 'orange', 'teal', 'pink'];
const CATS = [['personal', 'Primary'], ['updates', 'Updates'], ['promotions', 'Promotions'], ['social', 'Social'], ['forums', 'Forums']];

let liveSig = {};
let busyBars = null;

const atHour = (day, h) => {
  const d = new Date(day);
  d.setHours(h, 0, 0, 0);
  return d.getTime();
};
const isWorkday = (t) => {
  const g = new Date(t).getDay();
  return g !== 0 && g !== 6;
};
const durText = (ms) => {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pctDelta = (cur, prev) => (prev ? signed(pctChange(cur, prev), '%') : '');
const dayName = (g, style = 'short') => weekday(new Date(2024, 0, 7 + g), style); // 2024-01-07 is a Sunday
const sigChanged = (key, value) => {
  const s = JSON.stringify(value);
  if (liveSig[key] === s) return false;
  liveSig[key] = s;
  return true;
};

const myMeetings = () =>
  state.events.filter((e) => MEET_KINDS.has(e.kind) && !e.allDay && e.rsvp !== 'declined' && e.end > e.start && (e.attendees || []).includes(state.me));

/** Meeting intervals clipped to [a, b) and merged so overlaps count once. */
function merged(list, a, b) {
  const iv = [];
  for (const e of list) {
    const s = Math.max(a, e.start);
    const t = Math.min(b, e.end);
    if (t > s) iv.push([s, t]);
  }
  iv.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [s, t] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], t);
    else out.push([s, t]);
  }
  return out;
}
const busyMs = (list, a, b) => (b > a ? merged(list, a, b).reduce((sum, [s, t]) => sum + t - s, 0) : 0);

/** Longest meeting-free stretch inside working hours between `from` and `to`. */
function freeBlock(list, from, to) {
  let best = null;
  for (let day = startOfDay(from); day.getTime() < to; day = addDays(day, 1)) {
    if (!isWorkday(day)) continue;
    const a = Math.max(from, atHour(day, WORK[0]));
    const b = Math.min(to, atHour(day, WORK[1]));
    if (b <= a) continue;
    let cursor = a;
    for (const [s, t] of merged(list, a, b)) {
      if (s - cursor > (best?.len ?? 0)) best = { len: s - cursor, at: cursor };
      cursor = Math.max(cursor, t);
    }
    if (b - cursor > (best?.len ?? 0)) best = { len: b - cursor, at: cursor };
  }
  return best;
}

function computeLive(R) {
  const { weekly, n, buckets, start, end, prevStart } = bucketsFor(R);
  const now = Date.now();
  const today = startOfDay();
  const ready = sourceReady('calendar');
  const all = myMeetings();
  const win = all.filter((e) => e.end > prevStart && e.start < end);
  const upto = (b) => Math.min(b, now);
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);

  // Per bucket: merged meeting minutes already spent, meetings, tasks, focus.
  const cur = buckets.map((k) => busyMs(win, k.a, upto(k.b)) / MIN);
  const prevVals = buckets.map((k) => busyMs(win, k.pa, k.pb) / MIN);
  const countPer = buckets.map((k) => win.filter((e) => e.start >= k.a && e.start < upto(k.b)).length);
  const donePer = buckets.map((k) => doneBetween(k.a, k.b).length);
  const focusPer = buckets.map((k) => focusMinutesBetween(k.a, k.b));

  const past = win.filter((e) => e.start < now && e.end > start);
  const inWindow = win.filter((e) => e.end > start && e.start < end);

  // Busiest days: average merged meeting hours per weekday in the window.
  const wd = Array.from({ length: 7 }, () => ({ sum: 0, days: 0 }));
  for (let day = addDays(today, 1 - R); day <= today; day = addDays(day, 1)) {
    const slot = wd[day.getDay()];
    slot.days++;
    slot.sum += busyMs(past, day.getTime(), upto(addDays(day, 1).getTime())) / HOUR;
  }
  const ws = state.settings.weekStart ?? 1;
  const days = Array.from({ length: 7 }, (_, i) => {
    const g = (ws + i) % 7;
    return { g, label: dayName(g), value: wd[g].days ? wd[g].sum / wd[g].days : 0 };
  });

  // Who you meet: shared meeting time per person, small meetings only.
  const who = new Map();
  for (const e of past) {
    const others = [...new Set(e.attendees)].filter((id) => id !== state.me);
    if (!others.length || others.length >= BIG_MEETING) continue;
    const len = upto(e.end) - Math.max(e.start, start);
    if (len <= 0) continue;
    for (const id of others) {
      const m = member(id);
      if (!m || m.bot) continue;
      const w = who.get(id) || { ms: 0, n: 0 };
      w.ms += len;
      w.n++;
      who.set(id, w);
    }
  }
  const people = [...who]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 5)
    .map(([id, w], i) => ({ id, name: member(id)?.name || id, ms: w.ms, n: w.n, tone: WHO_TONES[i] }));

  // Calendar health.
  const dayLen = (WORK[1] - WORK[0]) * HOUR;
  let booked = 0;
  let capacity = 0;
  for (let day = addDays(today, 1 - R); day <= today; day = addDays(day, 1)) {
    if (!isWorkday(day)) continue;
    capacity += dayLen;
    booked += busyMs(inWindow, atHour(day, WORK[0]), atHour(day, WORK[1]));
  }
  const tomorrow = addDays(today, 1).getTime();
  const weekEnd = addDays(today, 7 - ((today.getDay() - ws + 7) % 7)).getTime();
  const ahead = all.filter((e) => e.end > now && e.start < weekEnd);
  let b2b = 0;
  let prevEnd = 0;
  let prevDay = null;
  for (const e of [...inWindow].sort((x, y) => x.start - y.start)) {
    const key = startOfDay(e.start).getTime();
    if (key === prevDay && e.start >= prevEnd && e.start - prevEnd <= 5 * MIN) b2b++;
    prevEnd = key === prevDay ? Math.max(prevEnd, e.end) : e.end;
    prevDay = key;
  }
  const health = {
    pct: capacity ? Math.round((booked / capacity) * 100) : 0,
    workdays: Math.round(capacity / dayLen),
    today: isWorkday(today) ? freeBlock(ahead, now, tomorrow) : 'weekend',
    week: freeBlock(ahead, now, weekEnd),
    b2b,
    invites: state.events.filter((e) => e.rsvp === 'needsAction' && e.end > now).length,
  };

  // Inbox: loaded threads from the last 7 days, by category.
  const weekAgo = now - 7 * 86_400_000;
  const recent = state.threads.filter((t) => t.at >= weekAgo);
  const cats = CATS.map(([key, label]) => {
    const list = recent.filter((t) => (t.category || 'personal') === key);
    return { key, label, n: list.length, unread: list.filter((t) => t.unread).length };
  });

  return {
    live: true, R, weekly, n, buckets, start, end, ready, cur, prevVals, countPer, donePer, focusPer,
    hasPrev: ready && prevStart >= addDays(today, -HISTORY_DAYS).getTime(),
    meetMin: sum(cur), prevMeetMin: sum(prevVals),
    count: sum(countPer), prevCount: win.filter((e) => e.start >= prevStart && e.start < start).length,
    doneN: doneBetween(start, end).length, prevDoneN: doneBetween(prevStart, start).length,
    focusMin: focusMinutesBetween(start, end), prevFocusMin: focusMinutesBetween(prevStart, start),
    days, people, health, cats, recentN: recent.length,
  };
}

function liveStats(d) {
  const p = d.hasPrev;
  const cd = d.count - d.prevCount;
  return [
    { key: 'meet', label: 'Time in meetings', value: Math.round(d.meetMin), fmt: 'hm', delta: p ? pctDelta(d.meetMin, d.prevMeetMin) : '', tone: d.meetMin <= d.prevMeetMin ? 'up' : 'down' },
    { key: 'count', label: 'Meetings', value: d.count, delta: p ? (cd === 0 ? 'same' : signed(cd)) : '', tone: 'plain' },
    { key: 'done', label: 'Tasks completed', value: d.doneN, delta: pctDelta(d.doneN, d.prevDoneN), tone: d.doneN >= d.prevDoneN ? 'up' : 'down' },
    { key: 'focus', label: 'Focus', value: d.focusMin, fmt: 'hm', delta: pctDelta(d.focusMin, d.prevFocusMin), tone: d.focusMin >= d.prevFocusMin ? 'up' : 'down' },
  ];
}

const skel = (rows = 3, h = 14) =>
  `<div class="ins-skel" aria-hidden="true">${Array.from({ length: rows }, (_, i) => `<span class="skel" style="height:${h}px;width:${92 - (i % 4) * 17}%"></span>`).join('')}</div>`;

// ---------- meetings chart ----------
const liveSeries = (d) => [
  { name: `Last ${span(d)}`, tone: 'accent', values: d.cur },
  ...(d.hasPrev ? [{ name: `Previous ${span(d)}`, tone: 'muted', values: d.prevVals }] : []),
];

function meetTopHtml(d) {
  if (!d.ready) return skel(1, 26);
  let delta;
  if (!d.hasPrev) delta = `<span class="delta delta--plain">${d.R === 90 ? 'Lumen loads about 3 months of history' : 'No earlier history to compare'}</span>`;
  else if (!d.prevMeetMin) delta = '<span class="delta delta--plain">No meetings in the previous period</span>';
  else delta = `<span class="delta delta--${d.meetMin <= d.prevMeetMin ? 'up' : 'down'}">${esc(signed(pctChange(d.meetMin, d.prevMeetMin), '%'))} vs previous ${span(d)}</span>`;
  return `<p class="ins-sum"><b>${esc(durText(d.meetMin * MIN))}</b><span>in ${plural(d.count, 'meeting')}</span>${delta}</p>
    <ul class="ins-key"><li><i class="key-line"></i>Last ${span(d)}</li><li ${d.hasPrev ? '' : 'hidden'}><i class="key-line key-line--dash"></i>Previous ${span(d)}</li></ul>`;
}

function meetTableHtml(d) {
  if (!d.ready) return '<p class="ins-quiet">Waiting for your calendar…</p>';
  const dash = '<span class="muted">–</span>';
  const rows = d.buckets
    .map((k, i) => ({ label: d.weekly ? fmtDate(k.a) : d.R === 7 ? `${k.label} ${fmtDate(k.a)}` : k.label, cur: d.cur[i], prev: d.prevVals[i], n: d.countPer[i] }))
    .reverse();
  const chip = (m) => (Math.round(m) === 0 ? dash : `<span class="delta delta--${m < 0 ? 'up' : 'down'}">${m > 0 ? '+' : '−'}${FMT.hm(Math.abs(m))}</span>`);
  return `<table class="itable"><caption class="sr">Time in meetings per ${d.weekly ? 'week' : 'day'}, last ${span(d)}</caption>
    <thead><tr><th scope="col">${d.weekly ? 'Week of' : 'Day'}</th><th scope="col">Meetings</th><th scope="col">Time</th><th scope="col">Previous</th><th scope="col">Change</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${r.n}</td><td>${FMT.hm(r.cur)}</td><td>${d.hasPrev ? FMT.hm(r.prev) : dash}</td><td>${d.hasPrev ? chip(r.cur - r.prev) : dash}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Total</th><td>${d.count}</td><td>${FMT.hm(d.meetMin)}</td><td>${d.hasPrev ? FMT.hm(d.prevMeetMin) : dash}</td><td>${d.hasPrev ? chip(d.meetMin - d.prevMeetMin) : dash}</td></tr></tfoot></table>`;
}

function mountLiveThru(delay) {
  thruTimer?.kill();
  const make = () => {
    const host = document.querySelector('#i-thru .thru__chart');
    if (!host || thru || !data?.live || !data.ready) return;
    const h = clamp(Math.round(innerWidth * 0.17), 220, 300);
    thru = lineChart(host, { series: liveSeries(data), labels: data.buckets.map((k) => k.label), height: h, fmt: FMT.hm });
    liveSig.thru = JSON.stringify([data.R, data.cur, data.prevVals, data.hasPrev]);
    chartKeys(host, 'Time in meetings chart');
  };
  if (!delay || reduced()) make();
  else thruTimer = gsap.delayedCall(delay, make);
}

function fillThru(d, first) {
  const cardEl = document.getElementById('i-thru');
  if (!cardEl) return;
  qs('[data-thru-sub]', cardEl).textContent = `Meeting hours each ${d.weekly ? 'week' : 'day'}, overlaps counted once`;
  qs('.ins-top', cardEl).innerHTML = meetTopHtml(d);
  qs('.thru__table', cardEl).innerHTML = meetTableHtml(d);
  qs('.ins-none', cardEl).hidden = !d.ready || d.count > 0 || d.meetMin > 0;
  const host = qs('.thru__chart', cardEl);
  if (!d.ready) {
    if (!thru) host.innerHTML = `<div class="ins-chart-skel">${skel(4, 18)}</div>`;
    return;
  }
  if (!thru) mountLiveThru(first ? 0.45 : 0);
  else if (sigChanged('thru', [d.R, d.cur, d.prevVals, d.hasPrev])) thru.update(liveSeries(d), d.buckets.map((k) => k.label));
}

// ---------- busiest days ----------
function fillDays(d) {
  const box = qs('.busy', root);
  if (!box) return;
  const wait = qs('.busy__wait', box);
  const host = qs('.busy__bars', box);
  const top = qs('[data-days-top]', root);
  const any = d.days.some((x) => x.value > 0);
  wait.hidden = d.ready && any;
  host.hidden = !d.ready || !any;
  if (!d.ready || !any) {
    top.innerHTML = '';
    wait.innerHTML = d.ready ? emptyState('No meetings yet', `Nothing on your calendar in the last ${span(d)}.`, 'calendar') : skel(4, 18);
    return;
  }
  const max = Math.max(...d.days.map((x) => x.value));
  const items = d.days.map((x) => ({ label: x.label, value: x.value, highlight: x.value === max }));
  host.setAttribute('aria-label', `Average meeting hours per weekday: ${items.map((x) => `${x.label} ${hfmt(x.value)}`).join(', ')}`);
  if (!busyBars || !host.children.length) {
    busyBars = barChart(host, { items, height: 150, fmt: hfmt, tone: 'indigo' });
    liveSig.days = JSON.stringify(items);
  } else if (sigChanged('days', items)) busyBars.update(items);
  const best = d.days.find((x) => x.value === max);
  top.innerHTML = `<p class="ins-sum"><b>${esc(dayName(best.g, 'long'))}</b><span>is your busiest day, about ${hfmt(best.value)} of meetings</span></p>`;
}

// ---------- who you meet ----------
function whoLegendHtml(d) {
  const total = d.people.reduce((s, x) => s + x.ms, 0) || 1;
  return `<table class="plegend"><caption class="sr">Shared meeting time by person</caption>
    <thead class="sr"><tr><th scope="col">Person</th><th scope="col">Time</th><th scope="col">Share</th></tr></thead>
    <tbody>${d.people
      .map((x, i) => `<tr class="plegend__row hue--${x.tone}" data-i="${i}" tabindex="0" title="${esc(plural(x.n, 'meeting'))} together"><th scope="row"><i aria-hidden="true"></i><span>${esc(x.name)}</span></th><td>${esc(durText(x.ms))}</td><td class="muted">${Math.round((x.ms / total) * 100)}%</td></tr>`)
      .join('')}</tbody></table>`;
}

function fillWho(d, animate) {
  const box = qs('.who', root);
  if (!box || !sigChanged('who', [d.ready, d.R, d.people.map((x) => [x.id, x.name, Math.round(x.ms / MIN)])])) return;
  if (!d.ready || !d.people.length) {
    box.classList.add('is-empty');
    box.innerHTML = d.ready ? emptyState('No one yet', `No shared meetings in the last ${span(d)}.`, 'users') : skel(4, 16);
    return;
  }
  box.classList.remove('is-empty');
  box.innerHTML = `<div class="proj__donut"></div>${whoLegendHtml(d)}`;
  const together = d.people.reduce((s, x) => s + x.ms, 0);
  donutChart(qs('.proj__donut', box), {
    segments: d.people.map((x) => ({ label: x.name, value: x.ms, tone: x.tone })),
    size: 160,
    stroke: 18,
    center: `<b>${esc(durText(together))}</b><span>together</span>`,
  });
  if (animate) fadeUp(qsa('.plegend__row', box), { y: 6, stagger: 0.03 });
}

// ---------- calendar health ----------
function blockHtml(label, b, emptyText) {
  let main;
  let meta;
  if (b === 'weekend') [main, meta] = ['Weekend', 'No working hours today'];
  else if (!b) [main, meta] = ['—', emptyText];
  else [main, meta] = [durText(b.len), `${startOfDay(b.at).getTime() === startOfDay().getTime() ? 'from' : `${weekday(b.at)},`} ${fmtTime(b.at)}`];
  return `<div><dt>${esc(label)}</dt><dd><b>${esc(main)}</b><small>${esc(meta)}</small></dd></div>`;
}

function healthHtml(d) {
  if (!d.ready) return skel(5, 16);
  const h = d.health;
  const tone = h.pct >= 70 ? 'over' : h.pct >= 50 ? 'near' : 'ok';
  return `<div class="hl__gauge is-${tone}">
      <p class="ins-sum"><b>${h.pct}%</b><span>of working hours booked</span></p>
      <div class="hl__bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${h.pct}" aria-label="Working hours booked with meetings, last ${span(d)}"><i style="width:${Math.min(100, h.pct)}%"></i></div>
      <small class="hl__hint">${plural(h.workdays, 'workday')} · ${WORK[0]}:00–${WORK[1]}:00</small>
    </div>
    <dl class="hl__facts">
      ${blockHtml('Longest free block today', h.today, 'Working hours are over')}
      ${blockHtml('Rest of this week', h.week, 'Nothing left this week')}
      <div><dt>Back-to-back</dt><dd><b>${h.b2b}</b><small>${h.b2b === 1 ? 'meeting' : 'meetings'} with 5 min or less between</small></dd></div>
    </dl>
    <a class="hl__invites ${h.invites ? 'is-on' : ''}" href="#/calendar">${icon('calendar')}<span>${
      h.invites ? `<b>${h.invites}</b> ${h.invites === 1 ? 'invitation needs' : 'invitations need'} an answer` : 'No invitations waiting'
    }</span>${icon('chevronRight')}</a>`;
}

function fillHealth(d, animate) {
  const box = qs('.hl', root);
  if (!box || !sigChanged('health', [d.ready, d.R, d.health])) return;
  const old = qs('.hl__bar i', box)?.style.width;
  box.innerHTML = healthHtml(d);
  const bar = qs('.hl__bar i', box);
  if (!bar || reduced()) return;
  if (old && animate) gsap.fromTo(bar, { width: old }, { width: bar.style.width, duration: 0.8, ease: 'power3.inOut' });
  else if (!old) gsap.from(bar, { scaleX: 0, transformOrigin: '0 50%', duration: 1, ease: 'power3.out', delay: 0.35, clearProps: 'transform' });
}

// ---------- inbox ----------
function inboxHtml(d) {
  if (!sourceReady('gmail')) return skel(5, 14);
  const max = Math.max(1, ...d.cats.map((c) => c.n));
  return `<p class="ins-sum"><b>${FMT.int(state.unread || 0)}</b><span>unread now</span></p>
    <h3 class="ibx__h">Last 7 days <span class="faint">· ${plural(d.recentN, 'thread')} of the latest ${state.threads.length}</span></h3>
    <ul class="ibx">${d.cats
      .map((c) => `<li class="ibx__row"><span class="ibx__name">${esc(c.label)}</span>
        <span class="ibx__bar" aria-hidden="true"><i style="width:${(c.n / max) * 100}%"></i></span><b>${c.n}</b><span class="sr">threads, ${c.unread} unread</span></li>`)
      .join('')}</ul>
    <a class="btn btn--ghost btn--sm ibx__open" href="#/inbox">${icon('mail')}Open inbox</a>`;
}

function fillInbox(d) {
  const box = qs('.ibx-box', root);
  if (!box || !sigChanged('inbox', [sourceReady('gmail'), state.unread, d.cats, d.recentN, state.threads.length])) return;
  box.innerHTML = inboxHtml(d);
}

// ---------- page ----------
function fillNotes() {
  qsa('[data-note]', root).forEach((el) => {
    const html = sourceNote(el.dataset.note);
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
    el.hidden = !html;
  });
}

function fillLive(animate, first = false) {
  data = computeLive(range);
  const d = data;
  qs('[data-sub]', root).textContent = span(d);
  if (!first) updateTiles(liveStats(d), d, animate);
  fillNotes();
  fillThru(d, first);
  fillDays(d);
  fillWho(d, animate);
  fillHealth(d, animate);
  fillInbox(d);
}

function renderLive() {
  liveSig = {};
  thru = null;
  busyBars = null;
  thruTimer?.kill();
  data = computeLive(range);
  const d = data;
  const head = pageHead({
    title: 'Insights',
    sub: `Your meetings, tasks and focus over the last <span data-sub>${span(d)}</span>`,
    actions: `${segmented('Range', RANGES, String(range), 'ins-range')}<button type="button" class="btn btn--glass" data-act="csv">${icon('download')}Export CSV</button>`,
  }).trim().replace(/<\/header>$/, `${statsHtml(liveStats(d), d)}</header>`);
  const note = (src) => `<div class="ins-note" data-note="${src}" hidden></div>`;

  root.innerHTML = `${head}<div class="insights insights--live">
    ${card({
      id: 'i-thru', cls: 'ins-thru', title: 'Time in meetings', expand: true,
      sub: '<span data-thru-sub></span>',
      tools: `<button type="button" class="btn btn--glass btn--sm thru__toggle" aria-pressed="${tableOn}" aria-controls="thru-table">${toggleHtml()}</button>`,
      body: `${note('calendar')}<div class="ins-top"></div>
        <div class="thru__views ${tableOn ? 'is-table' : ''}"><div class="thru__chart"></div>
        <div class="ins-none" hidden>${emptyState('No meetings in this window', 'Time spent in meetings will chart here.', 'calendar')}</div>
        <div class="thru__table" id="thru-table" tabindex="0" ${tableOn ? '' : 'hidden'}></div></div>`,
    })}
    ${card({ id: 'i-health', cls: 'ins-health', title: 'Calendar health', sub: 'Booked hours, free time ahead, invitations', body: `${note('calendar')}<div class="hl"></div>` })}
    ${card({
      id: 'i-days', cls: 'ins-days', title: 'Busiest days', sub: 'Average meeting hours per weekday',
      body: `${note('calendar')}<div class="ins-top" data-days-top></div><div class="busy"><div class="busy__wait"></div><div class="busy__bars" role="img" hidden></div></div>`,
    })}
    ${card({ id: 'i-who', cls: 'ins-who', title: 'Who you meet', sub: `Top 5 by shared meeting time, groups under ${BIG_MEETING}`, body: `${note('calendar')}<div class="proj who"></div>` })}
    ${card({ id: 'i-inbox', cls: 'ins-inbox', title: 'Inbox', sub: 'Unread now, recent mail by category', body: `${note('gmail')}<div class="ibx-box"></div>` })}
  </div>`;

  bindSegmented(qs('.ins-range', root), (v) => {
    range = +v;
    fillLive(true);
  });
  fillLive(false, true);
}

function introLive() {
  headIntro(root);
  qsa('.head [data-n]', root).forEach((el) => countTo(el, +el.dataset.n, FMT[el.dataset.f] || FMT.int));
  revealCards(qsa('.card', root), { y: 30, stagger: 0.06, delay: 0.12 });
  fadeUp(qsa('.ins-key li, .hl__facts > div, .ibx__row, .plegend__row', root), { y: 8, stagger: 0.03, delay: 0.4 });
}

// ---------- events ----------
function onClick(e) {
  const el = e.target.closest('[data-act], [data-task], .thru__toggle');
  if (!el) return;
  if (el.classList.contains('thru__toggle')) return toggleTable(el);
  if (el.dataset.task) return openTask(el.dataset.task);
  if (el.dataset.act === 'csv') exportCsv();
}

function onHover(e) {
  const row = e.target.closest?.('.plegend__row');
  if (!row) return hotProject(null);
  hotProject(row.dataset.i, row.closest('.proj'));
}

export const page = {
  title: 'Insights',
  mount(el) {
    root = el;
    root.addEventListener('click', onClick);
    root.addEventListener('pointerover', onHover);
    root.addEventListener('pointerleave', () => hotProject(null));
    root.addEventListener('focusin', onHover);
    root.addEventListener('focusout', () => hotProject(null));
    bindCardExpand(root);
    // The expanded throughput card lives outside the view; route its clicks too.
    document.addEventListener('click', (e) => {
      if (root.contains(e.target)) return;
      const t = e.target.closest('#i-thru .thru__toggle');
      if (t) toggleTable(t);
    });
    const onStore = () => {
      if (root.hidden || !data) return;
      if (isLive()) fillLive(true);
      else refresh(true);
    };
    ['tasks', 'focus', 'members'].forEach((t) => subscribe(t, onStore));
    if (isLive()) ['events', 'threads', 'live', 'settings'].forEach((t) => subscribe(t, onStore));
  },
  enter({ same }) {
    if (same) return;
    if (isLive()) {
      renderLive();
      introLive();
      return;
    }
    render();
    intro();
  },
};
