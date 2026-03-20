<?php
/**
 * FundedControl — API Entry Point v3.0.0
 * This file is now a thin wrapper. All logic lives in controllers.
 */
define('IS_API', true);
header('Content-Type: application/json');

require_once 'config.php';
require_once 'helpers.php';
requireLogin();
csrfCheck();

require_once 'router.php';
