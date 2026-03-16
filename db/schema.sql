-- Users (cached from Slack)
CREATE TABLE IF NOT EXISTS users (
  slack_id     TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Surveys
CREATE TABLE IF NOT EXISTS surveys (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | active | closed
  anonymous   BOOLEAN NOT NULL DEFAULT FALSE,
  deadline    DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Questions
CREATE TABLE IF NOT EXISTS questions (
  id          SERIAL PRIMARY KEY,
  survey_id   INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL, -- order of questions
  text        TEXT NOT NULL,
  type        TEXT NOT NULL, -- single_select | multi_select | scale | open_text
  options     JSONB, -- only used for single_select and multi_select
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Responses (one per user per survey)
CREATE TABLE IF NOT EXISTS responses (
  id          SERIAL PRIMARY KEY,
  survey_id   INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  slack_id    TEXT NOT NULL REFERENCES users(slack_id),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(survey_id, slack_id) -- prevents duplicate submissions
);

-- Response Items (one per question per response)
CREATE TABLE IF NOT EXISTS response_items (
  id          SERIAL PRIMARY KEY,
  response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer      TEXT -- for multi_select, store as comma-separated values
);
