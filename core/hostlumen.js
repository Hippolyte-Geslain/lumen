// Local implementation of the "host:lumen" session tools, so the Projects/dock UI works without the Claude desktop bridge.
// Spaces are folders under LUMEN_CODING_ROOT (default ~/coding), same layout the bridge used.
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const err = (code, message) => Object.assign(new Error(message), { code });
const safeName = (n) => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\.{2,}/g, '.').replace(/^[.\s-]+|[.\s]+$/g, '').trim().replace(/\s+/g, '-').slice(0, 60);

export function createHostLumen({ agents, root = process.env.LUMEN_CODING_ROOT || join(homedir(), 'coding'), open = spawn }) {
  const spaces = { perso: join(root, 'perso'), labia: join(root, 'labIa'), laplateforme: join(root, 'laplateforme') };
  const spaceDir = (s) => spaces[s] || (() => { throw err('bad_request', `Unknown space "${s}"`); })();
  const folderPath = (space, folder) => {
    const base = resolve(spaceDir(space)); const name = safeName(folder);
    if (!name) throw err('bad_request', 'Folder name is empty');
    const full = resolve(base, name);
    if (!full.startsWith(base + sep)) throw err('bad_request', 'Folder must stay inside its space');
    return { full, name };
  };
  const view = (r) => ({ ...r, updated: r.updated });
  return {
    tools: {
      bridge_info: async () => ({ version: 'lumen-core', spaces: Object.keys(spaces) }),
      session_status: async () => ({ runs: agents.list().map(view) }),
      ensure_folder: async ({ space, folder }) => { const { full, name } = folderPath(space, folder); mkdirSync(full, { recursive: true }); return { folder: name, path: full }; },
      list_folders: async ({ space }) => {
        const base = spaceDir(space);
        if (!existsSync(base)) return { folders: [] };
        return { folders: readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort() };
      },
      start_session: async (i) => {
        const { full } = folderPath(i.space, i.folder);
        mkdirSync(full, { recursive: true });
        return view(await agents.start({ cardId: i.task_id, title: i.task_title, project: i.project, prompt: i.prompt, repo: full, sessionId: i.resume_session_id }));
      },
      answer: async (i) => view(agents.resume(i.run_id, i.text)),
      stop_session: async (i) => view(agents.stop(i.run_id)),
      open_terminal: async (i) => {
        const r = agents.get(i.run_id);
        const cmd = r.session_id ? `claude --resume ${r.session_id}` : 'claude';
        if (process.platform === 'win32') open('cmd.exe', ['/c', 'start', '""', '/D', r.cwd, 'cmd.exe', '/k', cmd], { detached: true, windowsHide: false }).unref();
        else open(process.platform === 'darwin' ? 'open' : 'x-terminal-emulator', process.platform === 'darwin' ? ['-a', 'Terminal', r.cwd] : ['-e', cmd], { cwd: r.cwd, detached: true }).unref();
        return { ok: true };
      },
    },
  };
}
