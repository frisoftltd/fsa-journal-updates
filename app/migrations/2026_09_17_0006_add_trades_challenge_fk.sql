-- Adds the foreign key trades.challenge_id -> challenges(id) that has never existed on
-- this schema, because challenges was MyISAM until 2026_09_17_0004 converted it to
-- InnoDB (MyISAM tables can't be FK parents, and an InnoDB child can't reference one).
--
-- Deliberately the LAST migration in this batch, on its own, after the InnoDB/utf8mb4
-- conversion (2026_09_17_0004) and the challenge-6 data fixes (2026_09_17_0005) have
-- already applied. If an orphaned trades.challenge_id value exists (a trade pointing at
-- a challenge that no longer exists — possible on a schema with no history of enforcing
-- this), the guard below fails loudly and this file alone is left pending/failed; it does
-- not block 0004 or 0005, which do not depend on this FK existing. Per the brief for this
-- release: report an orphan rather than force the constraint past it (e.g. by nulling out
-- orphaned rows unasked). If this file fails, run
--   SELECT t.id, t.challenge_id FROM trades t
--   LEFT JOIN challenges c ON c.id = t.challenge_id
--   WHERE t.challenge_id IS NOT NULL AND c.id IS NULL;
-- to see exactly which rows are orphaned before deciding how to handle them.
--
-- ON DELETE SET NULL, not CASCADE: trades.challenge_id is already read as nullable
-- everywhere in this codebase ("WHERE challenge_id=? OR challenge_id IS NULL" is the
-- Challenge Scoping Rule in CLAUDE.md §3) — a trade losing its challenge on delete is
-- consistent with that existing meaning of NULL, whereas deleting a challenge should never
-- silently delete a trader's logged trades.
CREATE TEMPORARY TABLE _trades_challenge_fk_guard (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _trades_challenge_fk_guard (ok) VALUES (
    (
        SELECT COUNT(*) FROM trades t
        LEFT JOIN challenges c ON c.id = t.challenge_id
        WHERE t.challenge_id IS NOT NULL AND c.id IS NULL
    ) = 0
);
DROP TEMPORARY TABLE _trades_challenge_fk_guard;

ALTER TABLE trades
    ADD CONSTRAINT fk_trades_challenge_id FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE SET NULL;
