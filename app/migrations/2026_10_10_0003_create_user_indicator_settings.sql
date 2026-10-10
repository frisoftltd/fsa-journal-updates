-- v3.25.0 — per-user, per-indicator saved settings (FSA Gate 1's own Inputs/Style/
-- Visibility dialog this release adds). Deliberately a NEW table rather than reusing
-- user_drawing_defaults (2026_09_29_0001): that table is keyed on `tool` (an ENUM of the
-- 7 drawing tools) and only ever stores a settings object with no geometry, which is the
-- right shape for "what a brand-new drawing of this tool starts with" but not for an
-- indicator's own engine-affecting input (atrMult) sitting alongside pure display
-- preferences -- Gate1SettingsController validates/shapes this payload differently
-- (swing size range, #RRGGBB colours, a visibility-by-timeframe map) and a shared ENUM
-- would need to grow for every future indicator anyway. `indicator` is a plain VARCHAR,
-- not an ENUM, since (unlike the fixed 7 drawing tools) more indicators are the obvious
-- next thing this table will hold.
--
-- One row per (user, indicator) -- UNIQUE KEY enforces this; Gate1SettingsController's
-- own "INSERT ... AS new ON DUPLICATE KEY UPDATE settings_json = new.settings_json"
-- (BacktestDrawingController::saveDefault()'s own pattern) is what saving settings
-- actually runs.
--
-- CREATE TABLE IF NOT EXISTS only -- brand-new table, no MariaDB-only conditional-DDL
-- clause needed (CLAUDE.md §3A step 2a).
CREATE TABLE IF NOT EXISTS user_indicator_settings (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Signed, matching users.id -- same precedent as user_drawing_defaults.user_id.
  user_id       INT NOT NULL,
  indicator     VARCHAR(40) NOT NULL,
  settings_json JSON NOT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_indicator (user_id, indicator),
  CONSTRAINT fk_uis_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
