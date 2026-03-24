
<!-- ══ PROFILE SETTINGS ══ -->
<div class="page" id="page-profile">
  <div style="max-width:600px">
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">👤 Your Profile</div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px;background:var(--bg3);border-radius:var(--radius)">
        <div class="avatar" id="profile-avatar-preview" style="width:56px;height:56px;font-size:22px;background:var(--blue)">A</div>
        <div>
          <div style="font-family:var(--font-head);font-size:14px" id="profile-name-preview">Trader</div>
          <div style="font-size:12px;color:var(--text3)" id="profile-bio-preview">No bio yet</div>
        </div>
      </div>
      <div class="form-grid-2" style="gap:12px">
        <div class="form-group"><label>Display Name</label><input type="text" id="prof-display_name" placeholder="Your name"></div>
        <div class="form-group"><label>Avatar Color</label><input type="color" id="prof-avatar_color" value="#4f7cff" style="height:40px;cursor:pointer"></div>
        <div class="form-group full"><label>Bio (optional)</label><textarea id="prof-bio" rows="2" placeholder="Tell traders about yourself..."></textarea></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">🔒 Change Password</div>
      <div class="form-grid-2" style="gap:12px">
        <div class="form-group"><label>Current Password</label><input type="password" id="prof-current_password" placeholder="••••••••"></div>
        <div class="form-group"><label>New Password</label><input type="password" id="prof-new_password" placeholder="••••••••"></div>
      </div>
    </div>
    <button class="btn btn-primary" onclick="saveProfile()" style="width:100%;padding:12px">Save Profile</button>
  </div>
</div>
