-- v3.20.1 — adds the required "Session name" field from the reworked setup screen
-- (e.g. "FSA 1H BTC 10k test"). A new migration, not an edit to
-- 2026_09_25_0001_create_backtest_tables.sql -- that file already shipped in the
-- tagged v3.20.0 release, and per this project's own standing rule (CLAUDE.md
-- v3.12.2: an applied migration is checksum-locked, only a confirmed-failed/never-run
-- one is safe to edit), there's no way to know from here whether it's already been
-- applied on live. Treating it as immutable and adding this column separately is the
-- same pattern every other post-release schema correction in this project has used.
--
-- NOT NULL DEFAULT '' rather than a hard NOT NULL with no default: "required" is
-- enforced at the application layer (BacktestController::createSession() rejects a
-- blank name), the same way every other required-but-free-text field in this schema
-- works (e.g. challenges.name). A DB-level empty-string default just means this ADD
-- COLUMN works unconditionally whether or not any backtest_sessions rows already exist,
-- without forcing a value for rows that predate this migration.
--
-- v3.20.3 fix: ADD COLUMN IF NOT EXISTS is MariaDB-only -- MySQL 8.0/8.4 have no such
-- clause and reject it with ERROR 1064. This file never actually reached live (it sorts
-- after 2026_09_25_0001, which failed first and stopped the runner), so this is its
-- first real run, but it needs the same information_schema-check + PREPARE/EXECUTE
-- pattern as every other conditional ALTER in this project going forward -- see
-- 2026_09_25_0001's own fix and CLAUDE.md's migration-authoring rules for the general
-- audit that prompted this.
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND COLUMN_NAME = 'session_name'
);
-- Backslash-escaped (\' not the SQL-standard doubled '') deliberately: migrate.php's own
-- splitSqlStatements() is a hand-rolled tokenizer that only recognizes a backslash as an
-- in-string escape (checks `$sql[$i-1] !== '\\'` before treating a quote as a closing
-- quote) -- it has no concept of doubled-quote escaping, so '''' here would read as
-- close-string / re-open-string / close-string / re-open-string and desynchronize this
-- statement from everything after it. Verified directly against that exact function
-- before shipping, not assumed from standard SQL rules.
SET @add_col_sql = IF(@col_exists = 0,
  'ALTER TABLE backtest_sessions ADD COLUMN session_name VARCHAR(120) NOT NULL DEFAULT \'\' AFTER user_id',
  'SELECT 1'
);
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;
