<?php
/**
 * UI harness stub for includes/config.php (never committed to the real repo -- Acrob
 * sets the real one by hand on the server, see CLAUDE.md's migration/DB section).
 * index.php's top two lines are `require_once 'includes/config.php'; requireLogin();`,
 * then `currentUser()` right after -- these two functions are the only things any page
 * this harness exercises actually calls from config.php. No DB handle, no mail
 * credentials, no ANTHROPIC_API_KEY -- nothing else in this app is reachable through the
 * flows the harness drives (backtest.php is pure client-side state + the mocked
 * includes/api.php, per this harness's own setup.js).
 */
function requireLogin() {}
function currentUser() { return ['id' => 1, 'name' => 'test']; }
