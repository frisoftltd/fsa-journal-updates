<?php
/**
 * php -S front controller for the UI harness's temp copy of app/. Copied to the temp
 * dir's root by setup.js, so __DIR__ below resolves to that copy, not this repo.
 * The only thing the built-in server needs help with is "/" -> index.php; every other
 * request (css/js assets, includes/api.php with its query string, vendor/*) is a real
 * file that already exists in the copy, so returning false lets php -S serve/execute it
 * exactly as it would any other file.
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/' || $path === '') {
    require __DIR__ . '/index.php';
    return true;
}

$file = __DIR__ . $path;
if (is_file($file)) {
    return false;
}

http_response_code(404);
echo 'Not found: ' . htmlspecialchars($path);
return true;
