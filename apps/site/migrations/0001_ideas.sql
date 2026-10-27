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
  -- How many votes it has, which the triggers below keep in step with votes.
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
-- ID, which the browser works out itself, so the ID never leaves it. Nothing else is kept with it,
-- not even when, and the table has no row numbers, so one browser's votes can't be matched up.
CREATE TABLE votes (
  hash TEXT PRIMARY KEY,
  idea TEXT NOT NULL REFERENCES ideas (id)
) WITHOUT ROWID;

CREATE INDEX votes_idea ON votes (idea);

-- Each idea's count follows its votes, one at a time, so a vote never counts them all again:
-- one cast, one taken back, and one moved over to another idea by a merge.
CREATE TRIGGER votes_cast AFTER INSERT ON votes
BEGIN
  UPDATE ideas SET votes = votes + 1 WHERE id = NEW.idea;
END;

CREATE TRIGGER votes_taken_back AFTER DELETE ON votes
BEGIN
  UPDATE ideas SET votes = votes - 1 WHERE id = OLD.idea;
END;

CREATE TRIGGER votes_moved AFTER UPDATE OF idea ON votes
BEGIN
  UPDATE ideas SET votes = votes - 1 WHERE id = OLD.idea;
  UPDATE ideas SET votes = votes + 1 WHERE id = NEW.idea;
END;
