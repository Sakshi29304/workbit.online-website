/* =========================================================
   TaskSphere — Frontend Application Logic
   100% client-side demo build: all "API" calls below are served
   by an in-browser mock backend (see MOCK BACKEND section) that
   persists its data to localStorage. There is no server involved
   — this is a static site you can open straight from a folder or
   host on any static file host (S3, Netlify, GitHub Pages, etc).
   ========================================================= */

// ── Global App State (client-side cache of "server" data) ────
const State = {
  token: null,
  user: null,          // { _id, username, name, email, role, ... }
  tasks: [],            // current user's own tasks
  notes: [],
  alerts: [],
  unreadAlertCount: 0,
  currentView: 'daily',
  calMonth: new Date().getMonth(),
  calYear: new Date().getFullYear(),
  activeNoteId: null,
  reminderTimers: [],
  remindedTaskIds: new Set(),

  // Admin-only caches
  adminUsers: [],
  adminStats: null,
  adminMonitoring: null,
  adminLogs: [],
  adminLogPage: 1,
  adminLogPages: 1,

  // Messages
  conversations: [],
  activeConversationId: null,   // real _id, or 'virtual-support' for a not-yet-created support DM
  activeConversationMeta: null,
  messageDirectory: [],         // admin-only: all non-admin users, for the New Chat picker
  newChatType: 'direct',
  newChatSelectedUserIds: [],
  messagesPollTimer: null,
};

// ════════════════════════════════════════════════════════════
// LIVE BACKEND CLIENT — talks to the real TaskSphere REST API
// running on Elastic Beanstalk. Same method/path contract the
// rest of this file already speaks (api('GET', '/tasks') etc.),
// so nothing below this block had to change.
//
// >>> SET THIS to your Elastic Beanstalk environment URL <<<
// Example: 'http://tasksphere-env.eba-xxxxxxx.us-east-1.elasticbeanstalk.com'
// Do NOT add a trailing slash.
// ════════════════════════════════════════════════════════════
const API_BASE = 'https://api.workbit.online';



async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (State.token) headers['Authorization'] = `Bearer ${State.token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error('Could not reach the server. Please check your connection and try again.');
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    /* empty/non-JSON body */
  }

  if (response.status === 401) {
    showToast(data.message || 'Session expired. Please sign in again.', 'error');
    doLogout(true);
    throw new Error(data.message || 'Session expired. Please sign in again.');
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

// ── Persistence of session across page reloads ──────────────
function saveSession() {
  try {
    sessionStorage.setItem('ts_token', State.token || '');
    sessionStorage.setItem('ts_user', JSON.stringify(State.user || null));
  } catch { /* sessionStorage unavailable — session just won't survive refresh */ }
}
function loadSession() {
  try {
    const t = sessionStorage.getItem('ts_token');
    const u = sessionStorage.getItem('ts_user');
    if (t && u) {
      State.token = t;
      State.user = JSON.parse(u);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
function clearSession() {
  try {
    sessionStorage.removeItem('ts_token');
    sessionStorage.removeItem('ts_user');
  } catch { /* ignore */ }
  State.token = null;
  State.user = null;
}


// ── Auth Screen ──────────────────────────────────────────────
let selectedRole = 'user';
function selectRole(role) {
  selectedRole = role;
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected-user', 'selected-admin'));
  const btn = document.querySelector(`.role-btn[data-role="${role}"]`);
  if (btn) btn.classList.add(role === 'user' ? 'selected-user' : 'selected-admin');
}

async function doLogin(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    showToast('Enter both username and password.', 'error');
    return;
  }

  try {
    const data = await api('POST', '/auth/login', { username, password });
    State.token = data.token;
    State.user = data.user;
    saveSession();

    if (data.user.mustChangePassword) {
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('force-pw-screen').classList.remove('hidden');
      return;
    }

    await launchApp();
  } catch (err) {
    showToast(err.message || 'Login failed.', 'error');
  }
}

// ── Auth screen switching ───────────────────────────────────
function hideAllAuthScreens() {
  ['auth-screen', 'signup-screen', 'forgot-password-screen', 'reset-password-screen'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}
function showSignup(e) {
  if (e) e.preventDefault();
  hideAllAuthScreens();
  document.getElementById('signup-screen').classList.remove('hidden');
}
function showLogin(e) {
  if (e) e.preventDefault();
  hideAllAuthScreens();
  document.getElementById('auth-screen').classList.remove('hidden');
}
function showForgotPassword(e) {
  if (e) e.preventDefault();
  hideAllAuthScreens();
  document.getElementById('forgot-password-screen').classList.remove('hidden');
}

// ── Forgot / reset password ──────────────────────────────────
async function doForgotPassword(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) {
    showToast('Enter your email.', 'error');
    return;
  }
  try {
    const data = await api('POST', '/auth/forgot-password', { email });
    showToast(data.message || 'If that email exists, a reset link has been sent.', 'success');
    showLogin();
  } catch (err) {
    showToast(err.message || 'Could not send reset link.', 'error');
  }
}

// Holds the token pulled from the ?resetToken= URL param, set on page load.
let pendingResetToken = null;

async function doResetPassword(e) {
  if (e) e.preventDefault();
  const newPassword = document.getElementById('reset-pw-new').value;
  const confirmPassword = document.getElementById('reset-pw-confirm').value;

  if (!newPassword || !confirmPassword) {
    showToast('Fill in both fields.', 'error');
    return;
  }
  if (newPassword.length < 8) {
    showToast('Password must be at least 8 characters.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match.', 'error');
    return;
  }
  if (!pendingResetToken) {
    showToast('This reset link is invalid or has expired.', 'error');
    return;
  }

  try {
    const data = await api('POST', '/auth/reset-password', { token: pendingResetToken, newPassword });
    showToast(data.message || 'Password reset. You can now sign in.', 'success');
    pendingResetToken = null;
    // Drop the token from the URL so a refresh doesn't re-show this screen.
    window.history.replaceState({}, document.title, window.location.pathname);
    showLogin();
  } catch (err) {
    showToast(err.message || 'Could not reset password.', 'error');
  }
}
async function doSignup(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  if (!name || !username || !email || !password) {
    showToast('Please fill in every field.', 'error');
    return;
  }
  if (password.length < 8) {
    showToast('Password must be at least 8 characters.', 'error');
    return;
  }

  try {
    const data = await api('POST', '/auth/signup', { name, username, email, password });
    State.token = data.token;
    State.user = data.user;
    saveSession();
    hideAllAuthScreens();
    await launchApp();
    showToast(`Welcome to TaskSphere, ${data.user.name}!`, 'success');
  } catch (err) {
    showToast(err.message || 'Sign up failed.', 'error');
  }
}

async function doForcePasswordChange() {
  const currentPassword = document.getElementById('force-pw-current').value;
  const newPassword = document.getElementById('force-pw-new').value;
  if (!currentPassword || !newPassword) {
    showToast('Fill in both fields.', 'error');
    return;
  }
  if (newPassword.length < 8) {
    showToast('New password must be at least 8 characters.', 'error');
    return;
  }
  try {
    await api('POST', '/auth/change-password', { currentPassword, newPassword });
    State.user.mustChangePassword = false;
    saveSession();
    showToast('Password updated. Welcome to TaskSphere!', 'success');
    document.getElementById('force-pw-screen').classList.add('hidden');
    await launchApp();
  } catch (err) {
    showToast(err.message || 'Could not update password.', 'error');
  }
}

async function doLogout(silent) {
  try {
    if (State.token) await api('POST', '/auth/logout');
  } catch { /* best-effort */ }

  clearReminderTimers();
  clearSession();
  State.tasks = [];
  State.notes = [];
  State.alerts = [];
  State.adminUsers = [];
  State.conversations = [];
  State.activeConversationId = null;
  State.activeConversationMeta = null;
  State.messageDirectory = [];
  if (State.messagesPollTimer) { clearInterval(State.messagesPollTimer); State.messagesPollTimer = null; }

  document.getElementById('app').classList.add('hidden');
  document.getElementById('force-pw-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';

  if (!silent) showToast('Signed out.', 'info');
}

// ── App Launch (after successful login) ─────────────────────
async function launchApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('force-pw-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  buildSidebar();

  // Load this user's own data
  await Promise.all([
    loadTasks(),
    loadNotes(),
    loadAlerts(),
    loadConversations(),
  ]);

  if (State.user.role === 'Admin') {
    document.getElementById('nav-admin').classList.remove('hidden');
    document.getElementById('btn-new-message').classList.remove('hidden');
  }

  if (State.messagesPollTimer) clearInterval(State.messagesPollTimer);
  State.messagesPollTimer = setInterval(loadConversations, 15000);

  scheduleReminders();
  navigateTo('dashboard');
}

// Resume session on page load (e.g. after a refresh)
window.addEventListener('DOMContentLoaded', () => {
  setupToastContainer();

  // If this page load came from a "reset your password" email link,
  // jump straight to the reset-password screen instead of the login screen.
  const urlToken = new URLSearchParams(window.location.search).get('resetToken');
  if (urlToken) {
    pendingResetToken = urlToken;
    hideAllAuthScreens();
    document.getElementById('reset-password-screen').classList.remove('hidden');
    return;
  }

  if (loadSession()) {
    launchApp().catch(() => doLogout(true));
  }
});

// ── Sidebar / Navigation ─────────────────────────────────────
function buildSidebar() {
  const u = State.user;
  document.getElementById('sidebar-avatar').textContent = (u.name || '?').charAt(0).toUpperCase();
  document.getElementById('sidebar-user-name').textContent = u.name;
  document.getElementById('sidebar-user-role').textContent = u.role;
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  if (page === 'dashboard') renderDashboard();
  if (page === 'profile')   renderProfile();
  if (page === 'calendar')  renderCalendar();
  if (page === 'notes')     renderNotes();
  if (page === 'analytics') renderAnalytics();
  if (page === 'admin')     renderAdmin();
  if (page === 'messages')  renderMessages();
}

// ── Tasks: load from API ─────────────────────────────────────
async function loadTasks() {
  try {
    const data = await api('GET', '/tasks');
    State.tasks = data.tasks || [];
  } catch (err) {
    showToast(err.message || 'Failed to load tasks.', 'error');
  }
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  updateStats();
  renderAlertBanners();
  renderTasks();
}

function updateStats() {
  const tasks = State.tasks;
  const total = tasks.length;
  const done  = tasks.filter(t => t.done).length;
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  const dueToday = tasks.filter(t => {
    const d = new Date(t.deadline);
    return d >= today && d < tomorrow && !t.done;
  }).length;

  const urgent = tasks.filter(t => !t.done && getUrgencyLevel(t) === 'urgent').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-done').textContent  = done;
  document.getElementById('stat-today').textContent = dueToday;
  document.getElementById('stat-urgent').textContent = urgent;
}

function getUrgencyLevel(task) {
  if (task.done) return 'none';
  const now = new Date();
  const deadline = new Date(task.deadline);
  const diffMs = deadline - now;
  const diffHrs = diffMs / (1000 * 60 * 60);
  if (diffMs < 0) return 'overdue';
  if (diffHrs <= 2) return 'urgent';
  if (diffHrs <= 24) return 'soon';
  return 'normal';
}

function getTasksForRange(view) {
  const now = new Date();
  const tasks = State.tasks;

  if (view === 'daily') {
    const today = new Date(now); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    return tasks.filter(t => {
      const d = new Date(t.deadline);
      return d >= today && d < tomorrow;
    });
  }
  if (view === 'weekly') {
    const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - start.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 7);
    return tasks.filter(t => {
      const d = new Date(t.deadline);
      return d >= start && d < end;
    });
  }
  // monthly
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return tasks.filter(t => {
    const d = new Date(t.deadline);
    return d >= start && d < end;
  });
}

function getFilteredTasks() {
  return getTasksForRange(State.currentView);
}

function setView(view) {
  State.currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.view-tab[data-view="${view}"]`).classList.add('active');
  renderTasks();
}

function renderTasks() {
  const container = document.getElementById('task-lists');
  const tasks = getFilteredTasks().sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  if (tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🌤️</span>
        <h4>Nothing scheduled here</h4>
        <p>Enjoy the calm, or add a new task to get started.</p>
      </div>`;
    return;
  }

  const pending = tasks.filter(t => !t.done);
  const completed = tasks.filter(t => t.done);

  let html = '';
  if (pending.length) html += createTaskSection('Active', pending);
  if (completed.length) html += createTaskSection('Completed', completed);
  container.innerHTML = html;
}

function createTaskSection(label, tasks) {
  return `
    <div class="tasks-section">
      <div class="tasks-section-title">${escHtml(label)} <span class="badge badge-lav">${tasks.length}</span></div>
      <div class="task-list">
        ${tasks.map(createTaskEl).join('')}
      </div>
    </div>`;
}

function createTaskEl(task) {
  const urgency = getUrgencyLevel(task);
  const priorityColors = { high: 'peach', medium: 'yellow', low: 'mint' };
  const pColor = priorityColors[task.priority] || 'sky';
  const deadlineStr = formatDeadline(task.deadline);

  return `
    <div class="task-item ${task.done ? 'done' : ''}" onclick="openEditTask('${task._id}', event)">
      <div class="task-check" onclick="toggleTask('${task._id}', event)">✓</div>
      <div class="task-body">
        <div class="task-title">${escHtml(task.title)}</div>
        ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          <span class="badge badge-${pColor}">${task.priority}</span>
          <span class="task-deadline ${urgency === 'urgent' || urgency === 'overdue' ? 'urgent' : ''}">🕐 ${deadlineStr}</span>
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditTask('${task._id}', event)" title="Edit">✏️</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteTask('${task._id}', event)" title="Delete">🗑️</button>
      </div>
    </div>`;
}

function formatDeadline(d) {
  const date = new Date(d);
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((dd - today) / 86400000);
  const timeStr = date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `Today ${timeStr}`;
  if (diff === 1) return `Tomorrow ${timeStr}`;
  if (diff === -1) return `Yesterday ${timeStr}`;
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' + timeStr;
}

async function toggleTask(id, e) {
  if (e) e.stopPropagation();
  const task = State.tasks.find(t => t._id === id);
  if (!task) return;
  const wasUndone = !task.done;
  try {
    const data = await api('PUT', `/tasks/${id}`, { done: !task.done });
    Object.assign(task, data.task);
    renderDashboard();
    if (wasUndone && task.done) showCelebration();
    if (document.getElementById('page-analytics').classList.contains('active')) renderAnalytics();
  } catch (err) {
    showToast(err.message || 'Could not update task.', 'error');
  }
}

async function deleteTask(id, e) {
  if (e) e.stopPropagation();
  try {
    await api('DELETE', `/tasks/${id}`);
    State.tasks = State.tasks.filter(t => t._id !== id);
    renderDashboard();
    showToast('Task deleted.', 'info');
  } catch (err) {
    showToast(err.message || 'Could not delete task.', 'error');
  }
}

// ── Task Modal ────────────────────────────────────────────────
function openAddTask() {
  document.getElementById('task-modal-title').textContent = 'Add Task';
  document.getElementById('task-id').value = '';
  document.getElementById('task-title-input').value = '';
  document.getElementById('task-desc-input').value = '';
  document.getElementById('task-priority-input').value = 'medium';

  const defaultDeadline = new Date(Date.now() + 60 * 60 * 1000);
  document.getElementById('task-deadline-input').value = toLocalDatetimeInputValue(defaultDeadline);

  openModal('task-modal');
}

function openEditTask(id, e) {
  if (e) e.stopPropagation();
  const task = State.tasks.find(t => t._id === id);
  if (!task) return;

  document.getElementById('task-modal-title').textContent = 'Edit Task';
  document.getElementById('task-id').value = task._id;
  document.getElementById('task-title-input').value = task.title;
  document.getElementById('task-desc-input').value = task.description || '';
  document.getElementById('task-priority-input').value = task.priority;
  document.getElementById('task-deadline-input').value = toLocalDatetimeInputValue(new Date(task.deadline));

  openModal('task-modal');
}

function toLocalDatetimeInputValue(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function saveTask() {
  const id = document.getElementById('task-id').value;
  const title = document.getElementById('task-title-input').value.trim();
  const description = document.getElementById('task-desc-input').value.trim();
  const priority = document.getElementById('task-priority-input').value;
  const deadlineRaw = document.getElementById('task-deadline-input').value;

  if (!title) { showToast('Task title is required.', 'error'); return; }
  if (!deadlineRaw) { showToast('Deadline is required.', 'error'); return; }

  const payload = { title, description, priority, deadline: new Date(deadlineRaw).toISOString() };

  try {
    if (id) {
      const data = await api('PUT', `/tasks/${id}`, payload);
      const idx = State.tasks.findIndex(t => t._id === id);
      if (idx !== -1) State.tasks[idx] = data.task;
      showToast('Task updated.', 'success');
    } else {
      const data = await api('POST', '/tasks', payload);
      State.tasks.push(data.task);
      showToast('Task added.', 'success');
    }
    closeModal('task-modal');
    renderDashboard();
    scheduleReminders();
    if (document.getElementById('page-calendar').classList.contains('active')) renderCalendar();
  } catch (err) {
    showToast(err.message || 'Could not save task.', 'error');
  }
}

// ── Deadline Reminders (10 min before due) ──────────────────
function clearReminderTimers() {
  State.reminderTimers.forEach(t => clearTimeout(t));
  State.reminderTimers = [];
}

function scheduleReminders() {
  clearReminderTimers();
  const now = Date.now();
  State.tasks.forEach(task => {
    if (task.done) return;
    const deadline = new Date(task.deadline).getTime();
    const reminderTime = deadline - 10 * 60 * 1000;
    const msUntil = reminderTime - now;
    // Only schedule reminders within the next 24h to avoid piling up huge timeouts
    if (msUntil > 0 && msUntil < 24 * 60 * 60 * 1000 && !State.remindedTaskIds.has(task._id)) {
      const timer = setTimeout(() => showReminder(task), msUntil);
      State.reminderTimers.push(timer);
    }
  });
}

function showReminder(task) {
  State.remindedTaskIds.add(task._id);
  showToast(`⏰ "${task.title}" is due in 10 minutes!`, 'warning');
}

// ── Completion Celebration ───────────────────────────────────
const CELEBRATIONS = [
  "Nice work! 🎉", "Crushing it! 💪", "Boom, done! ✨",
  "One step closer! 🚀", "You're on fire! 🔥", "Task conquered! 🏆",
];
function showCelebration() {
  const msg = CELEBRATIONS[Math.floor(Math.random() * CELEBRATIONS.length)];
  showToast(msg, 'success');
  launchConfetti();
}
function launchConfetti() {
  const colors = ['#B8F0D8', '#D4C8F5', '#FFD8C2', '#C2E4FF', '#FFF0A8'];
  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('div');
    piece.style.position = 'fixed';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.top = '-20px';
    piece.style.width = '8px';
    piece.style.height = '8px';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.zIndex = '1999';
    piece.style.animation = `confettiFall ${1.5 + Math.random()}s ease-in forwards`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 2600);
  }
}

// ── Profile ───────────────────────────────────────────────────
function renderProfile() {
  const u = State.user;
  document.getElementById('profile-avatar').textContent = (u.name || '?').charAt(0).toUpperCase();
  document.getElementById('profile-name-display').textContent = u.name;
  document.getElementById('profile-role-display').textContent = u.role;
  document.getElementById('profile-field-name').value     = u.name || '';
  document.getElementById('profile-field-email').value    = u.email || '';
  document.getElementById('profile-field-phone').value    = u.phone || '';
  document.getElementById('profile-field-location').value = u.location || '';
}

async function saveProfile() {
  const payload = {
    name:     document.getElementById('profile-field-name').value.trim(),
    email:    document.getElementById('profile-field-email').value.trim(),
    phone:    document.getElementById('profile-field-phone').value.trim(),
    location: document.getElementById('profile-field-location').value.trim(),
  };
  if (!payload.name || !payload.email) {
    showToast('Name and email are required.', 'error');
    return;
  }
  try {
    const data = await api('PUT', '/users/profile', payload);
    State.user = data.user;
    saveSession();
    buildSidebar();
    renderProfile();
    showToast('Profile updated.', 'success');
  } catch (err) {
    showToast(err.message || 'Could not update profile.', 'error');
  }
}

async function changePassword() {
  const currentPassword = document.getElementById('profile-current-password').value;
  const newPassword     = document.getElementById('profile-new-password').value;
  if (!currentPassword || !newPassword) {
    showToast('Fill in both password fields.', 'error');
    return;
  }
  if (newPassword.length < 8) {
    showToast('New password must be at least 8 characters.', 'error');
    return;
  }
  try {
    await api('POST', '/auth/change-password', { currentPassword, newPassword });
    document.getElementById('profile-current-password').value = '';
    document.getElementById('profile-new-password').value = '';
    showToast('Password updated.', 'success');
  } catch (err) {
    showToast(err.message || 'Could not update password.', 'error');
  }
}

// ── Calendar ──────────────────────────────────────────────────
function renderCalendar() {
  buildCalGrid();
}

function changeCalMonth(delta) {
  State.calMonth += delta;
  if (State.calMonth > 11) { State.calMonth = 0; State.calYear++; }
  if (State.calMonth < 0)  { State.calMonth = 11; State.calYear--; }
  buildCalGrid();
}

function buildCalGrid() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month-title').textContent = `${monthNames[State.calMonth]} ${State.calYear}`;

  const grid = document.getElementById('cal-days-grid');
  grid.innerHTML = '';

  const firstDay = new Date(State.calYear, State.calMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(State.calYear, State.calMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(State.calYear, State.calMonth, 0).getDate();

  // Previous month padding
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(State.calYear, State.calMonth - 1, daysInPrevMonth - i);
    grid.appendChild(makeDayEl(d, true));
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    grid.appendChild(makeDayEl(new Date(State.calYear, State.calMonth, d), false));
  }
  // Next month padding to complete the grid (multiple of 7)
  const totalCells = startOffset + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    grid.appendChild(makeDayEl(new Date(State.calYear, State.calMonth + 1, d), true));
  }
}

function makeDayEl(date, other) {
  const el = document.createElement('div');
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  el.className = 'cal-day' + (other ? ' other-month' : '') + (isToday ? ' today' : '');

  const numEl = document.createElement('div');
  numEl.className = 'cal-day-num';
  numEl.textContent = date.getDate();
  el.appendChild(numEl);

  const dayTasks = State.tasks.filter(t => new Date(t.deadline).toDateString() === date.toDateString());
  const chipColors = { high: '#FFD8C2', medium: '#FFF0A8', low: '#B8F0D8' };
  const chipText   = { high: '#A04010', medium: '#806010', low: '#2E7D5A' };

  dayTasks.slice(0, 3).forEach(t => {
    const chip = document.createElement('div');
    chip.className = 'cal-task-chip';
    chip.style.cssText = `background:${chipColors[t.priority] || '#D4C8F5'};color:${chipText[t.priority] || '#6040B0'};${t.done ? 'text-decoration:line-through;opacity:0.6;' : ''}`;
    chip.textContent = t.title;
    chip.title = t.title;
    el.appendChild(chip);
  });
  if (dayTasks.length > 3) {
    const more = document.createElement('div');
    more.style.cssText = 'font-size:10px;color:#9A9A97;padding:1px 4px;';
    more.textContent = `+${dayTasks.length - 3} more`;
    el.appendChild(more);
  }

  el.onclick = () => renderDayTaskList(date);
  return el;
}

function renderDayTaskList(date) {
  document.getElementById('cal-date-label').textContent = date.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const dayTasks = State.tasks.filter(t => new Date(t.deadline).toDateString() === date.toDateString());
  const container = document.getElementById('cal-day-tasks');

  if (!dayTasks.length) {
    container.innerHTML = `<div class="empty-state" style="padding:30px"><span class="empty-icon">📋</span><p>No tasks this day</p></div>`;
  } else {
    container.innerHTML = dayTasks.map(createTaskEl).join('');
  }
  openModal('cal-day-modal');
}

// ════════════════════════════════════════════════════════════
// ADMIN PANEL
// Scope (by design): Analytics, Monitoring, Database/Logs, and
// User Management (add/delete user, toggle role, send alert,
// view a user's tasks read-only). Admin does NOT create/edit/
// delete tasks on a user's behalf — that stays the user's own.
// ════════════════════════════════════════════════════════════

async function renderAdmin() {
  if (State.user.role !== 'Admin') return;
  await Promise.all([
    loadAdminStats(),
    loadAdminMonitoring(),
    loadAdminUsers(),
    loadAdminLogs(1),
  ]);
}

// ── Analytics ──
async function loadAdminStats() {
  try {
    const data = await api('GET', '/admin/stats');
    State.adminStats = data.stats;
    renderAdminStats();
  } catch (err) {
    showToast(err.message || 'Failed to load analytics.', 'error');
  }
}

function renderAdminStats() {
  const s = State.adminStats;
  if (!s) return;
  document.getElementById('admin-stat-users').textContent  = s.totalUsers;
  document.getElementById('admin-stat-online').textContent = s.onlineUsers;
  document.getElementById('admin-stat-tasks').textContent  = s.totalTasks;
  document.getElementById('admin-stat-done').textContent   = s.doneTasks;
  document.getElementById('admin-stat-admins').textContent  = s.adminCount;
  document.getElementById('admin-stat-regular').textContent = s.regularUsers;
  document.getElementById('admin-stat-pending').textContent = s.pendingTasks;
  document.getElementById('admin-stat-alerts').textContent  = s.totalAlerts;
  document.getElementById('admin-stat-unread-alerts').textContent = s.unreadAlerts;

  const bars = document.getElementById('admin-completion-bars');
  const priorities = ['high', 'medium', 'low'];
  const labels = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
  bars.innerHTML = priorities.map(p => {
    const stat = s.byPriority[p] || { total: 0, done: 0 };
    const pct = stat.total ? Math.round((stat.done / stat.total) * 100) : 0;
    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${labels[p]}</span><span style="color:var(--gray-400)">${stat.done}/${stat.total} (${pct}%)</span>
        </div>
        <div style="height:8px;background:var(--gray-100);border-radius:var(--r-full);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--lav-dark);border-radius:var(--r-full)"></div>
        </div>
      </div>`;
  }).join('');

  drawAdminTrendChart(s.trend || []);
  drawAdminRolesDonut(s.roleCounts || { Admin: 0, User: 0 });
  renderAdminTopUsers(s.topUsers || []);
  renderAdminActivityHeatmap(s.heatmap || []);
}

// ── Trend chart: tasks created vs completed, last 14 days ──
function drawAdminTrendChart(trend) {
  const canvas = document.getElementById('admin-trend-chart');
  if (!canvas || !trend.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 460, h = 180;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const padL = 28, padR = 10, padT = 12, padB = 22;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxVal = Math.max(1, ...trend.map(t => Math.max(t.created, t.completed)));
  const stepX = plotW / (trend.length - 1 || 1);

  // gridlines
  ctx.strokeStyle = '#EBEBEA';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padT + (plotH / 3) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }
  ctx.fillStyle = '#9A9A97';
  ctx.font = '10px DM Sans, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const val = Math.round(maxVal - (maxVal / 3) * i);
    ctx.fillText(val, padL - 6, padT + (plotH / 3) * i + 3);
  }

  const plotLine = (key, color) => {
    ctx.beginPath();
    trend.forEach((t, i) => {
      const x = padL + stepX * i;
      const y = padT + plotH - (t[key] / maxVal) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    trend.forEach((t, i) => {
      const x = padL + stepX * i;
      const y = padT + plotH - (t[key] / maxVal) * plotH;
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    });
  };
  plotLine('created', '#82BEED');
  plotLine('completed', '#7DD8B0');

  // x-axis labels: every ~4th day
  ctx.fillStyle = '#9A9A97';
  ctx.textAlign = 'center';
  trend.forEach((t, i) => {
    if (i % 3 !== 0 && i !== trend.length - 1) return;
    const x = padL + stepX * i;
    const d = new Date(t.date);
    ctx.fillText(d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), x, h - 6);
  });
}

// ── Roles donut: Admin vs User split ──
function drawAdminRolesDonut(roleCounts) {
  const canvas = document.getElementById('admin-roles-donut');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 140;
  canvas.width = size; canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  const total = (roleCounts.Admin || 0) + (roleCounts.User || 0);
  const cx = size / 2, cy = size / 2, rOuter = 62, rInner = 38;
  const colors = { Admin: '#A98EE8', User: '#82BEED' };

  if (total === 0) {
    ctx.beginPath(); ctx.arc(cx, cy, rOuter, 0, Math.PI * 2); ctx.fillStyle = '#EBEBEA'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
    return;
  }
  let startAngle = -Math.PI / 2;
  ['Admin', 'User'].forEach(key => {
    const val = roleCounts[key] || 0;
    if (!val) return;
    const sliceAngle = (val / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rOuter, startAngle, startAngle + sliceAngle);
    ctx.closePath(); ctx.fillStyle = colors[key]; ctx.fill();
    startAngle += sliceAngle;
  });
  ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.fillStyle = '#1A1A18';
  ctx.font = '600 18px DM Sans, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy);

  const legend = document.getElementById('admin-roles-legend');
  if (legend) {
    legend.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:6px">
        <span style="width:10px;height:10px;border-radius:3px;background:${colors.Admin};display:inline-block"></span>
        Admins <strong style="margin-left:auto">${roleCounts.Admin || 0}</strong>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px">
        <span style="width:10px;height:10px;border-radius:3px;background:${colors.User};display:inline-block"></span>
        Users <strong style="margin-left:auto">${roleCounts.User || 0}</strong>
      </div>`;
  }
}

// ── Top users leaderboard (by tasks completed) ──
function renderAdminTopUsers(topUsers) {
  const container = document.getElementById('admin-top-users');
  if (!container) return;
  if (!topUsers.length) {
    container.innerHTML = `<p style="font-size:13px;color:var(--gray-400)">No user activity yet.</p>`;
    return;
  }
  const maxDone = Math.max(1, ...topUsers.map(u => u.done));
  container.innerHTML = topUsers.map(u => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span>${escHtml(u.name)} <span style="color:var(--gray-400)">${u.role === 'Admin' ? '🛡️' : ''}</span></span>
        <span style="color:var(--gray-400)">${u.done}/${u.total} done</span>
      </div>
      <div style="height:8px;background:var(--gray-100);border-radius:var(--r-full);overflow:hidden">
        <div style="height:100%;width:${(u.done / maxDone) * 100}%;background:var(--mint-dark);border-radius:var(--r-full)"></div>
      </div>
    </div>`).join('');
}

// ── Platform-wide activity heatmap (last 35 days) ──
function renderAdminActivityHeatmap(heatmap) {
  const container = document.getElementById('admin-activity-heatmap');
  if (!container) return;
  container.style.display = 'grid';
  container.style.gridTemplateColumns = 'repeat(7, 1fr)';
  container.style.gap = '4px';
  const maxCount = Math.max(1, ...heatmap.map(h => h.count));
  container.innerHTML = heatmap.map(h => {
    const intensity = h.count === 0 ? 0 : h.count / maxCount;
    const bg = intensity === 0 ? '#EBEBEA' : `rgba(130,190,237,${0.25 + intensity * 0.75})`;
    return `<div title="${new Date(h.date).toLocaleDateString()}: ${h.count} events" style="width:100%;padding-bottom:100%;position:relative;border-radius:3px;background:${bg}"></div>`;
  }).join('');
}

// ── Monitoring ──
async function loadAdminMonitoring() {
  try {
    const data = await api('GET', '/admin/monitoring');
    State.adminMonitoring = data.monitoring;
    renderAdminMonitoring();
  } catch (err) {
    showToast(err.message || 'Failed to load monitoring data.', 'error');
  }
}

function renderAdminMonitoring() {
  const m = State.adminMonitoring;
  if (!m) return;

  const dot = document.getElementById('monitor-db-dot');
  dot.className = 'db-status-dot ' + (m.dbConnected ? 'up' : 'down');
  document.getElementById('monitor-db-status').textContent = m.dbConnected ? 'Connected' : 'Disconnected';
  document.getElementById('monitor-db-name').textContent = m.dbName || '—';
  document.getElementById('monitor-uptime').textContent = formatUptime(m.serverUptimeSeconds);
  document.getElementById('monitor-timestamp').textContent = new Date(m.timestamp).toLocaleTimeString();

  const list = document.getElementById('monitor-online-list');
  if (!m.onlineUsers || !m.onlineUsers.length) {
    list.innerHTML = `<p style="font-size:13px;color:var(--gray-400)">No users currently online.</p>`;
  } else {
    list.innerHTML = m.onlineUsers.map(u => `
      <div class="monitor-row">
        <span><span class="online-dot online"></span>${escHtml(u.name)} <span style="color:var(--gray-400)">(${escHtml(u.username)})</span></span>
        <span class="monitor-value">${u.role}</span>
      </div>`).join('');
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// ── Database / Full Activity Log ──
async function loadAdminLogs(page) {
  try {
    const data = await api('GET', `/admin/activity?page=${page}&limit=20`);
    State.adminLogs = data.logs || [];
    State.adminLogPage = data.pagination.page;
    State.adminLogPages = data.pagination.pages || 1;
    renderAdminLogs();
  } catch (err) {
    showToast(err.message || 'Failed to load activity logs.', 'error');
  }
}

function changeLogPage(delta) {
  const next = State.adminLogPage + delta;
  if (next < 1 || next > State.adminLogPages) return;
  loadAdminLogs(next);
}

function renderAdminLogs() {
  document.getElementById('log-page-label').textContent = `${State.adminLogPage} of ${State.adminLogPages}`;
  const list = document.getElementById('activity-log-list');

  if (!State.adminLogs.length) {
    list.innerHTML = `<p style="font-size:13px;color:var(--gray-400);text-align:center;padding:20px 0">No activity recorded yet.</p>`;
    return;
  }

  list.innerHTML = State.adminLogs.map(log => `
    <div class="activity-item">
      <span class="activity-dot"></span>
      <div style="flex:1">
        <div style="font-size:13px">${escHtml(log.action)}</div>
        <div style="font-size:11px;color:var(--gray-400)">
          ${log.userId ? escHtml(log.userId.name || log.userId.username || 'Unknown user') + ' · ' : ''}${new Date(log.createdAt).toLocaleString()}
        </div>
      </div>
    </div>`).join('');
}

// ── User Management ──
async function loadAdminUsers() {
  try {
    const data = await api('GET', '/admin/users');
    State.adminUsers = data.users || [];
    renderAdminUsersTable();
  } catch (err) {
    showToast(err.message || 'Failed to load users.', 'error');
  }
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('admin-users-tbody');
  tbody.innerHTML = State.adminUsers.map(u => `
    <tr>
      <td>
        <div class="flex items-center gap-1">
          <div class="user-avatar" style="width:28px;height:28px;font-size:12px">${(u.name || '?').charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-weight:500">${escHtml(u.name)}</div>
            <div style="font-size:11px;color:var(--gray-400)">@${escHtml(u.username)}</div>
          </div>
        </div>
      </td>
      <td>${escHtml(u.email)}</td>
      <td><span class="badge ${u.role === 'Admin' ? 'badge-lav' : 'badge-mint'}">${u.role}</span></td>
      <td><span class="online-dot ${u.online ? 'online' : 'offline'}"></span>${u.online ? 'Online' : 'Offline'}</td>
      <td>${u.taskDone}/${u.taskTotal}</td>
      <td style="font-size:12px;color:var(--gray-400)">${new Date(u.createdAt).toLocaleDateString()}</td>
      <td>
        <div class="flex gap-1" style="flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="viewUserTasks('${u._id}')" title="View tasks (read-only)">📋</button>
          <button class="btn btn-ghost btn-sm" onclick="openSendAlertModal('${u._id}', '${escHtml(u.name).replace(/'/g, "\\'")}')" title="Send alert">🔔</button>
          ${u._id !== State.user._id ? `
            <button class="btn btn-ghost btn-sm" onclick="adminToggleRole('${u._id}', '${u.role}')" title="Toggle role">🔄</button>
            <button class="btn btn-danger btn-sm" onclick="confirmDeleteUser('${u._id}', '${escHtml(u.name).replace(/'/g, "\\'")}')" title="Delete user">🗑️</button>
          ` : `<span style="font-size:11px;color:var(--gray-300)">(you)</span>`}
        </div>
      </td>
    </tr>`).join('');
}

// ── Add User (the ONLY way new accounts get created) ──
function openAddUserModal() {
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-email').value = '';
  document.getElementById('new-user-role').value = 'User';
  document.getElementById('new-user-password').value = '';
  const resultBox = document.getElementById('new-user-result');
  resultBox.classList.add('hidden');
  resultBox.innerHTML = '';
  document.getElementById('new-user-submit-btn').classList.remove('hidden');
  openModal('add-user-modal');
}

async function submitAddUser() {
  const username = document.getElementById('new-user-username').value.trim();
  const name     = document.getElementById('new-user-name').value.trim();
  const email    = document.getElementById('new-user-email').value.trim();
  const role     = document.getElementById('new-user-role').value;
  const password = document.getElementById('new-user-password').value.trim();

  if (!username || !name || !email) {
    showToast('Username, name, and email are required.', 'error');
    return;
  }

  try {
    const data = await api('POST', '/admin/users', { username, name, email, role, password: password || undefined });
    showToast(`User "${name}" created.`, 'success');

    const resultBox = document.getElementById('new-user-result');
    if (data.temporaryPassword) {
      resultBox.className = 'temp-password-box';
      resultBox.innerHTML = `
        <strong>Share this temporary password with ${escHtml(name)}:</strong><br>
        <code>${escHtml(data.temporaryPassword)}</code>
        <p style="margin-top:8px;color:var(--gray-600)">They'll be asked to set their own password on first login. This won't be shown again.</p>`;
    } else {
      resultBox.className = 'temp-password-box';
      resultBox.innerHTML = `<strong>User created with the password you set.</strong>`;
    }
    resultBox.classList.remove('hidden');
    document.getElementById('new-user-submit-btn').classList.add('hidden');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (err) {
    showToast(err.message || 'Could not create user.', 'error');
  }
}

// ── Toggle Role ──
async function adminToggleRole(userId, currentRole) {
  const newRole = currentRole === 'Admin' ? 'User' : 'Admin';
  try {
    await api('PUT', `/admin/users/${userId}/role`, { role: newRole });
    showToast(`Role updated to ${newRole}.`, 'success');
    await loadAdminUsers();
    await loadAdminStats();
  } catch (err) {
    showToast(err.message || 'Could not update role.', 'error');
  }
}

// ── Delete User ──
function confirmDeleteUser(userId, name) {
  document.getElementById('confirm-modal-title').textContent = 'Delete user?';
  document.getElementById('confirm-modal-body').textContent =
    `This will permanently delete ${name}'s account and all of their tasks. This cannot be undone.`;
  const btn = document.getElementById('confirm-modal-action-btn');
  btn.onclick = () => doDeleteUser(userId);
  openModal('confirm-modal');
}

async function doDeleteUser(userId) {
  try {
    await api('DELETE', `/admin/users/${userId}`);
    closeModal('confirm-modal');
    showToast('User deleted.', 'info');
    await loadAdminUsers();
    await loadAdminStats();
  } catch (err) {
    showToast(err.message || 'Could not delete user.', 'error');
  }
}

// ── View User's Tasks (READ-ONLY — admin cannot add/edit/delete here) ──
async function viewUserTasks(userId) {
  try {
    const data = await api('GET', `/admin/users/${userId}`);
    document.getElementById('view-user-tasks-title').textContent = `${data.user.name}'s Tasks`;
    const list = document.getElementById('view-user-tasks-list');
    const priorityColors = { high: 'peach', medium: 'yellow', low: 'mint' };

    if (!data.tasks.length) {
      list.innerHTML = `<p style="font-size:13px;color:var(--gray-400);text-align:center;padding:24px 0">This user has no tasks yet.</p>`;
    } else {
      list.innerHTML = data.tasks.map(t => `
        <div class="readonly-task-row ${t.done ? 'done' : ''}">
          <span class="badge badge-${priorityColors[t.priority] || 'sky'}" style="flex-shrink:0">${t.priority}</span>
          <span class="readonly-task-title">${escHtml(t.title)}</span>
          <span class="readonly-task-deadline">${formatDeadline(t.deadline)}</span>
        </div>`).join('');
    }
    openModal('view-user-tasks-modal');
  } catch (err) {
    showToast(err.message || 'Could not load this user\'s tasks.', 'error');
  }
}

// ── Send Alert to User ──
function openSendAlertModal(userId, userName) {
  document.getElementById('send-alert-modal-title').textContent = 'Send Alert';
  document.getElementById('alert-target-user-id').value = userId;
  document.getElementById('alert-target-user-name').textContent = userName;
  document.getElementById('alert-message-input').value = '';
  document.getElementById('alert-severity-input').value = 'info';
  openModal('send-alert-modal');
}

// Reuses the same modal, just targets every user instead of one.
function openBroadcastAlertModal() {
  document.getElementById('send-alert-modal-title').textContent = 'Broadcast Alert to All Users';
  document.getElementById('alert-target-user-id').value = 'ALL';
  document.getElementById('alert-target-user-name').textContent = 'All users';
  document.getElementById('alert-message-input').value = '';
  document.getElementById('alert-severity-input').value = 'info';
  openModal('send-alert-modal');
}

async function submitSendAlert() {
  const userId  = document.getElementById('alert-target-user-id').value;
  const message = document.getElementById('alert-message-input').value.trim();
  const severity = document.getElementById('alert-severity-input').value;

  if (!message) {
    showToast('Enter a message to send.', 'error');
    return;
  }

  try {
    if (userId === 'ALL') {
      const data = await api('POST', '/admin/alerts/broadcast', { message, severity });
      showToast(`Alert sent to ${data.count} user(s).`, 'success');
    } else {
      await api('POST', `/admin/users/${userId}/alert`, { message, severity });
      showToast('Alert sent.', 'success');
    }
    closeModal('send-alert-modal');
    await loadAdminStats();
  } catch (err) {
    showToast(err.message || 'Could not send alert.', 'error');
  }
}

// ════════════════════════════════════════════════════════════
// ALERTS (user-facing bell — receives messages sent by admin)
// ════════════════════════════════════════════════════════════
async function loadAlerts() {
  try {
    const data = await api('GET', '/alerts');
    State.alerts = data.alerts || [];
    State.unreadAlertCount = data.unreadCount || 0;
    renderAlertBell();
  } catch (err) {
    // Non-critical — don't block app launch on this
    console.error(err);
  }
}

function renderAlertBell() {
  const badge = document.getElementById('alert-bell-badge');
  if (State.unreadAlertCount > 0) {
    badge.textContent = State.unreadAlertCount > 9 ? '9+' : State.unreadAlertCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function toggleAlertDropdown() {
  const dropdown = document.getElementById('alert-dropdown');
  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    renderAlertDropdownList();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

// Close the dropdown when clicking elsewhere
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.alert-bell-wrap');
  const dropdown = document.getElementById('alert-dropdown');
  if (wrap && dropdown && !wrap.contains(e.target)) dropdown.classList.add('hidden');
});

function renderAlertDropdownList() {
  const list = document.getElementById('alert-dropdown-list');
  if (!State.alerts.length) {
    list.innerHTML = `<div class="alert-empty">No alerts yet.</div>`;
    return;
  }
  const icons = { info: 'ℹ️', warning: '⚠️', urgent: '🚨' };
  list.innerHTML = State.alerts.map(a => `
    <div class="alert-item ${a.read ? '' : 'unread'}" onclick="markAlertRead('${a._id}')">
      <span class="alert-item-icon">${icons[a.severity] || 'ℹ️'}</span>
      <div>
        <div class="alert-item-msg">${escHtml(a.message)}</div>
        <div class="alert-item-meta">${a.sentBy ? 'From ' + escHtml(a.sentBy.name) + ' · ' : ''}${getTimeAgo(a.createdAt)}</div>
      </div>
    </div>`).join('');
}

async function markAlertRead(alertId) {
  try {
    await api('PATCH', `/alerts/${alertId}/read`);
    const alert = State.alerts.find(a => a._id === alertId);
    if (alert && !alert.read) {
      alert.read = true;
      State.unreadAlertCount = Math.max(0, State.unreadAlertCount - 1);
      renderAlertBell();
      renderAlertDropdownList();
      renderAlertBanners();
    }
  } catch { /* non-critical */ }
}

async function markAllAlertsRead() {
  try {
    await api('PATCH', '/alerts/read-all');
    State.alerts.forEach(a => a.read = true);
    State.unreadAlertCount = 0;
    renderAlertBell();
    renderAlertDropdownList();
    renderAlertBanners();
    showToast('All alerts marked as read.', 'info');
  } catch (err) {
    showToast(err.message || 'Could not update alerts.', 'error');
  }
}

// Inline banners on the dashboard for unread warning/urgent alerts
function renderAlertBanners() {
  const container = document.getElementById('dash-alert-banners');
  if (!container) return;
  const important = State.alerts.filter(a => !a.read && (a.severity === 'warning' || a.severity === 'urgent'));
  if (!important.length) { container.innerHTML = ''; return; }

  const icons = { warning: '⚠️', urgent: '🚨' };
  container.innerHTML = important.map(a => `
    <div class="alert-banner ${a.severity}">
      <span>${icons[a.severity]}</span>
      <span style="flex:1">${escHtml(a.message)}</span>
      <button class="btn btn-ghost btn-sm" onclick="markAlertRead('${a._id}')">Dismiss</button>
    </div>`).join('');
}

// ════════════════════════════════════════════════════════════
// MESSAGES — WhatsApp-style chat. Admins can start a direct
// message or group chat with any user; users can message the
// admin team directly, and take part in any group an admin adds
// them to. Every message shows the sender's name/username.
// ════════════════════════════════════════════════════════════

async function loadConversations() {
  try {
    const data = await api('GET', '/messages/conversations');
    State.conversations = data.conversations || [];
    renderMessagesNavBadge();
    if (document.getElementById('page-messages').classList.contains('active')) {
      renderConversationsList();
    }
  } catch (err) {
    console.error(err);
  }
}

function renderMessagesNavBadge() {
  const total = State.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const badge = document.getElementById('messages-nav-badge');
  if (total > 0) {
    badge.textContent = total > 9 ? '9+' : total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderMessages() {
  document.getElementById('messages-page-sub').textContent =
    State.user.role === 'Admin'
      ? "Chat directly with any user, or start a group."
      : "Chat with the admin team, or with a group you're part of.";
  renderConversationsList();

  // Re-open whatever thread was active (e.g. returning to this page).
  if (State.activeConversationId) {
    openConversation(State.activeConversationId, true);
  } else {
    document.getElementById('messages-empty-state').classList.remove('hidden');
    document.getElementById('messages-chat-wrap').classList.add('hidden');
  }
}

function conversationAvatarLabel(c) {
  return c.type === 'group' ? '👥' : (c.name || '?').charAt(0).toUpperCase();
}

function renderConversationsList() {
  const list = document.getElementById('conversations-list');
  const countEl = document.getElementById('conversations-count');

  // Non-admins always get a pinned "Admin Support" entry — either their
  // real direct thread if one exists, or a virtual placeholder that
  // creates itself the moment they send a first message.
  let items = [...State.conversations];
  if (State.user.role !== 'Admin') {
    const hasSupport = items.some((c) => c.type === 'direct');
    if (!hasSupport) {
      items = [{
        _id: 'virtual-support', type: 'direct', name: 'Admin Support',
        lastMessage: 'Send a message to get started', lastMessageAt: null, unreadCount: 0,
      }, ...items];
    }
  }

  countEl.textContent = items.length ? `${items.length}` : '';

  if (!items.length) {
    list.innerHTML = `<div class="user-picker-empty">No conversations yet.</div>`;
    return;
  }

  list.innerHTML = items.map((c) => `
    <div class="conversation-item ${c._id === State.activeConversationId ? 'active' : ''}" onclick="openConversation('${c._id}')">
      <div class="conversation-avatar">${conversationAvatarLabel(c)}</div>
      <div class="conversation-info">
        <div class="conversation-name-row">
          <span class="conversation-name">${escHtml(c.name || 'Conversation')}</span>
          ${c.lastMessageAt ? `<span class="conversation-time">${getTimeAgo(c.lastMessageAt)}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="conversation-preview" style="flex:1">${escHtml(c.lastMessage || 'No messages yet')}</span>
          ${c.unreadCount ? `<span class="conversation-unread-dot"></span>` : ''}
        </div>
      </div>
    </div>`).join('');
}

async function openConversation(id, silent) {
  State.activeConversationId = id;

  if (id === 'virtual-support') {
    // Not created on the server yet — show an empty thread ready for input.
    State.activeConversationMeta = { _id: null, type: 'direct', name: 'Admin Support', members: [] };
    document.getElementById('messages-empty-state').classList.add('hidden');
    document.getElementById('messages-chat-wrap').classList.remove('hidden');
    document.getElementById('chat-thread-avatar').textContent = 'A';
    document.getElementById('chat-thread-name').textContent = 'Admin Support';
    document.getElementById('chat-thread-sub').textContent = 'Send a message to start the conversation';
    document.getElementById('chat-thread-messages').innerHTML = '';
    renderConversationsList();
    return;
  }

  try {
    const data = await api('GET', `/messages/thread/${id}`);
    State.activeConversationMeta = data.conversation;
    document.getElementById('messages-empty-state').classList.add('hidden');
    document.getElementById('messages-chat-wrap').classList.remove('hidden');
    document.getElementById('chat-thread-avatar').textContent = conversationAvatarLabel(data.conversation);
    document.getElementById('chat-thread-name').textContent = data.conversation.name;
    document.getElementById('chat-thread-sub').textContent = data.conversation.type === 'group'
      ? `${data.conversation.members.map(m => m.name).join(', ')}`
      : 'Direct message';
    renderChatMessages(data.conversation, data.messages || []);

    // Reflect the read receipt locally without waiting for the next poll.
    const conv = State.conversations.find((c) => c._id === id);
    if (conv) conv.unreadCount = 0;
    renderMessagesNavBadge();
    renderConversationsList();
  } catch (err) {
    if (!silent) showToast(err.message || 'Could not open that conversation.', 'error');
  }
}

function renderChatMessages(conversation, messages) {
  const wrap = document.getElementById('chat-thread-messages');
  if (!messages.length) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--gray-400);font-size:13px;margin:auto">No messages yet — say hello 👋</div>`;
    return;
  }
  const showSenderLabel = conversation.type === 'group';
  wrap.innerHTML = messages.map((m) => {
    const mine = m.senderId === State.user._id;
    return `
      <div class="chat-bubble-row ${mine ? 'mine' : ''}">
        <div class="chat-bubble">
          ${showSenderLabel && !mine ? `<div class="chat-sender-label">${escHtml(m.senderName)} <span style="opacity:.6">@${escHtml(m.senderUsername || '')}</span></div>` : ''}
          ${escHtml(m.body)}
          <div class="chat-bubble-meta">${getTimeAgo(m.createdAt)}</div>
        </div>
      </div>`;
  }).join('');
  wrap.scrollTop = wrap.scrollHeight;
}

function handleChatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const body = input.value.trim();
  if (!body || !State.activeConversationId) return;

  const btn = document.getElementById('chat-send-btn');
  btn.disabled = true;
  try {
    const payload = { body };
    if (State.activeConversationId !== 'virtual-support') payload.conversationId = State.activeConversationId;

    const data = await api('POST', '/messages', payload);
    input.value = '';
    input.style.height = 'auto';

    // A brand-new support DM gets a real id back — adopt it going forward.
    if (State.activeConversationId === 'virtual-support' && data.conversationId) {
      State.activeConversationId = data.conversationId;
    }
    await loadConversations();
    await openConversation(State.activeConversationId, true);
  } catch (err) {
    showToast(err.message || 'Could not send message.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── New Chat modal (admin only) ───────────────────────────────────────
async function openNewMessageModal() {
  State.newChatType = 'direct';
  State.newChatSelectedUserIds = [];
  document.getElementById('new-message-group-name').value = '';
  document.getElementById('new-message-body-input').value = '';
  document.getElementById('new-message-user-search').value = '';
  setNewChatType('direct');

  if (!State.messageDirectory.length) {
    try {
      const data = await api('GET', '/messages/directory');
      State.messageDirectory = data.users || [];
    } catch (err) {
      showToast(err.message || 'Could not load users.', 'error');
    }
  }
  renderNewMessageUserList();
  openModal('new-message-modal');
}

function setNewChatType(type) {
  State.newChatType = type;
  State.newChatSelectedUserIds = [];
  document.querySelectorAll('[data-chat-type]').forEach((b) => {
    b.classList.remove('selected-user', 'selected-admin');
  });
  const activeBtn = document.querySelector(`[data-chat-type="${type}"]`);
  if (activeBtn) activeBtn.classList.add(type === 'direct' ? 'selected-user' : 'selected-admin');

  document.getElementById('new-message-group-name-group').classList.toggle('hidden', type !== 'group');
  document.getElementById('new-message-users-label').textContent = type === 'group' ? 'Members *' : 'Recipient *';
  renderNewMessageUserList();
}

function renderNewMessageUserList() {
  const search = document.getElementById('new-message-user-search').value.trim().toLowerCase();
  const list = document.getElementById('new-message-user-list');
  const filtered = State.messageDirectory.filter((u) =>
    !search || u.name.toLowerCase().includes(search) || u.username.toLowerCase().includes(search)
  );
  if (!filtered.length) {
    list.innerHTML = `<div class="user-picker-empty">No matching users.</div>`;
    return;
  }
  list.innerHTML = filtered.map((u) => `
    <div class="user-picker-item ${State.newChatSelectedUserIds.includes(u._id) ? 'selected' : ''}" onclick="toggleNewChatUser('${u._id}')">
      <span>${State.newChatSelectedUserIds.includes(u._id) ? '✅' : '⬜'}</span>
      <div>
        <div class="up-name">${escHtml(u.name)}</div>
        <div class="up-username">@${escHtml(u.username)}</div>
      </div>
    </div>`).join('');
}

function toggleNewChatUser(userId) {
  if (State.newChatType === 'direct') {
    State.newChatSelectedUserIds = [userId];
  } else {
    const idx = State.newChatSelectedUserIds.indexOf(userId);
    if (idx === -1) State.newChatSelectedUserIds.push(userId);
    else State.newChatSelectedUserIds.splice(idx, 1);
  }
  renderNewMessageUserList();
}

async function submitNewMessage() {
  const type = State.newChatType;
  const name = document.getElementById('new-message-group-name').value.trim();
  const body = document.getElementById('new-message-body-input').value.trim();

  if (type === 'group' && !name) return showToast('Group name is required.', 'error');
  if (!State.newChatSelectedUserIds.length) return showToast(`Select at least one ${type === 'group' ? 'member' : 'recipient'}.`, 'error');
  if (!body) return showToast('Message is required.', 'error');

  try {
    const data = await api('POST', '/messages/conversations', {
      type, name: type === 'group' ? name : undefined,
      memberIds: State.newChatSelectedUserIds, body,
    });
    closeModal('new-message-modal');
    showToast(type === 'group' ? 'Group created.' : 'Message sent.', 'success');
    await loadConversations();
    await openConversation(data.conversation._id, true);
  } catch (err) {
    showToast(err.message || 'Could not start the chat.', 'error');
  }
}

// ════════════════════════════════════════════════════════════
// NOTES — shared connector feature for both User and Admin
// Same UI and routes for both roles; each person sees only
// their own notes (admin notes are private to that admin).
// ════════════════════════════════════════════════════════════
const NOTE_COLORS = ['#D4C8F5', '#B8F0D8', '#FFD8C2', '#C2E4FF', '#FFF0A8', '#F0F0EE'];

async function loadNotes() {
  try {
    const data = await api('GET', '/notes');
    State.notes = data.notes || [];
  } catch (err) {
    showToast(err.message || 'Failed to load notes.', 'error');
  }
}

function renderNotes() {
  renderNotesSidebar();
  const countEl = document.getElementById('notes-count');
  if (countEl) countEl.textContent = State.notes.length + (State.notes.length === 1 ? ' note' : ' notes');

  if (State.activeNoteId && State.notes.some(n => n._id === State.activeNoteId)) {
    openNote(State.activeNoteId);
  } else {
    showNoteEmpty();
  }
}

function renderNotesSidebar(filterQuery) {
  const list = document.getElementById('notes-list');
  let notes = [...State.notes];
  if (filterQuery) {
    const q = filterQuery.toLowerCase();
    notes = notes.filter(n => (n.title || '').toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q));
  }
  notes.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updatedAt) - new Date(a.updatedAt)));

  if (!notes.length) {
    list.innerHTML = `<p style="padding:20px;font-size:13px;color:var(--gray-400);text-align:center">No notes found.</p>`;
    return;
  }

  list.innerHTML = notes.map(n => `
    <div class="note-list-item ${n._id === State.activeNoteId ? 'active' : ''}"
         style="border-left:3px solid ${NOTE_COLORS[n.colorIdx] || NOTE_COLORS[0]}"
         onclick="openNote('${n._id}')">
      <div class="note-list-header">
        <span class="note-list-title">${n.pinned ? '📍 ' : ''}${escHtml(n.title || 'Untitled')}</span>
        <span class="note-list-time">${getTimeAgo(n.updatedAt)}</span>
      </div>
      <div class="note-list-preview">${escHtml((n.body || '').slice(0, 120))}</div>
    </div>`).join('');
}

function openNote(id) {
  const note = State.notes.find(n => n._id === id);
  if (!note) { showNoteEmpty(); return; }

  State.activeNoteId = id;
  document.getElementById('note-empty-state').classList.add('hidden');
  document.getElementById('note-editor-wrap').classList.remove('hidden');

  document.getElementById('note-title-input').value = note.title || '';
  document.getElementById('note-body-input').value  = note.body || '';
  autoResize(document.getElementById('note-title-input'));

  document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', Number(s.dataset.idx) === (note.colorIdx || 0)));
  document.getElementById('note-pin-btn').classList.toggle('active', !!note.pinned);

  updateNoteMeta(note);
  renderNotesSidebar();
}

function showNoteEmpty() {
  State.activeNoteId = null;
  document.getElementById('note-editor-wrap').classList.add('hidden');
  document.getElementById('note-empty-state').classList.remove('hidden');
}

function createNewNote() {
  api('POST', '/notes', { title: '', body: '', colorIdx: 0 })
    .then(data => {
      State.notes.unshift(data.note);
      renderNotesSidebar();
      openNote(data.note._id);
    })
    .catch(err => showToast(err.message || 'Could not create note.', 'error'));
}

let noteSaveTimer = null;
function updateActiveNote() {
  const note = State.notes.find(n => n._id === State.activeNoteId);
  if (!note) return;

  note.title = document.getElementById('note-title-input').value;
  note.body  = document.getElementById('note-body-input').value;
  note.updatedAt = new Date().toISOString();
  updateNoteMeta(note);
  renderNotesSidebar();

  // Debounce the network write so we're not hammering the API on every keystroke
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    api('PUT', `/notes/${note._id}`, { title: note.title, body: note.body })
      .catch(err => showToast(err.message || 'Could not save note.', 'error'));
  }, 600);
}

function updateNoteMeta(note) {
  document.getElementById('note-meta-updated').textContent = 'Last edited ' + getTimeAgo(note.updatedAt);
  document.getElementById('note-meta-words').textContent = countWords(note.body || '') + ' words';
  document.getElementById('note-meta-chars').textContent = (note.body || '').length + ' characters';
}

async function togglePinNote() {
  const note = State.notes.find(n => n._id === State.activeNoteId);
  if (!note) return;
  try {
    const data = await api('PUT', `/notes/${note._id}`, { pinned: !note.pinned });
    Object.assign(note, data.note);
    document.getElementById('note-pin-btn').classList.toggle('active', !!note.pinned);
    renderNotesSidebar();
  } catch (err) {
    showToast(err.message || 'Could not update note.', 'error');
  }
}

async function setNoteColor(idx) {
  const note = State.notes.find(n => n._id === State.activeNoteId);
  if (!note) return;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', Number(s.dataset.idx) === idx));
  try {
    const data = await api('PUT', `/notes/${note._id}`, { colorIdx: idx });
    Object.assign(note, data.note);
    renderNotesSidebar();
  } catch (err) {
    showToast(err.message || 'Could not update note color.', 'error');
  }
}

function deleteActiveNote() {
  const note = State.notes.find(n => n._id === State.activeNoteId);
  if (!note) return;

  document.getElementById('confirm-modal-title').textContent = 'Delete note?';
  document.getElementById('confirm-modal-body').textContent = 'This note will be permanently deleted.';
  const btn = document.getElementById('confirm-modal-action-btn');
  btn.onclick = async () => {
    try {
      await api('DELETE', `/notes/${note._id}`);
      State.notes = State.notes.filter(n => n._id !== note._id);
      closeModal('confirm-modal');
      showNoteEmpty();
      renderNotesSidebar();
      showToast('Note deleted.', 'info');
    } catch (err) {
      showToast(err.message || 'Could not delete note.', 'error');
    }
  };
  openModal('confirm-modal');
}

function searchNotes(query) {
  renderNotesSidebar(query);
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function getTimeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// ════════════════════════════════════════════════════════════
// ANALYTICS (personal — derived from this user's own tasks/notes)
// ════════════════════════════════════════════════════════════
let analyticsRange = 'week';
function updateAnalyticsRange(range) {
  analyticsRange = range;
  document.querySelectorAll('.analytics-range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  renderAnalytics();
}

function renderAnalytics() {
  const data = computeAnalyticsData(analyticsRange);

  document.getElementById('kpi-completion').textContent = data.completionRate + '%';
  document.getElementById('kpi-done').textContent = data.doneInRange;
  document.getElementById('kpi-streak').textContent = data.streak;
  document.getElementById('kpi-overdue').textContent = data.overdue;
  document.getElementById('kpi-avg').textContent = data.avgPerDay;

  document.getElementById('streak-count').textContent = data.streak;
  document.getElementById('streak-msg').textContent = data.streak > 0
    ? `You've completed at least one task for ${data.streak} day${data.streak === 1 ? '' : 's'} in a row. Keep going!`
    : 'Complete a task today to start your streak!';

  document.getElementById('pill-total-done').textContent = State.tasks.filter(t => t.done).length;
  document.getElementById('pill-notes').textContent = State.notes.length;

  // Completion by priority bars
  const bars = document.getElementById('completion-bars');
  const priorities = ['high', 'medium', 'low'];
  const labels = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
  bars.innerHTML = priorities.map(p => {
    const tasksOfP = State.tasks.filter(t => t.priority === p);
    const doneOfP = tasksOfP.filter(t => t.done).length;
    const pct = tasksOfP.length ? Math.round((doneOfP / tasksOfP.length) * 100) : 0;
    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${labels[p]}</span><span style="color:var(--gray-400)">${doneOfP}/${tasksOfP.length} (${pct}%)</span>
        </div>
        <div style="height:8px;background:var(--gray-100);border-radius:var(--r-full);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--lav-dark);border-radius:var(--r-full)"></div>
        </div>
      </div>`;
  }).join('');

  drawDonutChart(data.priorityCounts);
  renderHeatmap(data.heatmap);
  renderRecentCompletions();
}

function computeAnalyticsData(range) {
  const days = range === 'week' ? 7 : range === 'month' ? 30 : 90;
  const now = new Date();
  const rangeStart = new Date(now); rangeStart.setDate(now.getDate() - days); rangeStart.setHours(0,0,0,0);

  const tasksInRange = State.tasks.filter(t => new Date(t.deadline) >= rangeStart);
  const doneInRange = tasksInRange.filter(t => t.done).length;
  const completionRate = tasksInRange.length ? Math.round((doneInRange / tasksInRange.length) * 100) : 0;
  const avgPerDay = (doneInRange / days).toFixed(1);

  const overdue = State.tasks.filter(t => !t.done && new Date(t.deadline) < now).length;

  const priorityCounts = { high: 0, medium: 0, low: 0 };
  State.tasks.forEach(t => { if (priorityCounts[t.priority] !== undefined) priorityCounts[t.priority]++; });

  // Streak: consecutive days (including today) with at least one completed task
  let streak = 0;
  const completedDates = new Set(
    State.tasks.filter(t => t.done).map(t => new Date(t.updatedAt || t.deadline).toDateString())
  );
  let cursor = new Date(now);
  while (completedDates.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Heatmap: last 35 days, count of completed tasks per day
  const heatmap = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0,0,0,0);
    const count = State.tasks.filter(t => t.done && new Date(t.updatedAt || t.deadline).toDateString() === d.toDateString()).length;
    heatmap.push({ date: d, count });
  }

  return { completionRate, doneInRange, streak, overdue, avgPerDay, priorityCounts, heatmap };
}

function drawDonutChart(counts) {
  const canvas = document.getElementById('priority-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 160;
  canvas.width = size; canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  const total = counts.high + counts.medium + counts.low;
  const colors = { high: '#F0A882', medium: '#E8CC50', low: '#7DD8B0' };
  const cx = size / 2, cy = size / 2, rOuter = 70, rInner = 42;

  if (total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = '#EBEBEA';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    return;
  }

  let startAngle = -Math.PI / 2;
  ['high', 'medium', 'low'].forEach(key => {
    const val = counts[key];
    if (!val) return;
    const sliceAngle = (val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rOuter, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = colors[key];
    ctx.fill();
    startAngle += sliceAngle;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.fillStyle = '#1A1A18';
  ctx.font = '600 20px DM Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy);
}

function renderHeatmap(heatmap) {
  const container = document.getElementById('activity-heatmap');
  if (!container) return;
  container.style.display = 'grid';
  container.style.gridTemplateColumns = 'repeat(7, 1fr)';
  container.style.gap = '4px';

  const maxCount = Math.max(1, ...heatmap.map(h => h.count));
  container.innerHTML = heatmap.map(h => {
    const intensity = h.count === 0 ? 0 : h.count / maxCount;
    const bg = intensity === 0 ? '#EBEBEA' : `rgba(169,142,232,${0.25 + intensity * 0.75})`;
    return `<div title="${h.date.toLocaleDateString()}: ${h.count} completed" style="width:100%;padding-bottom:100%;position:relative;border-radius:3px;background:${bg}"></div>`;
  }).join('');
}

function renderRecentCompletions() {
  const container = document.getElementById('recent-completions');
  if (!container) return;
  const recent = State.tasks
    .filter(t => t.done)
    .sort((a, b) => new Date(b.updatedAt || b.deadline) - new Date(a.updatedAt || a.deadline))
    .slice(0, 6);

  if (!recent.length) {
    container.innerHTML = `<p style="font-size:13px;color:var(--gray-400);text-align:center;padding:20px 0">No completed tasks yet — finish one to see it here!</p>`;
    return;
  }
  const priorityColors = { high: 'peach', medium: 'yellow', low: 'mint' };
  container.innerHTML = recent.map(t => `
    <div class="activity-item">
      <span class="activity-dot" style="background:var(--mint-dark)"></span>
      <div style="flex:1">
        <div style="font-size:13px">${escHtml(t.title)}</div>
        <div style="font-size:11px;color:var(--gray-400)">${getTimeAgo(t.updatedAt || t.deadline)}</div>
      </div>
      <span class="badge badge-${priorityColors[t.priority] || 'sky'}">${t.priority}</span>
    </div>`).join('');
}

// ════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ════════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function setupToastContainer() {
  if (document.getElementById('toast-container')) return;
  const div = document.createElement('div');
  div.id = 'toast-container';
  div.style.position = 'fixed';
  div.style.bottom = '24px';
  div.style.right = '24px';
  div.style.zIndex = '3000';
  div.style.display = 'flex';
  div.style.flexDirection = 'column';
  div.style.gap = '10px';
  document.body.appendChild(div);
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const colors = {
    info:    { bg: '#EBF6FF', border: '#82BEED', text: '#1A1A18' },
    success: { bg: '#E8FAF2', border: '#7DD8B0', text: '#1A1A18' },
    warning: { bg: '#FFFAE8', border: '#E8CC50', text: '#1A1A18' },
    error:   { bg: '#FFF0E8', border: '#F0A882', text: '#1A1A18' },
  };
  const c = colors[type] || colors.info;

  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.background = c.bg;
  toast.style.border = `1px solid ${c.border}`;
  toast.style.color = c.text;
  toast.style.padding = '12px 18px';
  toast.style.borderRadius = '12px';
  toast.style.fontSize = '13px';
  toast.style.fontWeight = '500';
  toast.style.boxShadow = '0 4px 16px rgba(100,80,160,0.12)';
  toast.style.maxWidth = '340px';
  toast.style.animation = 'toastIn 0.25s ease';

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
