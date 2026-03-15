# fsa-journal-updates
## FSA Trading Journal — Update Repository

This repository controls automatic updates for the FSA Trading Journal app.

---

## Repository Structure

```
fsa-journal-updates/
├── version.json          ← Controls what version is current + changelog
└── app/
    ├── index.php
    ├── login.php
    ├── logout.php
    ├── includes/
    │   └── api.php       ← Never upload config.php (it has DB credentials)
    ├── css/
    │   └── style.css
    └── js/
        └── app.js
```

---

## How to Release an Update

### Step 1 — Edit version.json
Change the version number and add what changed:
```json
{
  "current_version": "2.1.0",
  "release_date": "2026-03-20",
  "release_notes": "What this update is about",
  "changelog": [
    "What was fixed or added",
    "Another improvement"
  ],
  "db_migrations": [],
  "files": [...same as before...]
}
```

### Step 2 — Upload changed files to /app/ folder
Only upload files that actually changed.
NEVER upload includes/config.php

### Step 3 — Commit
The app will detect the new version automatically.

---

## DB Migrations (for database changes)
If a new version needs a new table or column, add to db_migrations:
```json
"db_migrations": [
  {
    "name": "add_tags_column",
    "sql": "ALTER TABLE trades ADD COLUMN tags VARCHAR(200) DEFAULT NULL"
  }
]
```
The updater will run these automatically and skip them if already applied.

---

## Version Numbering
- 2.0.0 → 2.0.1  = Small bug fix
- 2.0.0 → 2.1.0  = New feature added
- 2.0.0 → 3.0.0  = Major redesign
