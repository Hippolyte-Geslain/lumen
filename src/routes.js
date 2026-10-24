// Route table. Each page module exports `page`:
//   { title: string | (params) => string,
//     mount(viewEl)                      — once, first visit
//     enter({ params, first, same })     — every visit (same = only params changed)
//     leave?() }
export const ROUTES = [
  { name: 'home', title: 'Home', icon: 'home', load: () => import('./pages/home.js') },
  { name: 'inbox', title: 'Inbox', icon: 'mail', load: () => import('./pages/inbox.js') },
  { name: 'tasks', title: 'Tasks', icon: 'tasks', load: () => import('./pages/tasks.js') },
  { name: 'calendar', title: 'Calendar', icon: 'calendar', load: () => import('./pages/calendar.js') },
  { name: 'projects', title: 'Projects', icon: 'folder', load: () => import('./pages/projects.js') },
  { name: 'files', title: 'Files', icon: 'layers', load: () => import('./pages/files.js') },
  { name: 'insights', title: 'Insights', icon: 'chart', load: () => import('./pages/insights.js') },
  { name: 'team', title: 'People', icon: 'users', load: () => import('./pages/team.js') },
  { name: 'settings', title: 'Settings', icon: 'gear', load: () => import('./pages/settings.js') },
];
