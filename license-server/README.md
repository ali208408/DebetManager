# Debet Manager License Server

سيرفر بسيط لإدارة تراخيص Debet Manager السنوية.

## التشغيل المحلي

```powershell
cd license-server
npm install
$env:ADMIN_USER="admin"
$env:ADMIN_PASS="strong-password"
npm start
```

افتح لوحة التحكم:

```text
http://127.0.0.1:8787/admin
```

## قبل البيع الفعلي

غيّر `LICENSE_SERVER_URL` داخل `app/index.html` إلى دومين HTTPS حقيقي، مثال:

```js
const LICENSE_SERVER_URL='https://licenses.yourdomain.com';
```

لا تستخدم كلمة مرور Admin الافتراضية في الإنتاج.
