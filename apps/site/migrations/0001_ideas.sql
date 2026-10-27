-- The ideas board at factwright.com/roadmap (worker/ideas.ts). A suggestion comes in as "new",
-- which only the admin page shows, until Steve approves it. Approved ideas are on the page with
-- their votes, and the roadmap is the ideas planned, in progress and shipped.
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  words TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'considering', 'planned', 'in-progress', 'shipped', 'not-planned', 'merged')
  ),
  -- The version it shipped in, such as 0.19.0, once it's shipped.
  version TEXT,
  -- How many votes it has, counted again from votes below with each change.
  votes INTEGER NOT NULL DEFAULT 0,
  -- Where to write back to whoever suggested it, if they gave an address, until it's closed.
  email TEXT,
  -- The idea it was merged into, which took its votes. Always one that isn't merged itself.
  merged_into TEXT REFERENCES ideas (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ideas_status ON ideas (status);
CREATE INDEX ideas_merged_into ON ideas (merged_into);

-- One vote for an idea from one browser: SHA-256 of the browser's random voter ID and the idea's
-- ID, which the browser works out itself, so the ID never leaves it. A vote keeps only its day,
-- and the table has no row numbers, so one browser's votes can't be matched up by when they came.
CREATE TABLE votes (
  hash TEXT PRIMARY KEY,
  idea TEXT NOT NULL REFERENCES ideas (id),
  day TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX votes_idea ON votes (idea);
