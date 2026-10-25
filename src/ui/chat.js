// Assistant chat in a drawer. Context is built per message from the live board; the model may propose actions,
// which land in a confirmation tray and only change anything when the user accepts them.
import '../styles/chat.css';
import { esc, icon, uid } from '../lib/dom.js';
import { state, STATUSES, PRIORITIES, task, cardTasks, setTaskStatus, activeBoard, logActivity, commit, boardTasks } from '../store.js';
import { use } from '../live/runtime.js';
import { dayContext } from '../live/ai.js';
import { parseActions, describeAction, ACTION_HELP } from '../lib/actions.js';
import { openDrawer } from './overlays.js';
import { notify } from './island.js';

const history = []; // { role, content, actions?: [{a, state}] }
const keyOf = (s) => s.map(([k]) => k);

/** Excerpts from the user's notes folder that match the question, cited by path. Empty when notes are off. */
async function notesContext(q) {
  try {
    const notes = await use('notes');
    if (!notes) return '';
    const hits = await notes.search(q, 5);
    if (!hits.length) return '';
    return `Excerpts from the user's notes (cite the path when you use one):\n${hits.map((h) => `[${h.path}] ${h.snippet}`).join('\n')}`;
  } catch { return ''; }
}

function system() {
  const tasks = boardTasks().slice(0, 60);
  return [
    'You are the assistant inside a personal work board. Answer briefly, in the user\'s language.',
    `Board "${activeBoard().name}". Lists (key: name): ${STATUSES.map(([k, n]) => `${k}: ${n}`).join(', ')}.`,
    `Tasks on this board (id | list | priority | title):\n${tasks.map((t) => `${t.id} | ${t.status} | ${t.priority} | ${t.title}`).join('\n')}`,
    dayContext(),
    ACTION_HELP,
  ].join('\n\n');
}

async function reply(messages) {
  const ai = await use('ai');
  if (ai) return (await ai.chat(messages, { role: 'chat' })).text;
  const sample = await use('sample');
  if (!sample) throw { code: 'not_granted' };
  const flat = messages.map((m) => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.content}`).join('\n\n');
  return (await sample(flat, { modelTier: 'default' })).text;
}

export function applyAction(a) {
  if (a.type === 'create_task') {
    const t = {
      id: uid('t'), title: a.title.trim(), projectId: null, status: a.status || STATUSES[0][0], priority: a.priority || 'medium', assignee: state.me,
      due: a.due ? new Date(`${a.due}T12:00:00`).getTime() : Date.now() + 2 * 86_400_000, created: Date.now(), doneAt: a.status === 'done' ? Date.now() : null, est: 1,
      order: Math.min(0, ...state.tasks.filter((x) => x.order < 1000).map((x) => x.order)) - 1 - Math.random() * 0.01,
      subtasks: [], comments: [], notes: '', boardId: activeBoard().id,
    };
    state.tasks.push(t);
    logActivity('task', `added “${t.title}”`, null);
    commit('tasks', 'activity');
    return;
  }
  const t = task(a.id);
  if (!t) throw new Error('That task no longer exists');
  if (a.type === 'move_task') setTaskStatus(t, a.status);
  else if (a.type === 'complete_task') setTaskStatus(t, 'done');
  else if (a.type === 'set_priority' && PRIORITIES.includes(a.priority)) { t.priority = a.priority; commit('tasks'); }
}

const titleOf = (id) => task(id)?.title || id;

function trayHtml(m, mi) {
  if (!m.actions?.length) return '';
  return `<ul class="chat__tray" aria-label="Proposed changes">${m.actions.map((x, i) => `<li class="chat__act" data-s="${x.state}">
      <span>${esc(describeAction(x.a, { title: titleOf }))}</span>
      ${x.state === 'pending'
        ? `<button type="button" class="btn btn--sm btn--accent" data-apply="${mi}.${i}">Apply</button><button type="button" class="btn btn--sm btn--glass" data-skip="${mi}.${i}">Skip</button>`
        : `<small>${x.state === 'done' ? 'Applied' : 'Skipped'}</small>`}</li>`).join('')}</ul>`;
}

function render(body, { busy = false, error = '' } = {}) {
  const log = body.querySelector('[data-log]');
  log.innerHTML = history.length
    ? history.map((m, i) => `<div class="chat__msg chat__msg--${m.role}"><p>${esc(m.content).replace(/\n/g, '<br>')}</p>${trayHtml(m, i)}</div>`).join('')
    : '<p class="chat__hint">Ask about your board, or tell me what to add or move. Changes always wait for your OK.</p>';
  if (busy) log.insertAdjacentHTML('beforeend', '<div class="chat__msg chat__msg--assistant"><p class="faint">Thinking…</p></div>');
  if (error) log.insertAdjacentHTML('beforeend', `<div class="chat__msg chat__msg--error"><p>${esc(error)}</p></div>`);
  log.scrollTop = log.scrollHeight;
}

export function openChat() {
  openDrawer(`<h2 class="dr-title">Assistant</h2>
    <div class="chat"><div class="chat__log" data-log aria-live="polite"></div>
    <form class="chat__form" data-form><input class="chat__input" name="q" placeholder="Ask or instruct…" autocomplete="off" aria-label="Message">
    <button type="submit" class="btn btn--accent" aria-label="Send">${icon('send')}</button></form></div>`, {
    label: 'Assistant',
    onMount(body) {
      render(body);
      const input = body.querySelector('.chat__input');
      input.focus();
      body.querySelector('[data-form]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        input.value = '';
        history.push({ role: 'user', content: q });
        render(body, { busy: true });
        try {
          const extra = await notesContext(q);
          const msgs = [{ role: 'system', content: system() + (extra ? `\n\n${extra}` : '') }, ...history.slice(-12).map(({ role, content }) => ({ role, content }))];
          const raw = await reply(msgs);
          const { text, actions } = parseActions(raw, { statuses: keyOf(STATUSES), taskIds: new Set(cardTasks().map((t) => t.id)) });
          history.push({ role: 'assistant', content: text || (actions.length ? 'Here is what I would change:' : '…'), actions: actions.map((a) => ({ a, state: 'pending' })) });
          render(body);
        } catch (err) {
          render(body, { error: err?.code === 'not_granted' ? 'No AI is available in this view.' : err?.message || 'The assistant could not answer.' });
        }
      });
      body.addEventListener('click', (e) => {
        const ap = e.target.closest('[data-apply]'); const sk = e.target.closest('[data-skip]');
        const hit = ap || sk;
        if (!hit) return;
        const [mi, i] = (ap?.dataset.apply || sk.dataset.skip).split('.').map(Number);
        const x = history[mi]?.actions?.[i];
        if (!x || x.state !== 'pending') return;
        try {
          if (ap) { applyAction(x.a); x.state = 'done'; } else x.state = 'skipped';
        } catch (err) { x.state = 'skipped'; notify(err.message, { ico: 'x', tone: 'warn' }); }
        render(body);
      });
    },
  });
}
