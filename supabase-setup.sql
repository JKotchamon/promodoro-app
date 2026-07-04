-- ============================================================
-- Prodomoro — Supabase setup
-- Run this once in your Supabase project: SQL Editor → New query
-- ============================================================

-- Per-user settings (one row per user)
create table public.settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  focus       int not null default 25,
  short_break int not null default 5,
  long_break  int not null default 15,
  cycles      int not null default 4,
  auto_start  boolean not null default false,
  sound       boolean not null default true
);

-- Tasks
create table public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  estimate   int not null default 1,
  completed  int not null default 0,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Finished focus sessions (the "records")
create table public.sessions (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  task_id   uuid references public.tasks(id) on delete set null,
  task_name text not null default '',
  minutes   int not null,
  date      timestamptz not null default now()
);

create index sessions_user_date on public.sessions (user_id, date desc);

-- ---- Row Level Security: each user sees only their own data ----
alter table public.settings enable row level security;
alter table public.tasks    enable row level security;
alter table public.sessions enable row level security;

create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own sessions" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
