<?php
require_once 'includes/config.php';
if (isset($_SESSION['user_id'])) { header('Location: index.php'); exit; }

$error = '';
if ($_SERVER['REQUEST_METHOD']==='POST') {
    $db = getDB();
    $s = $db->prepare("SELECT * FROM users WHERE username=?");
    $s->execute([trim($_POST['username'])]);
    $u = $s->fetch();
    if ($u && password_verify($_POST['password'],$u['password'])) {
        $_SESSION['user_id'] = $u['id'];
        $_SESSION['username'] = $u['username'];
        header('Location: index.php'); exit;
    } else { $error = 'Invalid username or password'; }
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>FSA Journal — Login</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0d14;--card:#1a2035;--border:#2a3555;--blue:#4f7cff;--green:#00d4a0;--text:#e8eaf6;--text2:#8892b0;--font-head:'Space Mono',monospace;--font-body:'DM Sans',sans-serif}
body{background:var(--bg);color:var(--text);font-family:var(--font-body);min-height:100vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse at 20% 50%,rgba(79,124,255,0.08) 0%,transparent 60%),radial-gradient(ellipse at 80% 20%,rgba(0,212,160,0.06) 0%,transparent 60%)}
.wrap{width:100%;max-width:400px;padding:20px}
.logo{text-align:center;margin-bottom:40px}
.logo h1{font-family:var(--font-head);font-size:22px;color:var(--blue);letter-spacing:3px}
.logo p{color:var(--text2);font-size:13px;margin-top:6px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:32px}
.card h2{font-family:var(--font-head);font-size:13px;letter-spacing:2px;color:var(--text2);margin-bottom:24px;text-align:center}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.form-group input{width:100%;background:#111520;border:1px solid var(--border);border-radius:8px;color:var(--text);padding:12px 14px;font-family:var(--font-body);font-size:14px;outline:none;transition:border-color 0.2s}
.form-group input:focus{border-color:var(--blue)}
.btn{width:100%;padding:13px;border-radius:8px;border:none;background:var(--blue);color:white;font-family:var(--font-head);font-size:12px;letter-spacing:1px;cursor:pointer;transition:opacity 0.2s;margin-top:8px}
.btn:hover{opacity:0.85}
.error{background:rgba(255,77,109,0.1);border:1px solid rgba(255,77,109,0.3);border-radius:8px;padding:10px 14px;font-size:13px;color:#ff4d6d;margin-bottom:16px;text-align:center}
.hint{text-align:center;margin-top:20px;font-size:12px;color:var(--text2)}
.hint span{color:var(--green);font-family:var(--font-head)}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">
    <h1>FSA JOURNAL</h1>
    <p>Professional Trading Journal</p>
  </div>
  <div class="card">
    <h2>SIGN IN</h2>
    <?php if($error): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <form method="POST">
      <div class="form-group"><label>Username</label><input type="text" name="username" placeholder="acrob" required autofocus></div>
      <div class="form-group"><label>Password</label><input type="password" name="password" placeholder="••••••••" required></div>
      <button type="submit" class="btn">LOGIN →</button>
    </form>
  </div>

</div>
</body>
</html>
