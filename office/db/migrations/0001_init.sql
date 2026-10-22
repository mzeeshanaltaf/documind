-- DocuMind Office state (docs/plan/office/README.md › Data model).
-- scripts/migrate.mjs fills in the two schema placeholders: the office's own (OFFICE_DB_SCHEMA)
-- and DocuMind's Better Auth schema; names are never hard-coded. Every row belongs to a DocuMind user
-- (and org), so deleting either in DocuMind removes the office state with it.

create table {office}.players (
  user_id      text primary key references {auth}."user" (id) on delete cascade,
  -- First name plus last initial; shown on leaderboards.
  display_name text not null,
  -- Colours and look (skin, hair, top, bottom, shoes, badge), validated in lib/player.ts.
  avatar       jsonb not null default '{}'::jsonb,
  -- Quality, volumes, reduced motion, name tags, hide_from_leaderboard, last_org/last_location.
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table {office}.progress (
  user_id      text not null references {auth}."user" (id) on delete cascade,
  org_id       text not null references {auth}.organization (id) on delete cascade,
  -- Access cards held: department names.
  cards        text[] not null default '{}',
  -- {quest_id: {progress, done_at}}
  quests       jsonb not null default '{}'::jsonb,
  -- {achievement_id: unlocked_at}
  achievements jsonb not null default '{}'::jsonb,
  -- Cities and rooms visited, citations opened, questions per department and city.
  stats        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- The org cascade looks rows up by org_id alone.
create index progress_org_id_idx on {office}.progress (org_id);

create table {office}.game_scores (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null references {auth}."user" (id) on delete cascade,
  org_id     text not null references {auth}.organization (id) on delete cascade,
  game       text not null constraint game_scores_game_check
               check (game in ('trivia', 'sort_toss', 'table_tennis')),
  score      integer not null constraint game_scores_score_check check (score >= 0),
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Leaderboards: the best scores per org and game.
create index game_scores_org_game_score_idx on {office}.game_scores (org_id, game, score desc);
-- The user cascade and "my best score".
create index game_scores_user_id_idx on {office}.game_scores (user_id);
