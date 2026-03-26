<?php
require_once 'includes/config.php';
if (isset($_SESSION['user_id'])) { header('Location: index.php'); exit; }

$error = '';
if ($_SERVER['REQUEST_METHOD']==='POST') {
    $db = getDB();
    $s = $db->prepare("SELECT * FROM users WHERE username=? OR email=?");
    $input = trim($_POST['username']);
    $s->execute([$input, $input]);
    $u = $s->fetch();
    if ($u && password_verify($_POST['password'],$u['password'])) {
        // Check if email verified (skip for legacy users without email)
        if ($u['email'] && isset($u['email_verified']) && $u['email_verified'] == 0) {
            $error = 'Please verify your email before signing in. Check your inbox.';
        } else {
            $_SESSION['user_id'] = $u['id'];
            $_SESSION['username'] = $u['username'];
            header('Location: index.php'); exit;
        }
    } else { $error = 'Invalid username or password'; }
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>FundedControl — Sign In</title>
<link rel="icon" type="image/x-icon" href="favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="favicon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
    --fc-bg:#FAFBFC;--fc-card:#FFFFFF;--fc-border:#E2E8F0;
    --fc-sidebar:#0B1D3A;--fc-blue:#1A56DB;--fc-green:#0FA958;--fc-red:#DC3545;
    --fc-text:#0B1D3A;--fc-muted:#6C7A8D;--fc-light:#F0F3F7;
    --font-head:'Outfit',sans-serif;--font-mono:'JetBrains Mono',monospace;
}
body{background:var(--fc-bg);color:var(--fc-text);font-family:var(--font-head);min-height:100vh;display:flex}

/* ── Left panel — dark brand showcase ── */
.brand-panel{
    width:45%;min-height:100vh;background:var(--fc-sidebar);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:60px 40px;position:relative;overflow:hidden;
}
.brand-panel::before{
    content:'';position:absolute;top:-50%;right:-50%;width:100%;height:100%;
    background:radial-gradient(circle,rgba(26,86,219,0.15) 0%,transparent 70%);
}
.brand-panel::after{
    content:'';position:absolute;bottom:-30%;left:-30%;width:80%;height:80%;
    background:radial-gradient(circle,rgba(15,169,88,0.08) 0%,transparent 70%);
}
.brand-content{position:relative;z-index:1;text-align:center;max-width:380px}
.brand-logo{margin-bottom:32px}
.brand-logo img{max-width:200px;height:auto;border-radius:16px}
.brand-name{font-size:28px;font-weight:600;color:#FFFFFF;letter-spacing:1px;margin-bottom:8px}
.brand-tagline{font-size:15px;color:var(--fc-light);font-weight:400;line-height:1.6;opacity:0.85;margin-bottom:40px}
.brand-features{text-align:left}
.brand-feature{display:flex;align-items:flex-start;gap:12px;margin-bottom:20px}
.brand-feature-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.brand-feature-icon.blue{background:rgba(26,86,219,0.2)}
.brand-feature-icon.green{background:rgba(15,169,88,0.2)}
.brand-feature-icon.amber{background:rgba(245,158,11,0.2)}
.brand-feature h4{font-size:13px;font-weight:600;color:#FFFFFF;margin-bottom:2px}
.brand-feature p{font-size:12px;color:rgba(240,243,247,0.6);line-height:1.5}

/* ── Right panel — login form ── */
.login-panel{
    flex:1;display:flex;align-items:center;justify-content:center;padding:40px;
}
.login-wrap{width:100%;max-width:380px}
.login-header{margin-bottom:32px}
.login-header h2{font-size:24px;font-weight:600;color:var(--fc-text);margin-bottom:4px}
.login-header p{font-size:14px;color:var(--fc-muted)}
.form-group{margin-bottom:18px}
.form-group label{display:block;font-size:12px;font-weight:500;color:var(--fc-muted);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px}
.form-group input{
    width:100%;background:#F1F5F9;border:1px solid var(--fc-border);border-radius:8px;
    color:var(--fc-text);padding:12px 14px;font-family:var(--font-head);font-size:14px;
    font-weight:400;outline:none;transition:border-color 0.2s,box-shadow 0.2s;
}
.form-group input:focus{border-color:var(--fc-blue);box-shadow:0 0 0 3px rgba(26,86,219,0.1)}
.form-group input::placeholder{color:#94A3B8}
.btn-login{
    width:100%;padding:13px;border-radius:8px;border:none;
    background:var(--fc-blue);color:white;font-family:var(--font-head);
    font-size:14px;font-weight:600;letter-spacing:0.5px;cursor:pointer;
    transition:all 0.2s;margin-top:8px;
}
.btn-login:hover{background:#1E40AF;box-shadow:0 4px 12px rgba(26,86,219,0.3)}
.error{background:#FDEAEA;border:1px solid #F5C6CB;border-radius:8px;padding:10px 14px;font-size:13px;color:var(--fc-red);margin-bottom:16px;text-align:center}
.login-footer{text-align:center;margin-top:24px;font-size:12px;color:var(--fc-muted)}
.login-footer a{color:var(--fc-blue);text-decoration:none;font-weight:500}
.login-footer a:hover{text-decoration:underline}

/* ── Mobile ── */
@media(max-width:900px){
    body{flex-direction:column}
    .brand-panel{width:100%;min-height:auto;padding:40px 24px}
    .brand-features{display:none}
    .brand-tagline{margin-bottom:0}
    .login-panel{padding:30px 20px}
}
@media(max-width:480px){
    .brand-logo img{max-width:140px}
    .brand-name{font-size:22px}
}
</style>
</head>
<body>

<!-- ══ Brand Panel (Left) ══ -->
<div class="brand-panel">
  <div class="brand-content">
    <div class="brand-logo">
      <img src="media/fc-logo.png" alt="FundedControl">
    </div>
    <div class="brand-name">FundedControl</div>
    <div class="brand-tagline">Control Your Trading. Get Funded. Stay Funded.</div>
    <div class="brand-features">
      <div class="brand-feature">
        <div class="brand-feature-icon blue">📊</div>
        <div><h4>Professional Journal</h4><p>Track every trade with precision. Charts, stats, and insights in one place.</p></div>
      </div>
      <div class="brand-feature">
        <div class="brand-feature-icon green">🏆</div>
        <div><h4>Any Prop Firm</h4><p>FTMO, BitFunded, MyForexFunds — set your own rules and limits.</p></div>
      </div>
      <div class="brand-feature">
        <div class="brand-feature-icon amber">🧠</div>
        <div><h4>Discipline First</h4><p>Pre-trade checklists, risk alerts, and weekly reviews keep you accountable.</p></div>
      </div>
    </div>
  </div>
</div>

<!-- ══ Login Panel (Right) ══ -->
<div class="login-panel">
  <div class="login-wrap">
    <div class="login-header">
      <h2>Welcome back</h2>
      <p>Sign in to your trading journal</p>
    </div>
    <?php if($error): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <form method="POST">
      <div class="form-group"><label>Username or Email</label><input type="text" name="username" placeholder="Username or email" required autofocus></div>
      <div class="form-group"><label>Password</label><input type="password" name="password" placeholder="Enter your password" required></div>
      <button type="submit" class="btn-login">Sign In</button>
    </form>
    <div class="login-footer">
      <p>Don't have an account? <a href="register.php">Create one free</a></p>
      <p style="margin-top:16px;font-size:11px;color:#94A3B8">Discipline is the edge.</p>
    </div>
  </div>
</div>

</body>
</html>
