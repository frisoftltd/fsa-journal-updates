-- Daily Report Card module (see build briefing, 2026-09-23). Ten tables: the card itself,
-- its dynamic session blocks, per-user block templates (+ their blocks), standing mantras
-- + daily check-off, ticker rows + chart images, and the AI review pair (reviews +
-- exploded findings).
--
-- Two deliberate departures from the briefing's literal schema, both judgment calls made
-- while matching this migration to the real schema (see CLAUDE.md's own migration rule,
-- §3A item 2):
--
-- 1. "account_id" -> "challenge_id". This codebase's real per-user trading-account concept
--    is a challenge (challenges table) — there is no separate "accounts" table anywhere in
--    this schema. challenge_id keeps the briefing's exact NOT NULL DEFAULT 0 design (MySQL
--    treats NULL as distinct in a unique index, so a nullable column would let the same
--    user/date collide across challenges) and, like the briefing's own account_id, carries
--    no foreign key: 0 is a real, permanent sentinel ("no challenge selected"), not a
--    not-yet-known value, and challenges.id — an AUTO_INCREMENT PK — never contains a 0 row
--    for an FK to legitimately point at.
-- 2. utf8mb4_unicode_ci -> utf8mb4_general_ci. Every existing table in this schema uses
--    general_ci (CLAUDE.md §3A, "Adding a migration" step 2, states this explicitly after
--    2026_09_15_0001 shipped without it and needed a follow-up fix). Matching the
--    established convention rather than the briefing's literal collation.

CREATE TABLE report_cards (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             INT UNSIGNED NOT NULL,
  challenge_id        INT UNSIGNED NOT NULL DEFAULT 0,
  card_date           DATE NOT NULL,
  overall_grade       ENUM('A','B','C','D','F') DEFAULT NULL,
  pnl                 DECIMAL(14,2) DEFAULT NULL,
  pnl_auto            DECIMAL(14,2) DEFAULT NULL,
  morning_temperature ENUM('great','good','neutral','off','bad') DEFAULT NULL,
  sleep_quality       TINYINT UNSIGNED DEFAULT NULL,
  primary_goal        TEXT,
  learned             TEXT,
  changes_needed      TEXT,
  easiest_money_trade TEXT,
  overview            TEXT,
  wins                TEXT,
  status              ENUM('draft','complete') NOT NULL DEFAULT 'draft',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_report_card (user_id, challenge_id, card_date),
  KEY idx_user_date (user_id, card_date),
  CONSTRAINT fk_rc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_blocks (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  card_id        INT UNSIGNED NOT NULL,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  label          VARCHAR(80) NOT NULL,
  start_utc      TIME NOT NULL,
  end_utc        TIME NOT NULL,
  market_session ENUM('asia','london','newyork','none') NOT NULL DEFAULT 'none',
  grade          ENUM('A','B','C','D','F') DEFAULT NULL,
  playbook_only  TINYINT(1) NOT NULL DEFAULT 0,
  sizing         VARCHAR(40) DEFAULT NULL,
  in_my_favor    TINYINT(1) NOT NULL DEFAULT 0,
  comments       TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_card_order (card_id, sort_order),
  CONSTRAINT fk_rcb_card FOREIGN KEY (card_id) REFERENCES report_cards (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_templates (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  name            VARCHAR(80) NOT NULL,
  is_default      TINYINT(1) NOT NULL DEFAULT 0,
  weekday_default TINYINT UNSIGNED DEFAULT NULL COMMENT '0=Sun .. 6=Sat, NULL = none',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id),
  CONSTRAINT fk_rct_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_template_blocks (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id    INT UNSIGNED NOT NULL,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  label          VARCHAR(80) NOT NULL,
  start_utc      TIME NOT NULL,
  end_utc        TIME NOT NULL,
  market_session ENUM('asia','london','newyork','none') NOT NULL DEFAULT 'none',
  PRIMARY KEY (id),
  KEY idx_template_order (template_id, sort_order),
  CONSTRAINT fk_rctb_template FOREIGN KEY (template_id) REFERENCES report_card_templates (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_mantras (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  text       VARCHAR(255) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_active (user_id, is_active),
  CONSTRAINT fk_rcm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_mantra_checks (
  card_id    INT UNSIGNED NOT NULL,
  mantra_id  INT UNSIGNED NOT NULL,
  checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (card_id, mantra_id),
  CONSTRAINT fk_rcmc_card   FOREIGN KEY (card_id)   REFERENCES report_cards (id) ON DELETE CASCADE,
  CONSTRAINT fk_rcmc_mantra FOREIGN KEY (mantra_id) REFERENCES report_card_mantras (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_tickers (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  card_id        INT UNSIGNED NOT NULL,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ticker         VARCHAR(30) NOT NULL,
  pnl            DECIMAL(14,2) DEFAULT NULL,
  trade_analysis TEXT,
  chart_notes    TEXT,
  trade_id       INT UNSIGNED DEFAULT NULL COMMENT 'optional link to journal trade',
  PRIMARY KEY (id),
  KEY idx_card_order (card_id, sort_order),
  CONSTRAINT fk_rcti_card  FOREIGN KEY (card_id)  REFERENCES report_cards (id) ON DELETE CASCADE,
  CONSTRAINT fk_rcti_trade FOREIGN KEY (trade_id) REFERENCES trades (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_ticker_images (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticker_id  INT UNSIGNED NOT NULL,
  file_path  VARCHAR(255) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticker (ticker_id),
  CONSTRAINT fk_rctim_ticker FOREIGN KEY (ticker_id) REFERENCES report_card_tickers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_ai_reviews (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  card_id         INT UNSIGNED DEFAULT NULL COMMENT 'NULL for weekly/monthly reviews',
  scope           ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          ENUM('pending','running','complete','failed') NOT NULL DEFAULT 'pending',
  model           VARCHAR(64) DEFAULT NULL,
  prompt_version  VARCHAR(16) DEFAULT NULL,
  input_payload   JSON DEFAULT NULL COMMENT 'exact behaviour+thinking snapshot sent',
  output_payload  JSON DEFAULT NULL COMMENT 'full structured response',
  alignment_score TINYINT UNSIGNED DEFAULT NULL COMMENT '0-100, stated intent vs executed behaviour',
  discipline_score TINYINT UNSIGNED DEFAULT NULL,
  summary         TEXT,
  one_change      TEXT COMMENT 'single change for the next session',
  suggested_goal  TEXT COMMENT 'proposed primary goal for tomorrow',
  input_tokens    INT UNSIGNED DEFAULT NULL,
  output_tokens   INT UNSIGNED DEFAULT NULL,
  error_message   TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_user_period (user_id, scope, period_start),
  KEY idx_card (card_id),
  CONSTRAINT fk_rcar_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_rcar_card FOREIGN KEY (card_id) REFERENCES report_cards (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE report_card_ai_findings (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id  INT UNSIGNED NOT NULL,
  type       ENUM('contradiction','behavior_pattern','thinking_pattern','strength','risk') NOT NULL,
  severity   ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  title      VARCHAR(160) NOT NULL,
  detail     TEXT,
  evidence   JSON DEFAULT NULL COMMENT 'trade ids, block ids, quoted card fields',
  acknowledged TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_review (review_id),
  KEY idx_type_sev (type, severity),
  CONSTRAINT fk_rcaf_review FOREIGN KEY (review_id) REFERENCES report_card_ai_reviews (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
