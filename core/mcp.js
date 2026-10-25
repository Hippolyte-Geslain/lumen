// Connector registry for `mcp.callTool`. A connector is {tools:{name:async(input)=>payload}}.
// Unknown servers fail with server_not_connected.
import { registerPm } from './pm.js';
const err = (code, message) => Object.assign(new Error(message), { code });

const REPO = /^[\w.-]+\/[\w.-]+$/;
const repoOf = (i) => { if (!REPO.test(i?.repo || '') || i.repo.split('/').some((p) => /^\.+$/.test(p))) throw err('bad_request', 'repo must look like owner/name'); return i.repo; };

export function createConnectors({ guard, secrets }) {
  const servers = new Map();
  const register = (name, connector) => servers.set(name, connector);

  const gh = async (path) => {
    const key = secrets.has('github') ? secrets.get('github') : null;
    if (!key) throw err('not_connected', 'Add a GitHub token in Settings');
    const res = await guard.fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/vnd.github+json', 'user-agent': 'lumen' },
    });
    if (res.status === 401) throw err('not_connected', 'GitHub rejected the token');
    if (res.status === 403 || res.status === 429) throw err('rate_limited', 'GitHub rate limit');
    if (!res.ok) throw err('provider_error', `GitHub answered ${res.status}`);
    return res.json();
  };
  register('github', {
    tools: {
      repos: () => gh('/user/repos?sort=pushed&per_page=30'),
      pulls: (i) => gh(`/repos/${repoOf(i)}/pulls?state=open`),
      issues: (i) => gh(`/repos/${repoOf(i)}/issues?state=open`),
    },
  });

  const gl = async (path) => {
    const key = secrets.has('gitlab') ? secrets.get('gitlab') : null;
    if (!key) throw err('not_connected', 'Add a GitLab token in Settings');
    const res = await guard.fetch(`https://gitlab.com/api/v4${path}`, { headers: { authorization: `Bearer ${key}` } });
    if (res.status === 401) throw err('not_connected', 'GitLab rejected the token');
    if (res.status === 429) throw err('rate_limited', 'GitLab rate limit');
    if (!res.ok) throw err('provider_error', `GitLab answered ${res.status}`);
    return res.json();
  };
  // GitLab addresses projects by URL-encoded path (owner%2Fname).
  register('gitlab', {
    tools: {
      projects: () => gl('/projects?membership=true&order_by=last_activity_at&per_page=30'),
      merge_requests: (i) => gl(`/projects/${encodeURIComponent(repoOf(i))}/merge_requests?state=opened`),
      issues: (i) => gl(`/projects/${encodeURIComponent(repoOf(i))}/issues?state=opened`),
    },
  });

  registerPm(register, { guard, secrets });

  return {
    register,
    async callTool(server, tool, input = {}) {
      const c = servers.get(server);
      if (!c) throw err('server_not_connected', `No connector registered for ${server}`);
      const fn = c.tools[tool];
      if (!fn) throw err('not_found', `Unknown tool ${server}/${tool}`);
      return { payload: await fn(input) };
    },
  };
}
