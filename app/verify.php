<?php
/**
 * FundedControl — Email Verification (v3.3.0 Phase 4)
 * Validates token from email link, activates account
 */
require_once 'includes/config.php';

$status = 'invalid';
$message = '';

$token = trim($_GET['token'] ?? '');

if ($token) {
    $db = getDB();

    // Find user with this token
    $s = $db->prepare("SELECT id, username, email, email_verified FROM users WHERE verification_token = ?");
    $s->execute([$token]);
    $user = $s->fetch();

    if ($user) {
        if ($user['email_verified'] == 1) {
            $status = 'already';
            $message = 'Your email is already verified. You can sign in.';
        } else {
            // Verify the email
            $s = $db->prepare("UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?");
            $s->execute([$user['id']]);
            $status = 'success';
            $message = 'Email verified! Your account is ready.';
        }
    } else {
        $status = 'invalid';
        $message = 'This verification link is invalid or has expired.';
    }
} else {
    $status = 'invalid';
    $message = 'No verification token provided.';
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>FundedControl — Email Verification</title>
<link rel="icon" type="image/x-icon" href="favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#FAFBFC;color:#0B1D3A;font-family:'Outfit',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:40px;max-width:460px;width:100%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.05)}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:22px;font-weight:600;margin-bottom:8px}
p{font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px}
.btn{display:inline-block;padding:12px 32px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;text-decoration:none;transition:all 0.2s}
.btn-primary{background:#1A56DB;color:#FFFFFF}
.btn-primary:hover{opacity:0.9}
.btn-ghost{background:transparent;color:#6C7A8D;border:1px solid #E2E8F0}
.btn-ghost:hover{border-color:#CBD5E1;color:#0B1D3A}
.success .icon{color:#0FA958}
.invalid .icon{color:#DC3545}
.already .icon{color:#3B82F6}
.logo{margin-bottom:24px}
.logo img{height:40px;border-radius:8px}
.logo-text{font-size:16px;font-weight:600;color:#0B1D3A;margin-top:8px;letter-spacing:0.5px}
</style>
</head>
<body>

<div class="card <?= $status ?>">
  <div class="logo">
    <img src="media/fc-logo.png" alt="FundedControl">
    <div class="logo-text">FundedControl</div>
  </div>

  <?php if ($status === 'success'): ?>
    <div class="icon">✅</div>
    <h1>Email Verified!</h1>
    <p>Your account is active. Sign in and start journaling your trades.</p>
    <a href="login.php" class="btn btn-primary">Sign In →</a>

  <?php elseif ($status === 'already'): ?>
    <div class="icon">ℹ️</div>
    <h1>Already Verified</h1>
    <p>Your email has already been verified. You're all set.</p>
    <a href="login.php" class="btn btn-primary">Sign In →</a>

  <?php else: ?>
    <div class="icon">❌</div>
    <h1>Invalid Link</h1>
    <p><?= htmlspecialchars($message) ?></p>
    <div style="display:flex;gap:10px;justify-content:center">
      <a href="login.php" class="btn btn-primary">Sign In</a>
      <a href="register.php" class="btn btn-ghost">Create Account</a>
    </div>
  <?php endif; ?>
</div>

</body>
</html>
