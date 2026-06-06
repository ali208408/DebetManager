import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'change-this-password';
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'licenses.json');
const ADMIN_SESSION = crypto
  .createHash('sha256')
  .update(`${ADMIN_USER}:${ADMIN_PASS}`)
  .digest('hex');

app.use(express.json());

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

function publicLicense(license) {
  const now = new Date();
  const expired = new Date(license.expiresAt) < now;
  return {
    id: license.id,
    customerName: license.customerName,
    phone: license.phone,
    licenseKey: license.licenseKey,
    expiresAt: license.expiresAt,
    status: expired && license.status === 'active' ? 'expired' : license.status,
    deviceName: license.deviceName || '',
    deviceBound: Boolean(license.deviceFingerprint),
    activatedAt: license.activatedAt || '',
    createdAt: license.createdAt
  };
}

function requireAdmin(req, res, next) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => key && value)
  );
  if (cookies.debet_admin_session === ADMIN_SESSION) return next();

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Debet Manager Licenses"');
    return res.status(401).send('Authentication required');
  }
  const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) return res.status(403).send('Forbidden');
  res.cookie('debet_admin_session', ADMIN_SESSION, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  });
  next();
}

function checkLicense(license, deviceFingerprint) {
  if (!license) return { status: 'missing' };
  if (license.status === 'suspended') return { status: 'suspended' };
  if (new Date(license.expiresAt) < new Date()) return { status: 'expired', expiresAt: license.expiresAt };
  if (license.deviceFingerprint && license.deviceFingerprint !== deviceFingerprint) {
    return { status: 'device_mismatch', expiresAt: license.expiresAt };
  }
  return { status: 'active', expiresAt: license.expiresAt };
}

app.post('/api/license/activate', async (req, res) => {
  const licenseKey = normalizeKey(req.body.licenseKey);
  const deviceFingerprint = String(req.body.deviceFingerprint || '').trim();
  const deviceName = String(req.body.deviceName || '').trim();
  if (!licenseKey || !deviceFingerprint) return res.status(400).json({ status: 'missing', message: 'License key and device fingerprint are required' });

  const db = await readDb();
  const license = db.licenses.find((item) => item.licenseKey === licenseKey);
  const state = checkLicense(license, deviceFingerprint);
  if (state.status !== 'active') return res.status(200).json(state);

  if (!license.deviceFingerprint) {
    license.deviceFingerprint = deviceFingerprint;
    license.deviceName = deviceName;
    license.activatedAt = new Date().toISOString();
    await writeDb(db);
  }

  res.json({ status: 'active', expiresAt: license.expiresAt });
});

app.post('/api/license/check', async (req, res) => {
  const licenseKey = normalizeKey(req.body.licenseKey);
  const deviceFingerprint = String(req.body.deviceFingerprint || '').trim();
  const db = await readDb();
  const license = db.licenses.find((item) => item.licenseKey === licenseKey);
  res.json(checkLicense(license, deviceFingerprint));
});

app.get('/admin', requireAdmin, (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Debet Manager Licenses</title>
<style>
body{font-family:Segoe UI,Tahoma,sans-serif;background:#0a1628;color:#e2e8f0;margin:0;padding:24px}
.wrap{max-width:1100px;margin:auto}.top{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:18px}
h1{font-size:22px;margin:0}.card{background:#0d1f3c;border:1px solid rgba(59,130,246,.25);border-radius:10px;padding:16px;margin-bottom:16px}
input,select{background:#112447;border:1px solid rgba(59,130,246,.25);border-radius:8px;color:#e2e8f0;padding:10px;outline:none}
button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer}
button.warn{background:#f59e0b;color:#111}button.danger{background:#ef4444}button.ok{background:#10b981}
.grid{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px}
table{width:100%;border-collapse:collapse;background:#0d1f3c;border-radius:10px;overflow:hidden}
th,td{border-bottom:1px solid rgba(59,130,246,.18);padding:10px;text-align:right;font-size:13px}
th{background:#112447}.actions{display:flex;gap:6px;flex-wrap:wrap}.muted{color:#94a3b8;font-size:12px}.key{direction:ltr;font-family:Consolas,monospace}
.active{color:#34d399}.expired,.suspended{color:#f87171}.device_mismatch{color:#f59e0b}
</style>
</head>
<body><div class="wrap">
<div class="top"><h1>لوحة تراخيص Debet Manager</h1><button onclick="loadLicenses()">تحديث</button></div>
<div id="message" class="muted" style="margin-bottom:12px"></div>
<div class="card">
  <div class="grid">
    <input id="customerName" placeholder="اسم العميل">
    <input id="phone" placeholder="الهاتف">
    <select id="years"><option value="1">سنة</option><option value="2">سنتين</option><option value="3">3 سنوات</option></select>
    <button onclick="createLicense()">إنشاء مفتاح</button>
  </div>
</div>
<table><thead><tr><th>العميل</th><th>المفتاح</th><th>تاريخ الانتهاء</th><th>الحالة</th><th>الجهاز</th><th>إجراءات</th></tr></thead><tbody id="rows"></tbody></table>
</div>
<script>
function setMessage(text,type=''){message.textContent=text;message.style.color=type==='err'?'#f87171':type==='ok'?'#34d399':'#94a3b8';}
async function api(path, options={}){
  const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});
  if(!r.ok)throw new Error(await r.text());
  return r.json();
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadLicenses(){
  try{
    const data=await api('/api/admin/licenses');
    rows.innerHTML=data.licenses.map(l=>'<tr><td>'+esc(l.customerName)+'<div class="muted">'+esc(l.phone)+'</div></td><td class="key">'+esc(l.licenseKey)+'</td><td>'+esc(l.expiresAt.slice(0,10))+'</td><td class="'+esc(l.status)+'">'+esc(l.status)+'</td><td>'+esc(l.deviceName||'غير مفعل')+'<div class="muted">'+(l.deviceBound?'مربوط بجهاز':'لم يربط بعد')+'</div></td><td><div class="actions"><button class="ok" onclick="renew(\\''+l.id+'\\')">تجديد سنة</button><button class="warn" onclick="releaseDevice(\\''+l.id+'\\')">فك الجهاز</button><button class="danger" onclick="suspend(\\''+l.id+'\\')">إيقاف</button><button onclick="activate(\\''+l.id+'\\')">تفعيل</button></div></td></tr>').join('');
    setMessage(data.licenses.length?'تم تحميل التراخيص':'لا توجد تراخيص بعد');
  }catch(err){setMessage('خطأ في تحميل التراخيص: '+err.message,'err');}
}
async function createLicense(){
  try{
    if(!customerName.value.trim()){setMessage('اسم العميل مطلوب','err');return;}
    const created=await api('/api/admin/licenses',{method:'POST',body:JSON.stringify({customerName:customerName.value,phone:phone.value,years:Number(years.value)})});
    customerName.value='';phone.value='';
    setMessage('تم إنشاء المفتاح: '+created.licenseKey,'ok');
    await loadLicenses();
  }catch(err){setMessage('فشل إنشاء المفتاح: '+err.message,'err');}
}
async function renew(id){try{await api('/api/admin/licenses/'+id+'/renew',{method:'POST',body:JSON.stringify({years:1})});await loadLicenses();}catch(err){setMessage('فشل التجديد: '+err.message,'err');}}
async function suspend(id){try{await api('/api/admin/licenses/'+id+'/suspend',{method:'POST'});await loadLicenses();}catch(err){setMessage('فشل الإيقاف: '+err.message,'err');}}
async function activate(id){try{await api('/api/admin/licenses/'+id+'/activate',{method:'POST'});await loadLicenses();}catch(err){setMessage('فشل التفعيل: '+err.message,'err');}}
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
  license.expiresAt = addYears(base, Math.max(1, Number(req.body.years || 1))).toISOString();
  license.status = 'active';
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
  await writeDb(db);
  res.json(publicLicense(license));
});

app.listen(PORT, () => {
  console.log(`License server running on http://127.0.0.1:${PORT}`);
  console.log(`Admin panel: http://127.0.0.1:${PORT}/admin`);
});
