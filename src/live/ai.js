// Claude, from the page: `sample` answers with the viewer's own claude.ai
// account. Every call is memoryless, so prompts carry their own data.

import { use } from './runtime.js';
import { state, openTasks, member } from '../store.js';
import { fmtTime, startOfDay } from '../lib/dom.js';

export const aiAvailable = () => use('sample').then(Boolean);

const who = (id) => (id === 'me' ? 'me' : member(id)?.name || id);

export function dayContext() {
  const a = startOfDay().getTime();
  const today = state.events.filter((e) => e.start >= a && e.start < a + 86_400_000);
  const tasks = openTasks('me').slice(0, 15);
  const mail = state.threads.filter((t) => t.unread).slice(0, 12);
  return [
    `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, now ${fmtTime(Date.now())}.`,
    `Meetings today (${today.length}):`,
    ...today.map((e) => `- ${fmtTime(e.start)}–${fmtTime(e.end)} ${e.title}${e.rsvp === 'needsAction' ? ' (not answered)' : ''} with ${e.attendees.filter((x) => x !== 'me').slice(0, 4).map(who).join(', ') || 'no one'}`),
    `Open tasks (${tasks.length}):`,
    ...tasks.map((t) => `- [${t.priority}] ${t.title}${t.due < a ? ' (overdue)' : t.due < a + 86_400_000 ? ' (due today)' : ''}`),
    `Unread mail (${state.unread} total, latest ${mail.length}):`,
    ...mail.map((t) => `- from ${who(t.from)}: ${t.subject} — ${t.snippet.slice(0, 120)}`),
  ].join('\n');
}

/** Streamed answer. onText(fullText). Rejects {code}. */
export async function ask(prompt, { onText, signal, tier = 'default', cache = true } = {}) {
  const sample = await use('sample');
  if (!sample) throw { code: 'not_granted' };
  const res = await sample(prompt, {
    modelTier: tier,
    signal,
    ...(cache ? {} : { cache: false }),
    onText: onText ? ({ text }) => onText(text) : undefined,
  });
  return res.text;
}

export const briefPrompt = () =>
  `You are the assistant inside a personal work dashboard. Write a short morning brief for the user (3 to 5 bullet points, plain text, no headings, under 90 words). Lead with what needs action now: meetings soon, invitations not answered, overdue tasks, mail that looks like it needs a reply. Skip promotions and automated mail. Use the same language as most of the data.\n\n${dayContext()}`;

export const summarizePrompt = (messages) =>
  `Summarize this email thread for a busy reader in 2-3 short sentences, then on a new line starting with "Next:" say what (if anything) the reader should do. Plain text. Reply in the thread's language.\n\n${messages
    .map((m) => `From ${who(m.from)} (${new Date(m.at).toLocaleString()}):\n${m.body.slice(0, 2500)}`)
    .join('\n\n---\n\n')}`;

export const replyPrompt = (messages, intent = '') =>
  `Draft a reply to the last message of this email thread, written as ${state.members[0]?.name || 'the user'}. Match the thread's language and tone, be concise, no subject line, no placeholders like [Name] unless unavoidable, sign with the first name only.${intent ? ` The reply should: ${intent}.` : ''}\n\n${messages
    .slice(-4)
    .map((m) => `From ${who(m.from)}:\n${m.body.slice(0, 2000)}`)
    .join('\n\n---\n\n')}`;

export const aiErrorText = (e) =>
  e?.code === 'not_granted' ? 'Claude isn’t available in this view.'
  : e?.code === 'rate_limited' ? 'You’ve hit a usage limit — try again later.'
  : 'Claude couldn’t answer just now.';
