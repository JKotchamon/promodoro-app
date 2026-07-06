/* ==================================================================
   Prodomoro — Pomodoro timer with tasks, dashboard and localStorage
   ================================================================== */

// ================================================================
// Supabase — auth & cloud sync
// ================================================================
let sb = null;
let currentUser = null;
let authFormMode = "signin";

function initSupabase() {
  if (typeof supabase === "undefined") return;
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: "implicit" },
  });

  showAuthOverlay();

  sb.auth.onAuthStateChange((_event, session) => {
    const wasLoggedIn = !!currentUser;
    const sameUser = wasLoggedIn && currentUser.id === session?.user?.id;
    currentUser = session?.user ?? null;
    if (currentUser) {
      // Tab refocus / token refresh re-fires SIGNED_IN for the same user;
      // data is already loaded, so don't show the loading overlay again.
      if (sameUser) return;
      // Supabase holds an auth lock while this callback runs — awaiting
      // queries here deadlocks. Defer them past the callback instead.
      setTimeout(async () => {
        await loadFromSupabase();
        hideAuthOverlay();
      }, 0);
    } else {
      if (wasLoggedIn) {
        tasks = []; sessions = []; settings = { ...DEFAULT_SETTINGS };
        setMode("focus", { keepCycle: false });
        syncQuickSettings();
        renderTasks();
        renderDashboard();
      }
      showAuthOverlay();
    }
  });
}

function showAuthOverlay() {
  $("auth-overlay").classList.remove("hidden");
  $("user-email-display").classList.add("hidden");
  $("signout-btn").classList.add("hidden");
}

function hideAuthOverlay() {
  $("auth-overlay").classList.add("hidden");
  $("user-email-display").textContent = currentUser.email;
  $("user-email-display").classList.remove("hidden");
  $("signout-btn").classList.remove("hidden");
}

async function loadFromSupabase() {
  if (!sb || !currentUser) return;
  $("app-loading").classList.remove("hidden");

  try {
  const uid = currentUser.id;
  const [{ data: sRow }, { data: tRows }, { data: sesRows }] = await Promise.all([
    sb.from("settings").select("*").eq("user_id", uid).maybeSingle(),
    sb.from("tasks").select("*").eq("user_id", uid).order("created_at"),
    sb.from("sessions").select("*").eq("user_id", uid).order("date"),
  ]);

  if (sRow) {
    settings = {
      focus: sRow.focus,
      short: sRow.short_break,
      long: sRow.long_break,
      cycles: sRow.cycles,
      autoStart: sRow.auto_start,
      sound: sRow.sound,
    };
    save(STORE_KEYS.settings, settings);
  }

  tasks = (tRows || []).map(r => ({
    id: r.id,
    name: r.name,
    estimate: r.estimate,
    completed: r.completed,
    done: r.done,
    createdAt: r.created_at,
    focusMins: r.focus_mins || null,
    shortMins: r.short_mins || null,
    longMins: r.long_mins || null,
    parentId: r.parent_id || null,
  }));
  save(STORE_KEYS.tasks, tasks);

  sessions = (sesRows || []).map(r => ({
    date: r.date,
    taskId: r.task_id,
    taskName: r.task_name,
    minutes: r.minutes,
    source: r.source || "pomodoro",
  }));
  save(STORE_KEYS.sessions, sessions);

  $("app-loading").classList.add("hidden");
  setMode("focus", { keepCycle: false });
  syncQuickSettings();
  renderTasks();
  renderDashboard();
  updateTimingHint();
  } catch (err) {
    console.error("loadFromSupabase failed:", err);
    $("app-loading").classList.add("hidden");
  }
}

function sbUpsertSettings() {
  if (!sb || !currentUser) return;
  sb.from("settings").upsert({
    user_id: currentUser.id,
    focus: settings.focus,
    short_break: settings.short,
    long_break: settings.long,
    cycles: settings.cycles,
    auto_start: settings.autoStart,
    sound: settings.sound,
  }).then();
}

function sbUpsertTask(task) {
  if (!sb || !currentUser) return;
  sb.from("tasks").upsert({
    id: task.id,
    user_id: currentUser.id,
    name: task.name,
    estimate: task.estimate,
    completed: task.completed,
    done: task.done,
    created_at: task.createdAt,
    focus_mins: task.focusMins,
    short_mins: task.shortMins,
    long_mins: task.longMins,
    parent_id: task.parentId || null,
  }).then();
}

function sbRemoveTask(id) {
  if (!sb || !currentUser) return;
  sb.from("tasks").delete().eq("id", id).eq("user_id", currentUser.id).then();
}

function sbInsertSession(session) {
  if (!sb || !currentUser) return;
  sb.from("sessions").insert({
    user_id: currentUser.id,
    task_id: session.taskId || null,
    task_name: session.taskName,
    minutes: session.minutes,
    date: session.date,
    source: session.source || "pomodoro",
  }).then();
}

function sbClearAll() {
  if (!sb || !currentUser) return;
  const uid = currentUser.id;
  Promise.all([
    sb.from("sessions").delete().eq("user_id", uid),
    sb.from("tasks").delete().eq("user_id", uid),
    sb.from("settings").delete().eq("user_id", uid),
  ]);
}

function setAuthMode(mode) {
  authFormMode = mode;
  document.querySelectorAll(".auth-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.auth === mode)
  );
  $("auth-submit").textContent = mode === "signin" ? "Sign In" : "Sign Up";
  $("auth-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  $("auth-error").classList.add("hidden");
}

async function submitAuth(e) {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const btn = $("auth-submit");
  const errEl = $("auth-error");

  btn.disabled = true;
  btn.textContent = "Please wait…";
  errEl.classList.add("hidden");

  let error;
  if (authFormMode === "signup") {
    ({ error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    }));
    if (!error) {
      errEl.textContent = "✅ Check your email for a confirmation link!";
      errEl.dataset.success = "true";
      errEl.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Sign Up";
      return;
    }
  } else {
    ({ error } = await sb.auth.signInWithPassword({ email, password }));
  }

  if (error) {
    errEl.textContent = error.message;
    delete errEl.dataset.success;
    errEl.classList.remove("hidden");
  }
  btn.disabled = false;
  btn.textContent = authFormMode === "signin" ? "Sign In" : "Sign Up";
}

// ---------- Storage ----------
const STORE_KEYS = {
  settings: "prodomoro_settings",
  tasks: "prodomoro_tasks",
  sessions: "prodomoro_sessions",
};

const DEFAULT_SETTINGS = {
  focus: 25,
  short: 5,
  long: 15,
  cycles: 4,
  autoStart: false,
  sound: true,
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let settings = { ...DEFAULT_SETTINGS, ...load(STORE_KEYS.settings, {}) };
let tasks = load(STORE_KEYS.tasks, []);       // {id, name, estimate, completed, done, createdAt, focusMins, shortMins, longMins, parentId}
let sessions = load(STORE_KEYS.sessions, []); // {date, taskId, taskName, minutes, source}

// ---------- Timer state ----------
const timer = {
  mode: "focus",     // focus | short | long | stopwatch
  cycle: 1,
  running: false,
  remainingMs: 0,
  endTime: 0,
  intervalId: null,
};

// ---------- Stopwatch state ----------
const sw = {
  running: false,
  elapsed: 0,     // accumulated ms
  startedAt: 0,   // Date.now() when last started
};
let swIntervalId = null;

function getSwElapsed() {
  return sw.elapsed + (sw.running ? Date.now() - sw.startedAt : 0);
}

function formatStopwatch(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------- Element shortcuts ----------
const $ = (id) => document.getElementById(id);
const timeDisplay = $("time-display");
const cycleIndicator = $("cycle-indicator");
const startPauseBtn = $("start-pause-btn");
const activeTaskSelect = $("active-task");

// ==================================================================
// Timer logic
// ==================================================================

function getTaskTiming(mode) {
  const taskId = activeTaskSelect.value;
  const task = tasks.find((t) => t.id === taskId);
  const key = { focus: "focusMins", short: "shortMins", long: "longMins" }[mode];
  return (task && task[key]) || settings[mode];
}

function modeDuration(mode) {
  return getTaskTiming(mode) * 60 * 1000;
}

function setMode(mode, { keepCycle = true } = {}) {
  // Warn if switching away from an active stopwatch session with elapsed time
  if (timer.mode === "stopwatch" && mode !== "stopwatch" && getSwElapsed() > 0) {
    if (!confirm("You have an unsaved stopwatch session. Switching modes will discard it. Continue?")) {
      return;
    }
  }

  stopTicking();
  stopKeepAlive();
  if (swIntervalId) { clearInterval(swIntervalId); swIntervalId = null; sw.running = false; }

  timer.mode = mode;
  timer.running = false;

  if (mode === "stopwatch") {
    sw.elapsed = 0;
    sw.startedAt = 0;
  } else {
    timer.remainingMs = modeDuration(mode);
    if (!keepCycle) timer.cycle = 1;
  }

  document.body.dataset.mode = mode;
  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode)
  );
  renderTimer();
}

function startPause() {
  if (timer.mode === "stopwatch") {
    if (sw.running) {
      sw.elapsed += Date.now() - sw.startedAt;
      sw.running = false;
      clearInterval(swIntervalId);
      swIntervalId = null;
    } else {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
      sw.startedAt = Date.now();
      sw.running = true;
      swIntervalId = setInterval(() => renderTimer(), 250);
    }
    renderTimer();
    return;
  }

  if (timer.running) {
    timer.remainingMs = Math.max(0, timer.endTime - Date.now());
    timer.running = false;
    stopTicking();
    stopKeepAlive();
  } else {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    startKeepAlive();
    timer.endTime = Date.now() + timer.remainingMs;
    timer.running = true;
    timer.intervalId = setInterval(tick, 250);
  }
  renderTimer();
}

function stopTicking() {
  clearInterval(timer.intervalId);
  timer.intervalId = null;
}

function resetTimer() {
  if (timer.mode === "stopwatch") {
    clearInterval(swIntervalId);
    swIntervalId = null;
    sw.running = false;
    sw.elapsed = 0;
    sw.startedAt = 0;
    renderTimer();
    return;
  }
  stopTicking();
  stopKeepAlive();
  timer.running = false;
  timer.remainingMs = modeDuration(timer.mode);
  renderTimer();
}

function tick() {
  timer.remainingMs = Math.max(0, timer.endTime - Date.now());
  renderTimer();
  if (timer.remainingMs <= 0) {
    stopTicking();
    timer.running = false;
    sessionFinished();
  }
}

// ---------- Alarm ----------
let alarmIntervalId = null;

function startAlarm() {
  if (!settings.sound) return;
  playBeep();
  alarmIntervalId = setInterval(playBeep, 1800);
}

function stopAlarm() {
  clearInterval(alarmIntervalId);
  alarmIntervalId = null;
  if (!timer.running) stopKeepAlive();
}

// ---------- Session done banner ----------
let pendingAdvance = false;

function showSessionBanner(msg, shouldAdvance = false) {
  pendingAdvance = shouldAdvance;
  $("session-done-msg").textContent = msg;
  $("session-done-bar").classList.remove("hidden");
}

function confirmSessionDone() {
  stopAlarm();
  $("session-done-bar").classList.add("hidden");
  if (pendingAdvance) {
    pendingAdvance = false;
    advance(false);
  }
}

function sessionFinished() {
  let msg;
  if (timer.mode === "focus") {
    recordFocusSession(getTaskTiming("focus"));
    if (timer.cycle >= settings.cycles) {
      notify("All cycles done! 🍅", "Time for a long break.");
      msg = `All ${settings.cycles} cycles complete! 🍅  Time for a long break.`;
    } else {
      notify(`Cycle ${timer.cycle} focus done! 🍅`, "Time for a short break.");
      msg = `Cycle ${timer.cycle} focus complete! 🍅  Time for a short break.`;
    }
  } else if (timer.mode === "short") {
    const next = timer.cycle + 1;
    notify("Break is over!", `Ready for cycle ${next}?`);
    msg = `Break is over! 🎯  Ready for cycle ${next}?`;
  } else {
    notify("Long break is over!", "Ready for a fresh set of cycles?");
    msg = "Long break over! 🎯  Ready for a fresh set of cycles?";
  }
  startAlarm();
  showSessionBanner(msg, true);
}

function advance(skipped) {
  if (timer.mode === "focus") {
    if (timer.cycle >= settings.cycles) {
      setMode("long");
    } else {
      setMode("short");
    }
  } else if (timer.mode === "short") {
    timer.cycle += 1;
    setMode("focus");
  } else {
    timer.cycle = 1;
    setMode("focus");
  }
  if (!skipped && settings.autoStart) startPause();
}

function skipSession() {
  stopTicking();
  timer.running = false;
  stopAlarm();
  $("session-done-bar").classList.add("hidden");
  advance(true);
}

// ---------- Stopwatch save ----------
function stopAndSaveStopwatch() {
  const elapsed = getSwElapsed();
  const minutes = Math.round(elapsed / 60000);
  if (minutes < 1) {
    resetTimer();
    showSessionBanner("⚠ Session too short to save (minimum ~30 seconds).", false);
    return;
  }

  clearInterval(swIntervalId);
  swIntervalId = null;
  sw.running = false;
  sw.elapsed = 0;
  sw.startedAt = 0;

  recordFocusSession(minutes, "stopwatch");
  renderTimer();

  const taskId = activeTaskSelect.value;
  const task = tasks.find((t) => t.id === taskId);
  const taskLabel = task ? `"${task.name}"` : "this session";
  showSessionBanner(`✓ Saved ${minutes} min for ${taskLabel}`, false);
}

// ---------- Recording ----------
function recordFocusSession(minutes, source = "pomodoro") {
  const taskId = activeTaskSelect.value || null;
  const task = tasks.find((t) => t.id === taskId);
  if (task && source === "pomodoro") {
    task.completed += 1;
    save(STORE_KEYS.tasks, tasks);
    sbUpsertTask(task);
  }
  const session = {
    date: new Date().toISOString(),
    taskId,
    taskName: task ? taskDisplayName(task) : "",
    minutes,
    source,
  };
  sessions.push(session);
  save(STORE_KEYS.sessions, sessions);
  sbInsertSession(session);
  renderTasks();
  renderMissions();
  renderDashboard();
}

// ---------- Rendering ----------
function formatTime(ms) {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderTimer() {
  if (timer.mode === "stopwatch") {
    const elapsed = getSwElapsed();
    const text = formatStopwatch(elapsed);
    timeDisplay.textContent = text;
    document.title = sw.running ? `${text} — Stopwatch | Prodomoro` : "Prodomoro";
    startPauseBtn.textContent = sw.running ? "Pause" : "Start";
    return;
  }

  const text = formatTime(timer.remainingMs);
  timeDisplay.textContent = text;

  const modeLabel = { focus: "Focus", short: "Break", long: "Long break" }[timer.mode];
  document.title = timer.running ? `${text} — ${modeLabel} | Prodomoro` : "Prodomoro";

  const completed =
    timer.mode === "long" ? settings.cycles
    : timer.mode === "short" ? Math.min(timer.cycle, settings.cycles)
    : timer.cycle - 1;
  const total = settings.cycles;
  const stack = "🍅".repeat(completed) + "○".repeat(Math.max(0, total - completed));
  cycleIndicator.textContent = timer.mode === "focus"
    ? `Cycle ${timer.cycle} / ${total}  ${stack}`
    : stack;

  startPauseBtn.textContent = timer.running ? "Pause" : "Start";
}

// ---------- Timing hint ----------
function updateTimingHint() {
  if (timer.mode === "stopwatch") {
    $("task-timing-hint").classList.add("hidden");
    return;
  }
  const taskId = activeTaskSelect.value;
  const task = tasks.find((t) => t.id === taskId);
  const hint = $("task-timing-hint");
  if (!task || (!task.focusMins && !task.shortMins && !task.longMins)) {
    hint.classList.add("hidden");
    return;
  }
  const f = task.focusMins ? `${task.focusMins}m` : `${settings.focus}m`;
  const s = task.shortMins ? `${task.shortMins}m` : `${settings.short}m`;
  const l = task.longMins ? `${task.longMins}m` : `${settings.long}m`;
  hint.textContent = `⏱ Custom timing active — Focus: ${f} · Short break: ${s} · Long break: ${l}`;
  hint.classList.remove("hidden");
}

// ---------- Notifications & sound ----------
function notify(title, body) {
  if (window.Notification && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
  }
}

// Shared AudioContext, unlocked by the Start tap. Mobile browsers block
// audio from contexts created while the tab is hidden, so the alarm must
// reuse this one instead of creating its own.
let audioCtx = null;
let keepAliveNodes = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// While the timer runs, play a near-silent tone. The browser then treats
// the tab as "playing audio" and keeps it awake in the background, so the
// alarm can ring even when the user is in another app.
function startKeepAlive() {
  if (!settings.sound || keepAliveNodes) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 50;
    gain.gain.value = 0.001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    keepAliveNodes = { osc, gain };
  } catch {
    /* audio not available */
  }
}

function stopKeepAlive() {
  if (!keepAliveNodes) return;
  try { keepAliveNodes.osc.stop(); } catch { /* already stopped */ }
  keepAliveNodes = null;
}

function playBeep() {
  try {
    const ctx = getAudioCtx();
    const notes = [660, 880, 990];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "square";
      const t = ctx.currentTime + i * 0.28;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
      gain.gain.setValueAtTime(0.9, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  } catch {
    /* audio not available */
  }
}

// ==================================================================
// Tasks
// ==================================================================
function addTask(name, estimate, focusMins, shortMins, longMins, parentId = null) {
  const task = {
    id: crypto.randomUUID(),
    name,
    estimate,
    completed: 0,
    done: false,
    createdAt: new Date().toISOString(),
    focusMins: focusMins || null,
    shortMins: shortMins || null,
    longMins: longMins || null,
    parentId,
  };
  tasks.push(task);
  save(STORE_KEYS.tasks, tasks);
  sbUpsertTask(task);
  renderTasks();
}

function taskParent(t) {
  return t.parentId ? tasks.find((p) => p.id === t.parentId) : null;
}

function taskSubtasks(id) {
  return tasks.filter((s) => s.parentId === id);
}

function taskDisplayName(t) {
  const parent = taskParent(t);
  return parent ? `${parent.name} › ${t.name}` : t.name;
}

function toggleTask(id) {
  const t = tasks.find((t) => t.id === id);
  if (!t) return;
  t.done = !t.done;
  save(STORE_KEYS.tasks, tasks);
  sbUpsertTask(t);
  renderTasks();
  renderDashboard();
}

// ---------- Task edit modal ----------
let editingTaskId = null;

function openEditTask(id) {
  const t = tasks.find((t) => t.id === id);
  if (!t) return;
  editingTaskId = id;
  $("edit-task-name").value = t.name;
  $("edit-task-estimate").value = t.estimate;
  $("edit-task-focus").value = t.focusMins || "";
  $("edit-task-short").value = t.shortMins || "";
  $("edit-task-long").value = t.longMins || "";
  $("task-edit-overlay").classList.remove("hidden");
  $("edit-task-name").focus();
}

function closeEditTask() {
  editingTaskId = null;
  $("task-edit-overlay").classList.add("hidden");
}

function saveEditTask(e) {
  e.preventDefault();
  const t = tasks.find((t) => t.id === editingTaskId);
  if (!t) return;
  const newName = $("edit-task-name").value.trim();
  if (newName) t.name = newName;
  t.estimate = Math.max(1, parseInt($("edit-task-estimate").value, 10) || 1);
  t.focusMins = parseInt($("edit-task-focus").value, 10) || null;
  t.shortMins = parseInt($("edit-task-short").value, 10) || null;
  t.longMins = parseInt($("edit-task-long").value, 10) || null;
  save(STORE_KEYS.tasks, tasks);
  sbUpsertTask(t);
  renderTasks();
  if (activeTaskSelect.value === editingTaskId && !timer.running && timer.mode !== "stopwatch") {
    timer.remainingMs = modeDuration(timer.mode);
    renderTimer();
  }
  updateTimingHint();
  closeEditTask();
}

function deleteTask(id) {
  const t = tasks.find((t) => t.id === id);
  if (!t) return;
  const subs = taskSubtasks(id);
  const msg = subs.length
    ? `Delete task "${t.name}" and its ${subs.length} subtask${subs.length !== 1 ? "s" : ""}?`
    : `Delete task "${t.name}"?`;
  if (!confirm(msg)) return;
  const removeIds = new Set([id, ...subs.map((s) => s.id)]);
  tasks = tasks.filter((t) => !removeIds.has(t.id));
  save(STORE_KEYS.tasks, tasks);
  removeIds.forEach((rid) => sbRemoveTask(rid));
  renderTasks();
  renderDashboard();
}

let addingSubtaskFor = null;

function isSubtask(t) {
  return !!(t.parentId && tasks.some((p) => p.id === t.parentId));
}

function buildTaskRow(t, sub) {
  const li = document.createElement("li");
  li.className = "task-item" + (t.done ? " done" : "") + (sub ? " subtask" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = t.done;
  checkbox.addEventListener("change", () => toggleTask(t.id));

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = t.name;

  const pomos = document.createElement("span");
  pomos.className = "task-pomos";
  pomos.textContent = `🍅 ${t.completed} / ${t.estimate}`;

  const actions = document.createElement("span");
  actions.className = "task-actions";

  if (!sub) {
    const subBtn = document.createElement("button");
    subBtn.textContent = "➕";
    subBtn.title = "Add subtask";
    subBtn.addEventListener("click", () => {
      addingSubtaskFor = addingSubtaskFor === t.id ? null : t.id;
      renderTasks();
    });
    actions.appendChild(subBtn);
  }

  const editBtn = document.createElement("button");
  editBtn.textContent = "✏️";
  editBtn.title = "Edit task";
  editBtn.addEventListener("click", () => openEditTask(t.id));

  const delBtn = document.createElement("button");
  delBtn.textContent = "🗑️";
  delBtn.title = "Delete";
  delBtn.addEventListener("click", () => deleteTask(t.id));

  actions.append(editBtn, delBtn);

  if (t.focusMins || t.shortMins || t.longMins) {
    const badge = document.createElement("span");
    badge.className = "task-time-badge";
    const f = t.focusMins ? `${t.focusMins}m` : "—";
    const s = t.shortMins ? `${t.shortMins}m` : "—";
    const l = t.longMins ? `${t.longMins}m` : "—";
    badge.textContent = `⏱ ${f} / ${s} / ${l}`;
    badge.title = `Focus: ${f}, Short break: ${s}, Long break: ${l}`;
    li.append(checkbox, title, badge, pomos, actions);
  } else {
    li.append(checkbox, title, pomos, actions);
  }

  return li;
}

function buildSubtaskForm(parent) {
  const li = document.createElement("li");
  li.className = "task-item subtask subtask-form";

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 80;
  input.placeholder = `New subtask of "${parent.name}"…`;

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn-primary";
  addBtn.textContent = "Add";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "✕";

  const submit = () => {
    const name = input.value.trim();
    if (!name) return;
    addingSubtaskFor = null;
    addTask(name, 1, null, null, null, parent.id);
  };
  addBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", () => {
    addingSubtaskFor = null;
    renderTasks();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      addingSubtaskFor = null;
      renderTasks();
    }
  });

  li.append(input, addBtn, cancelBtn);
  requestAnimationFrame(() => input.focus());
  return li;
}

function renderTasks() {
  const list = $("task-list");
  list.innerHTML = "";
  $("task-empty").classList.toggle("hidden", tasks.length > 0);

  tasks.forEach((t) => {
    if (isSubtask(t)) return; // rendered under its parent below
    list.appendChild(buildTaskRow(t, false));
    taskSubtasks(t.id).forEach((s) => list.appendChild(buildTaskRow(s, true)));
    if (addingSubtaskFor === t.id) list.appendChild(buildSubtaskForm(t));
  });

  renderTaskPicker();
}

function renderTaskPicker() {
  const current = activeTaskSelect.value;
  activeTaskSelect.innerHTML = '<option value="">— no task selected —</option>';

  const addOption = (t, sub) => {
    if (t.done) return;
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent =
      (sub ? "  ↳ " : "") +
      t.name +
      (t.focusMins || t.shortMins || t.longMins ? " ⏱" : "");
    activeTaskSelect.appendChild(opt);
  };

  tasks.forEach((t) => {
    if (isSubtask(t)) return;
    addOption(t, false);
    taskSubtasks(t.id).forEach((s) => addOption(s, true));
  });

  if ([...activeTaskSelect.options].some((o) => o.value === current)) {
    activeTaskSelect.value = current;
  }
}

// ==================================================================
// Missions — today's per-task session stacks
// ==================================================================
function renderMissions() {
  const todayKey = dayKey(new Date());
  const todaySessions = sessions.filter((s) => dayKey(s.date) === todayKey);

  const map = new Map();
  todaySessions.forEach((s) => {
    const key = s.taskId || "__none__";
    if (!map.has(key)) map.set(key, { name: s.taskName || "(no task)", pomoCount: 0, swMins: 0, totalMinutes: 0 });
    const entry = map.get(key);
    if (s.source === "stopwatch") {
      entry.swMins += s.minutes;
    } else {
      entry.pomoCount += 1;
    }
    entry.totalMinutes += s.minutes;
  });

  const list = $("missions-list");
  list.innerHTML = "";

  const entries = [...map.values()].reverse();
  $("missions-empty").classList.toggle("hidden", entries.length > 0);

  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "mission-item";

    const name = document.createElement("span");
    name.className = "mission-task";
    name.textContent = entry.name;

    const icons = document.createElement("span");
    icons.className = "mission-pomos";
    let txt = "";
    if (entry.pomoCount > 0) {
      txt += "🍅".repeat(Math.min(entry.pomoCount, 12));
      if (entry.pomoCount > 12) txt += ` ×${entry.pomoCount}`;
    }
    if (entry.swMins > 0) {
      txt += (txt ? " " : "") + `⏱${formatMinutes(entry.swMins, true)}`;
    }
    icons.textContent = txt || "—";
    icons.title = [
      entry.pomoCount > 0 ? `${entry.pomoCount} pomodoro${entry.pomoCount !== 1 ? "s" : ""}` : "",
      entry.swMins > 0 ? `${entry.swMins} min stopwatch` : "",
    ].filter(Boolean).join(", ");

    const time = document.createElement("span");
    time.className = "mission-time";
    time.textContent = formatMinutes(entry.totalMinutes);

    li.append(name, icons, time);
    list.appendChild(li);
  });
}

// ==================================================================
// Activity Heatmap (GitHub-style, last 52 weeks)
// ==================================================================
function renderActivityHeatmap() {
  const CELL = 13;
  const GAP  = 3;
  const STEP = CELL + GAP;

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const minutesByDay = {};
  sessions.forEach((s) => {
    const k = dayKey(s.date);
    minutesByDay[k] = (minutesByDay[k] || 0) + s.minutes;
  });

  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dayKey(today);

  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7);
  start.setDate(start.getDate() - start.getDay());

  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const grid     = $("heatmap-grid");
  const monthsEl = $("hm-months");
  grid.innerHTML     = "";
  monthsEl.innerHTML = "";

  let col       = 0;
  let prevMonth = -1;
  const cursor  = new Date(start);

  while (cursor <= end) {
    const dow = cursor.getDay();

    if (dow === 0) {
      const m = cursor.getMonth();
      if (m !== prevMonth) {
        const lbl = document.createElement("div");
        lbl.className    = "hm-month-label";
        lbl.style.left   = `${col * STEP}px`;
        lbl.textContent  = MONTH_NAMES[m];
        monthsEl.appendChild(lbl);
        prevMonth = m;
      }
    }

    const k       = dayKey(cursor);
    const mins    = minutesByDay[k] || 0;
    const isFuture = cursor > today;

    const cell = document.createElement("div");
    cell.className = "hm-cell";

    if (isFuture) {
      cell.classList.add("hm-future");
    } else if (mins > 0) {
      cell.dataset.intensity = minutesToIntensity(mins);
      cell.title = `${k}: ${mins} min focused`;
    } else {
      cell.title = `${k}: no session`;
    }

    if (k === todayKey) cell.classList.add("hm-today");
    grid.appendChild(cell);

    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() === 0) col++;
  }

  requestAnimationFrame(() => {
    const scrollEl = document.querySelector(".heatmap-scroll");
    if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollWidth;
  });

  const activeDays   = Object.keys(minutesByDay);
  const totalMins    = Object.values(minutesByDay).reduce((a, b) => a + b, 0);
  const dailyAvgMins = activeDays.length > 0 ? Math.round(totalMins / activeDays.length) : 0;

  let activeLast365 = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (minutesByDay[dayKey(d)]) activeLast365++;
  }
  const daysPct = Math.round((activeLast365 / 365) * 100);

  let currentStreak = 0;
  const cs = new Date(today);
  if (!minutesByDay[dayKey(cs)]) cs.setDate(cs.getDate() - 1);
  while (minutesByDay[dayKey(cs)]) {
    currentStreak++;
    cs.setDate(cs.getDate() - 1);
  }

  let longestStreak = 0;
  let run = 0;
  const sorted = [...activeDays].sort();
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      run = 1;
    } else {
      const prev = new Date(sorted[i - 1]);
      prev.setDate(prev.getDate() + 1);
      run = dayKey(prev) === sorted[i] ? run + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, run);
  }

  const h = Math.floor(dailyAvgMins / 60);
  const m = dailyAvgMins % 60;
  const avgText = dailyAvgMins === 0 ? "—"
    : h > 0 ? `${h}h ${m}m`
    : `${dailyAvgMins} min`;

  $("hm-daily-avg").textContent = avgText;
  $("hm-days-pct").textContent  = `${daysPct}%`;
  $("hm-longest").textContent   = `${longestStreak} day${longestStreak !== 1 ? "s" : ""}`;
  $("hm-current").textContent   = `${currentStreak} day${currentStreak !== 1 ? "s" : ""}`;
}

// ==================================================================
// Task Focus Stats
// ==================================================================
function renderTaskStats() {
  const statsMap = new Map();

  sessions.forEach((s) => {
    if (!s.taskId) return;
    if (!statsMap.has(s.taskId)) {
      statsMap.set(s.taskId, { name: s.taskName || "(no task)", totalMinutes: 0, sessionCount: 0, days: new Set() });
    }
    const entry = statsMap.get(s.taskId);
    entry.totalMinutes += s.minutes;
    entry.sessionCount += 1;
    entry.days.add(dayKey(s.date));
  });

  const container = $("task-stats-list");
  const empty = $("task-stats-empty");
  container.innerHTML = "";

  if (statsMap.size === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const entries = [...statsMap.entries()]
    .map(([id, data]) => ({
      id,
      name: data.name,
      totalMinutes: data.totalMinutes,
      sessionCount: data.sessionCount,
      daysCount: data.days.size,
      avgPerDay: Math.round(data.totalMinutes / data.days.size),
      avgPerSession: Math.round(data.totalMinutes / data.sessionCount),
      done: tasks.find((t) => t.id === id)?.done || false,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  const maxAvgPerDay = Math.max(...entries.map((e) => e.avgPerDay), 1);

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "task-stat-row" + (entry.done ? " task-stat-done" : "");

    const header = document.createElement("div");
    header.className = "task-stat-header";

    const name = document.createElement("span");
    name.className = "task-stat-name";
    name.textContent = entry.name;

    const total = document.createElement("span");
    total.className = "task-stat-total";
    const h = Math.floor(entry.totalMinutes / 60);
    const m = entry.totalMinutes % 60;
    total.textContent = h > 0 ? `${h}h ${m}m` : `${m} min`;
    total.title = `${entry.totalMinutes} total minutes`;

    header.append(name, total);

    const meta = document.createElement("div");
    meta.className = "task-stat-meta";
    meta.textContent =
      `${entry.sessionCount} session${entry.sessionCount !== 1 ? "s" : ""}  ·  ` +
      `${entry.daysCount} day${entry.daysCount !== 1 ? "s" : ""}  ·  ` +
      `avg ${entry.avgPerSession} min/session`;

    const avgRow = document.createElement("div");
    avgRow.className = "task-stat-avg-row";

    const avgLabel = document.createElement("span");
    avgLabel.className = "task-stat-avg";
    avgLabel.title = "Average focus minutes on days you worked on this task";
    avgLabel.textContent = `⌀ ${entry.avgPerDay} min/day`;

    const barWrap = document.createElement("div");
    barWrap.className = "task-stat-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "task-stat-bar";
    bar.style.width = `${Math.max(2, (entry.avgPerDay / maxAvgPerDay) * 100)}%`;
    barWrap.appendChild(bar);

    avgRow.append(avgLabel, barWrap);
    row.append(header, meta, avgRow);
    container.appendChild(row);
  });
}

// ==================================================================
// Monthly calendar
// ==================================================================
const calState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedKey: null,
};

function minutesToIntensity(mins) {
  if (mins <= 0) return 0;
  if (mins < 30) return 1;
  if (mins < 60) return 2;
  if (mins < 90) return 3;
  return 4;
}

function renderCalendar() {
  const { year, month } = calState;
  const todayKey = dayKey(new Date());

  const minutesByDay = {};
  sessions.forEach((s) => {
    const d = new Date(s.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const k = dayKey(s.date);
      minutesByDay[k] = (minutesByDay[k] || 0) + s.minutes;
    }
  });

  $("cal-title").textContent = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const grid = $("calendar-grid");
  grid.innerHTML = "";

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-day other-month";
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const k = dayKey(date);
    const mins = minutesByDay[k] || 0;
    const intensity = minutesToIntensity(mins);

    const cell = document.createElement("div");
    cell.className = "cal-day";
    if (k === todayKey) cell.classList.add("today");
    if (k === calState.selectedKey) cell.classList.add("selected");
    if (intensity > 0) cell.dataset.intensity = intensity;
    cell.title = mins > 0 ? `${mins} min focused` : "";

    const num = document.createElement("span");
    num.className = "cal-day-num";
    num.textContent = d;
    cell.appendChild(num);

    if (intensity > 0) {
      const dot = document.createElement("span");
      dot.className = "cal-day-dot";
      cell.appendChild(dot);
    }

    cell.addEventListener("click", () => selectCalDay(k, date));
    grid.appendChild(cell);
  }
}

function buildDayDetail(k) {
  const daySessions = sessions.filter((s) => dayKey(s.date) === k);
  const list = $("cal-detail-list");
  const empty = $("cal-detail-empty");
  list.innerHTML = "";

  if (daySessions.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const map = new Map();
  daySessions.forEach((s) => {
    const key = s.taskId || "__none__";
    if (!map.has(key)) map.set(key, { name: s.taskName || "(no task)", pomoCount: 0, swMins: 0, totalMinutes: 0 });
    const entry = map.get(key);
    if (s.source === "stopwatch") {
      entry.swMins += s.minutes;
    } else {
      entry.pomoCount += 1;
    }
    entry.totalMinutes += s.minutes;
  });

  [...map.values()].forEach((entry) => {
    const li = document.createElement("li");
    li.className = "mission-item";

    const name = document.createElement("span");
    name.className = "mission-task";
    name.textContent = entry.name;

    const icons = document.createElement("span");
    icons.className = "mission-pomos";
    let txt = "";
    if (entry.pomoCount > 0) {
      txt += "🍅".repeat(Math.min(entry.pomoCount, 12));
      if (entry.pomoCount > 12) txt += ` ×${entry.pomoCount}`;
    }
    if (entry.swMins > 0) {
      txt += (txt ? " " : "") + `⏱${formatMinutes(entry.swMins, true)}`;
    }
    icons.textContent = txt || "—";
    icons.title = [
      entry.pomoCount > 0 ? `${entry.pomoCount} pomodoro${entry.pomoCount !== 1 ? "s" : ""}` : "",
      entry.swMins > 0 ? `${entry.swMins} min stopwatch` : "",
    ].filter(Boolean).join(", ");

    const time = document.createElement("span");
    time.className = "mission-time";
    time.textContent = formatMinutes(entry.totalMinutes);

    li.append(name, icons, time);
    list.appendChild(li);
  });
}

function selectCalDay(k, date) {
  if (calState.selectedKey === k) {
    calState.selectedKey = null;
    $("cal-detail").classList.add("hidden");
    renderCalendar();
    return;
  }
  calState.selectedKey = k;
  renderCalendar();

  $("cal-detail-title").textContent = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  buildDayDetail(k);
  $("cal-detail").classList.remove("hidden");
  $("cal-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ==================================================================
// Dashboard
// ==================================================================
function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function formatMinutes(mins, short = false) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return short ? `${m}m` : `${m} min`;
}


function renderDashboard() {
  renderCalendar();
  renderMissions();
  renderTaskStats();
  renderActivityHeatmap();
  const todayKey = dayKey(new Date());

  let todayMinutes = 0;
  let todaySessions = 0;
  const minutesByDay = {};

  sessions.forEach((s) => {
    const key = dayKey(s.date);
    minutesByDay[key] = (minutesByDay[key] || 0) + s.minutes;
    if (key === todayKey) {
      todayMinutes += s.minutes;
      todaySessions += 1;
    }
  });

  $("stat-today-minutes").textContent = formatMinutes(todayMinutes, true);
  $("stat-today-pomos").textContent = todaySessions;
  $("stat-tasks-done").textContent = tasks.filter((t) => t.done).length;

  let streak = 0;
  const cursor = new Date();
  if (!minutesByDay[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (minutesByDay[dayKey(cursor)]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  $("stat-streak").textContent = `${streak} 🔥`;
}

// ==================================================================
// Inline timing settings (timer page)
// ==================================================================
function syncQuickSettings() {
  $("qs-focus").value = settings.focus;
  $("qs-short").value = settings.short;
  $("qs-long").value = settings.long;
  $("qs-cycles").value = settings.cycles;
}

function applyQuickSetting(settingKey, modeKey) {
  return function () {
    const val = parseInt(this.value, 10);
    if (!val || val < 1) return;
    settings[settingKey] = val;
    save(STORE_KEYS.settings, settings);
    sbUpsertSettings();
    if (settingKey === "cycles" && timer.cycle > settings.cycles) timer.cycle = 1;
    if (!timer.running && modeKey) {
      timer.remainingMs = modeDuration(modeKey);
    }
    renderTimer();
    updateTimingHint();
  };
}

// ==================================================================
// Settings (modal — sound & autostart only)
// ==================================================================
function openSettings() {
  $("set-autostart").checked = settings.autoStart;
  $("set-sound").checked = settings.sound;
  $("settings-overlay").classList.remove("hidden");
}

function closeSettings() {
  $("settings-overlay").classList.add("hidden");
}

function saveSettings(e) {
  e.preventDefault();
  settings.autoStart = $("set-autostart").checked;
  settings.sound = $("set-sound").checked;
  save(STORE_KEYS.settings, settings);
  sbUpsertSettings();
  closeSettings();
}

// ---------- Clear all data ----------
function clearAllData() {
  if (!confirm("This will permanently delete ALL tasks, sessions, and settings. Are you sure?")) return;
  Object.values(STORE_KEYS).forEach((k) => localStorage.removeItem(k));
  sbClearAll();
  settings = { ...DEFAULT_SETTINGS };
  tasks = [];
  sessions = [];
  stopTicking();
  stopKeepAlive();
  clearInterval(swIntervalId);
  swIntervalId = null;
  sw.running = false;
  sw.elapsed = 0;
  sw.startedAt = 0;
  setMode("focus", { keepCycle: false });
  syncQuickSettings();
  renderTasks();
  renderDashboard();
  updateTimingHint();
  closeSettings();
}

// ---------- Export / import ----------
function exportData() {
  const data = {
    app: "prodomoro",
    exportedAt: new Date().toISOString(),
    settings,
    tasks,
    sessions,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prodomoro-backup-${dayKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.app !== "prodomoro" || !Array.isArray(data.tasks) || !Array.isArray(data.sessions)) {
        alert("This file doesn't look like a Prodomoro backup.");
        return;
      }
      if (!confirm("Importing will replace your current data. Continue?")) return;
      settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      tasks = data.tasks;
      sessions = data.sessions;
      save(STORE_KEYS.settings, settings);
      save(STORE_KEYS.tasks, tasks);
      save(STORE_KEYS.sessions, sessions);
      setMode("focus", { keepCycle: false });
      renderTasks();
      renderDashboard();
      updateTimingHint();
      closeSettings();
      alert("Backup imported successfully! ✅");
    } catch {
      alert("Could not read this file. Is it a valid backup?");
    }
  };
  reader.readAsText(file);
}

// ==================================================================
// Tabs & event wiring
// ==================================================================
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "dashboard") renderDashboard();
  });
});

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

startPauseBtn.addEventListener("click", startPause);
$("reset-btn").addEventListener("click", resetTimer);

// If the browser throttled the tab while backgrounded, catch up the
// timer (and fire the alarm if the session ended) as soon as we return.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && timer.running) tick();
});
$("skip-btn").addEventListener("click", skipSession);
$("sw-stop-btn").addEventListener("click", stopAndSaveStopwatch);

activeTaskSelect.addEventListener("change", () => {
  if (!timer.running && timer.mode !== "stopwatch") {
    timer.remainingMs = modeDuration(timer.mode);
    renderTimer();
  }
  updateTimingHint();
});

$("task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("task-name").value.trim();
  const estimate = Math.max(1, parseInt($("task-estimate").value, 10) || 1);
  const focusMins = parseInt($("task-focus-mins").value, 10) || null;
  const shortMins = parseInt($("task-short-mins").value, 10) || null;
  const longMins = parseInt($("task-long-mins").value, 10) || null;
  if (!name) return;
  addTask(name, estimate, focusMins, shortMins, longMins);
  $("task-name").value = "";
  $("task-estimate").value = 1;
  $("task-focus-mins").value = "";
  $("task-short-mins").value = "";
  $("task-long-mins").value = "";
  $("custom-time-row").classList.add("hidden");
  $("toggle-custom-time").classList.remove("active");
  $("task-name").focus();
});

$("toggle-custom-time").addEventListener("click", () => {
  $("custom-time-row").classList.toggle("hidden");
  $("toggle-custom-time").classList.toggle("active");
});

$("cal-prev").addEventListener("click", () => {
  calState.month -= 1;
  if (calState.month < 0) { calState.month = 11; calState.year -= 1; }
  calState.selectedKey = null;
  $("cal-detail").classList.add("hidden");
  renderCalendar();
});
$("cal-next").addEventListener("click", () => {
  calState.month += 1;
  if (calState.month > 11) { calState.month = 0; calState.year += 1; }
  calState.selectedKey = null;
  $("cal-detail").classList.add("hidden");
  renderCalendar();
});
$("cal-detail-close").addEventListener("click", () => {
  calState.selectedKey = null;
  $("cal-detail").classList.add("hidden");
  renderCalendar();
});

$("qs-focus").addEventListener("change", applyQuickSetting("focus", "focus"));
$("qs-short").addEventListener("change", applyQuickSetting("short", "short"));
$("qs-long").addEventListener("change", applyQuickSetting("long", "long"));
$("qs-cycles").addEventListener("change", applyQuickSetting("cycles", null));

$("settings-btn").addEventListener("click", openSettings);
$("settings-cancel").addEventListener("click", closeSettings);
$("settings-form").addEventListener("submit", saveSettings);
$("settings-overlay").addEventListener("click", (e) => {
  if (e.target === $("settings-overlay")) closeSettings();
});

$("clear-data-btn").addEventListener("click", clearAllData);
$("export-btn").addEventListener("click", exportData);
$("import-btn").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", (e) => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = "";
});

$("session-done-confirm").addEventListener("click", confirmSessionDone);

$("task-edit-form").addEventListener("submit", saveEditTask);
$("task-edit-cancel").addEventListener("click", closeEditTask);
$("task-edit-overlay").addEventListener("click", (e) => {
  if (e.target === $("task-edit-overlay")) closeEditTask();
});

window.addEventListener("beforeunload", (e) => {
  if (timer.running || sw.running) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ==================================================================
// Init
// ==================================================================
document.querySelectorAll(".auth-tab").forEach(btn =>
  btn.addEventListener("click", () => setAuthMode(btn.dataset.auth))
);
$("auth-form").addEventListener("submit", submitAuth);
$("signout-btn").addEventListener("click", () => sb && sb.auth.signOut());

setMode("focus", { keepCycle: false });
syncQuickSettings();
renderTasks();
renderCalendar();
renderDashboard();
updateTimingHint();
initSupabase();
