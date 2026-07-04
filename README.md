# 🍅 Promodoro

A lightweight, offline-first Pomodoro timer built with vanilla HTML, CSS, and JavaScript — no frameworks, no dependencies, runs entirely in your browser.

## Features

- **Focus / Short Break / Long Break** modes with configurable durations
- **Stopwatch mode** — free-form time tracking with session save
- **Task manager** — add tasks with estimated pomodoros and optional custom timing per task
- **Dashboard** with:
  - Today's focus minutes, session count, completed tasks, and day streak
  - GitHub-style activity heatmap (last 52 weeks)
  - Per-task focus stats with average minutes/day
  - Today's missions log
  - Monthly calendar with daily session detail
- **Sound notifications** and browser notifications on session complete
- **Auto-start** next session option
- **Export / Import** JSON backup — your data, your device
- All data stored in **localStorage** — nothing sent to any server

## Getting Started

No build step required. Just open `index.html` in any modern browser.

```bash
git clone https://github.com/JKotchamon/promodoro-app.git
cd promodoro-app
# Open index.html in your browser
```

Or download the ZIP and open `index.html` directly.

## Usage

| Action | How |
|---|---|
| Change mode | Click Focus / Short Break / Long Break / Stopwatch |
| Adjust duration | Edit the inline number inputs on the Timer page |
| Link a task | Select from the "Working on" dropdown |
| Save stopwatch session | Click **Save Session** (minimum ~30 seconds) |
| View stats | Switch to the **Dashboard** tab |
| Backup data | ⚙️ Settings → Export data |

## Project Structure

```
promodoro-app/
├── index.html        # App shell & markup
├── style.css         # All styles
├── script.js         # App logic (timer, tasks, dashboard)
├── config.js         # Configuration
└── supabase-setup.sql
```

## License

[MIT](LICENSE) © 2026 JKotchamon
