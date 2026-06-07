import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const ADMIN_USER = String(process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = String(process.env.ADMIN_PASS || '123456').trim();
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'licenses.json');
const ADMIN_SESSION = crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}`).digest('hex');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function readDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
  } catch {
    return { licenses: [] };
  }
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function normalizeKey(key) {
  return String(key || '').trim().toUpperCase();
}

function makeLicenseKey() {
  const chars = crypto.randomBytes(18).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return `DBM-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}`;
}

function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function addDuration(date, value, unit) {
  const next = new Date(date);
  const amount = Math.max(1, Number(value || 1));
  if (unit === 'hours') next.setHours(next.getHours() + amount);
  else if (unit === 'days') next.setDate(next.getDate() + amount);
  else next.setFullYear(next.getFullYear() + amount);
  return next;
}

function publicLicense(license) {
  const expired = new Date(license.expiresAt) < new Date();
  return {
    id: license.id,
    customerName: license.customerName,
    phone: license.phone,
    licenseKey: license.licenseKey,
    expiresAt: license.expiresAt,
    status: expired && license.status === 'active' ? 'expired' : license.status,
    deviceName: license.deviceName || '',
    deviceFingerprint: license.deviceFingerprint || '',
    deviceBound: Boolean(license.deviceFingerprint),
    activatedAt: license.activatedAt || '',
    lastSeenAt: license.lastSeenAt || '',
    resetRequestedAt: license.resetRequestedAt || '',
    resetReady: Boolean(license.resetPassword),
    createdAt: license.createdAt
  };
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => key && value)
  );
}

function setAdminSession(res) {
  res.cookie('debet_admin_session', ADMIN_SESSION, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  });
}

function requireAdmin(req, res, next) {
  if (parseCookies(req).debet_admin_session === ADMIN_SESSION) return next();
  return res.status(401).send(loginPage(''));
}

function loginPage(error) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Debet Manager Admin</title><style>
body{font-family:Segoe UI,Tahoma,sans-serif;background:#0a1628;color:#e2e8f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{width:360px;background:#0d1f3c;border:1px solid rgba(59,130,246,.35);border-radius:14px;padding:26px}
h1{font-size:20px;margin:0 0 18px;text-align:center}input{width:100%;box-sizing:border-box;background:#112447;border:1px solid rgba(59,130,246,.3);border-radius:8px;color:#e2e8f0;padding:11px;margin-bottom:10px;outline:none}
button{width:100%;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:11px;font-weight:700;cursor:pointer}.err{color:#f87171;font-size:13px;text-align:center;margin-bottom:10px;min-height:18px}
</style></head><body><form class="card" method="post" action="/admin/login"><h1>لوحة تراخيص Debet Manager</h1><div class="err">${error}</div><input name="user" placeholder="اسم المستخدم"><input name="pass" type="password" placeholder="كلمة المرور"><button type="submit">دخول</button></form></body></html>`;
}

app.post('/admin/login', (req, res) => {
  const user = String(req.body.user || '').trim();
  const pass = String(req.body.pass || '').trim();
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) return res.status(403).send(loginPage('بيانات الدخول غير صحيحة'));
  setAdminSession(res);
  res.redirect('/admin');
});

function checkLicense(license, deviceFingerprint, deviceName) {
  if (!license) return { status: 'missing' };
  if (license.status === 'suspended') return { status: 'suspended', expiresAt: license.expiresAt };
  if (new Date(license.expiresAt) < new Date()) return { status: 'expired', expiresAt: license.expiresAt };
  if (license.deviceFingerprint && license.deviceFingerprint !== deviceFingerprint) return { status: 'device_mismatch', expiresAt: license.expiresAt };
  license.lastSeenAt = new Date().toISOString();
  if (deviceName) license.deviceName = deviceName;
  return { status: 'active', expiresAt: license.expiresAt };
}

app.post('/api/license/activate', async (req, res) => {
  const licenseKey = normalizeKey(req.body.licenseKey);
  const deviceFingerprint = String(req.body.deviceFingerprint || '').trim();
  const deviceName = String(req.body.deviceName || '').trim();
  if (!licenseKey || !deviceFingerprint) return res.status(400).json({ status: 'missing', message: 'License key and device fingerprint are required' });
  const db = await readDb();
  const license = db.licenses.find((item) => item.licenseKey === licenseKey);
  const state = checkLicense(license, deviceFingerprint, deviceName);
  if (state.status !== 'active') return res.json(state);
  if (!license.deviceFingerprint) {
    license.deviceFingerprint = deviceFingerprint;
    license.deviceName = deviceName;
    license.activatedAt = new Date().toISOString();
  }
  await writeDb(db);
  res.json({ status: 'active', expiresAt: license.expiresAt });
});

app.post('/api/license/check', async (req, res) => {
  const licenseKey = normalizeKey(req.body.licenseKey);
  const deviceFingerprint = String(req.body.deviceFingerprint || '').trim();
  const deviceName = String(req.body.deviceName || '').trim();
  const db = await readDb();
  const license = db.licenses.find((item) => item.licenseKey === licenseKey);
  const state = checkLicense(license, deviceFingerprint, deviceName);
  if (license) await writeDb(db);
  res.json(state);
});

app.post('/api/password-reset/request', async (req, res) => {
  const licenseKey = normalizeKey(req.body.licenseKey);
  const deviceFingerprint = String(req.body.deviceFingerprint || '').trim();
  const deviceName = String(req.body.deviceName || '').trim();
  const db = await readDb();
  const license = db.licenses.find((item) => item.licenseKey === licenseKey);
  if (!license) return res.status(404).json({ message: 'License not found' });
  if (license.deviceFingerprint && license.deviceFingerprint !== deviceFingerprint) return res.status(403).json({ message: 'Device mismatch' });
  license.resetRequestedAt = new Date().toISOString();
  license.resetDeviceFingerprint = deviceFingerprint;
  license.resetDeviceName = deviceName;
  license.resetUsername = '';
  license.resetPassword = '';
  await writeDb(db);
  res.json({ ok: true });
});

app.post('/api/password-reset/check', async (req, res) => {
  const licenseKey = normalizeKey(req.body.licenseKey);
  const deviceFingerprint = String(req.body.deviceFingerprint || '').trim();
  const db = await readDb();
  const license = db.licenses.find((item) => item.licenseKey === licenseKey);
  if (!license || !license.resetPassword || license.resetDeviceFingerprint !== deviceFingerprint) return res.json({ ready: false });
  const payload = { ready: true, username: license.resetUsername || 'admin', password: license.resetPassword };
  license.resetUsername = '';
  license.resetPassword = '';
  license.resetRequestedAt = '';
  await writeDb(db);
  res.json(payload);
});

app.get('/admin', requireAdmin, (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Debet Manager Licenses</title><style>
body{font-family:Segoe UI,Tahoma,sans-serif;background:#0a1628;color:#e2e8f0;margin:0;padding:24px}.wrap{max-width:1180px;margin:auto}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
h1{font-size:22px;margin:0}.card{background:#0d1f3c;border:1px solid rgba(59,130,246,.25);border-radius:10px;padding:16px;margin-bottom:16px}
input,select{background:#112447;border:1px solid rgba(59,130,246,.25);border-radius:8px;color:#e2e8f0;padding:10px;outline:none}button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer}
button.warn{background:#f59e0b;color:#111}button.danger{background:#ef4444}button.ok{background:#10b981}.grid{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px}
table{width:100%;border-collapse:collapse;background:#0d1f3c;border-radius:10px;overflow:hidden}th,td{border-bottom:1px solid rgba(59,130,246,.18);padding:10px;text-align:right;font-size:13px;vertical-align:top}
th{background:#112447}.actions{display:flex;gap:6px;flex-wrap:wrap}.muted{color:#94a3b8;font-size:12px}.key,.device{direction:ltr;font-family:Consolas,monospace}.active{color:#34d399}.expired,.suspended{color:#f87171}.device_mismatch{color:#f59e0b}
</style></head><body><div class="wrap"><div class="top"><h1>لوحة أجهزة وتراخيص Debet Manager</h1><button onclick="loadLicenses()">تحديث</button></div><div id="message" class="muted" style="margin-bottom:12px"></div>
<div class="card"><div class="grid"><input id="customerName" placeholder="اسم العميل"><input id="phone" placeholder="الهاتف"><select id="years"><option value="1">سنة</option><option value="2">سنتين</option><option value="3">3 سنوات</option></select><button onclick="createLicense()">إنشاء مفتاح</button></div></div>
<table><thead><tr><th>العميل</th><th>المفتاح</th><th>الانتهاء</th><th>الحالة</th><th>الجهاز / Device ID</th><th>آخر ظهور</th><th>إجراءات</th></tr></thead><tbody id="rows"></tbody></table></div>
<script>
function setMessage(text,type=''){message.textContent=text;message.style.color=type==='err'?'#f87171':type==='ok'?'#34d399':'#94a3b8';}
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});if(!r.ok)throw new Error(await r.text());return r.json();}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadLicenses(){try{const data=await api('/api/admin/licenses');rows.innerHTML=data.licenses.map(l=>'<tr><td>'+esc(l.customerName)+'<div class="muted">'+esc(l.phone)+'</div></td><td class="key">'+esc(l.licenseKey)+'</td><td>'+esc(l.expiresAt.slice(0,16).replace('T',' '))+'</td><td class="'+esc(l.status)+'">'+esc(l.status)+(l.resetRequestedAt?'<div class="muted">طلب استعادة كلمة مرور</div>':'')+'</td><td>'+esc(l.deviceName||'غير مفعل')+'<div class="device muted">'+esc(l.deviceFingerprint||'لم يربط بعد')+'</div></td><td>'+esc(l.lastSeenAt?new Date(l.lastSeenAt).toLocaleString('ar-EG'):'-')+'</td><td><div class="actions"><button class="ok" onclick="renew(\\''+l.id+'\\')">تجديد سنة</button><button class="ok" onclick="renewCustom(\\''+l.id+'\\')">تجديد مخصص</button><button class="warn" onclick="resetPassword(\\''+l.id+'\\')">كلمة مرور جديدة</button><button class="warn" onclick="releaseDevice(\\''+l.id+'\\')">فك الجهاز</button><button class="danger" onclick="suspend(\\''+l.id+'\\')">إيقاف</button><button onclick="activate(\\''+l.id+'\\')">تشغيل</button></div></td></tr>').join('');setMessage(data.licenses.length?'تم تحميل التراخيص':'لا توجد تراخيص بعد');}catch(err){setMessage('خطأ: '+err.message,'err');}}
async function createLicense(){try{if(!customerName.value.trim()){setMessage('اسم العميل مطلوب','err');return;}const created=await api('/api/admin/licenses',{method:'POST',body:JSON.stringify({customerName:customerName.value,phone:phone.value,years:Number(years.value)})});customerName.value='';phone.value='';setMessage('تم إنشاء المفتاح: '+created.licenseKey,'ok');await loadLicenses();}catch(err){setMessage('فشل إنشاء المفتاح: '+err.message,'err');}}
async function renew(id){try{await api('/api/admin/licenses/'+id+'/renew',{method:'POST',body:JSON.stringify({years:1})});await loadLicenses();}catch(err){setMessage('فشل التجديد: '+err.message,'err');}}
async function renewCustom(id){try{const value=prompt('اكتب مدة التجديد بالأرقام، مثال 24');if(!value)return;const unit=prompt('اكتب نوع المدة: hours أو days أو years','hours')||'hours';await api('/api/admin/licenses/'+id+'/renew',{method:'POST',body:JSON.stringify({value:Number(value),unit})});await loadLicenses();}catch(err){setMessage('فشل التجديد المخصص: '+err.message,'err');}}
async function resetPassword(id){try{const username=prompt('اسم المستخدم الجديد','admin');if(!username)return;const password=prompt('كلمة المرور الجديدة');if(!password)return;await api('/api/admin/licenses/'+id+'/password-reset',{method:'POST',body:JSON.stringify({username,password})});setMessage('تم تجهيز كلمة المرور الجديدة للعميل','ok');await loadLicenses();}catch(err){setMessage('فشل تجهيز كلمة المرور: '+err.message,'err');}}
async function suspend(id){try{await api('/api/admin/licenses/'+id+'/suspend',{method:'POST'});await loadLicenses();}catch(err){setMessage('فشل الإيقاف: '+err.message,'err');}}
async function activate(id){try{await api('/api/admin/licenses/'+id+'/activate',{method:'POST'});await loadLicenses();}catch(err){setMessage('فشل التشغيل: '+err.message,'err');}}
async function releaseDevice(id){if(confirm('فك ربط الجهاز يسمح بتفعيل المفتاح على جهاز جديد. متابعة؟')){try{await api('/api/admin/licenses/'+id+'/release-device',{method:'POST'});await loadLicenses();}catch(err){setMessage('فشل فك الجهاز: '+err.message,'err');}}}
loadLicenses();
</script></body></html>`);
});

app.get('/api/admin/licenses', requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json({ licenses: db.licenses.map(publicLicense) });
});

app.post('/api/admin/licenses', requireAdmin, async (req, res) => {
  const db = await readDb();
  const now = new Date();
  const years = Math.max(1, Math.min(Number(req.body.years || 1), 10));
  const license = {
    id: crypto.randomUUID(),
    customerName: String(req.body.customerName || '').trim() || 'عميل بدون اسم',
    phone: String(req.body.phone || '').trim(),
    licenseKey: makeLicenseKey(),
    status: 'active',
    expiresAt: addYears(now, years).toISOString(),
    deviceFingerprint: '',
    deviceName: '',
    activatedAt: '',
    lastSeenAt: '',
    resetRequestedAt: '',
    resetDeviceFingerprint: '',
    resetDeviceName: '',
    resetUsername: '',
    resetPassword: '',
    createdAt: now.toISOString()
  };
  db.licenses.unshift(license);
  await writeDb(db);
  res.json(publicLicense(license));
});

app.post('/api/admin/licenses/:id/renew', requireAdmin, async (req, res) => {
  const db = await readDb();
  const license = db.licenses.find((item) => item.id === req.params.id);
  if (!license) return res.status(404).json({ message: 'Not found' });
  const base = new Date(license.expiresAt) > new Date() ? new Date(license.expiresAt) : new Date();
  license.expiresAt = addDuration(base, req.body.value || req.body.years || 1, req.body.unit || 'years').toISOString();
  license.status = 'active';
  await writeDb(db);
  res.json(publicLicense(license));
});

app.post('/api/admin/licenses/:id/password-reset', requireAdmin, async (req, res) => {
  const db = await readDb();
  const license = db.licenses.find((item) => item.id === req.params.id);
  if (!license) return res.status(404).json({ message: 'Not found' });
  if (!license.resetRequestedAt) return res.status(400).json({ message: 'No password reset request for this license' });
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  if (!username || password.length < 8) return res.status(400).json({ message: 'Username required and password must be at least 8 characters' });
  license.resetUsername = username;
  license.resetPassword = password;
  await writeDb(db);
  res.json(publicLicense(license));
});

app.post('/api/admin/licenses/:id/suspend', requireAdmin, async (req, res) => {
  const db = await readDb();
  const license = db.licenses.find((item) => item.id === req.params.id);
  if (!license) return res.status(404).json({ message: 'Not found' });
  license.status = 'suspended';
  await writeDb(db);
  res.json(publicLicense(license));
});

app.post('/api/admin/licenses/:id/activate', requireAdmin, async (req, res) => {
  const db = await readDb();
  const license = db.licenses.find((item) => item.id === req.params.id);
  if (!license) return res.status(404).json({ message: 'Not found' });
  license.status = 'active';
  await writeDb(db);
  res.json(publicLicense(license));
});

app.post('/api/admin/licenses/:id/release-device', requireAdmin, async (req, res) => {
  const db = await readDb();
  const license = db.licenses.find((item) => item.id === req.params.id);
  if (!license) return res.status(404).json({ message: 'Not found' });
  license.deviceFingerprint = '';
  license.deviceName = '';
  license.activatedAt = '';
  license.lastSeenAt = '';
  await writeDb(db);
  res.json(publicLicense(license));
});

app.listen(PORT, () => {
  console.log(`Debet Manager license server: http://127.0.0.1:${PORT}`);
  console.log(`Admin panel: http://127.0.0.1:${PORT}/admin`);
});
