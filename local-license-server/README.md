# Debet Manager Local License Server

سيرفر تراخيص محلي يعمل على جهازك. يمكن ربطه لاحقا بـ Cloudflare Tunnel ليصل إليه العملاء من الخارج بدون استضافة مدفوعة.

## التشغيل

```powershell
cd "C:\Users\esame\Desktop\Debet Final\local-license-server"
$env:ADMIN_USER="admin"
$env:ADMIN_PASS="123456"
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" start
```

لوحة التحكم:

```text
http://127.0.0.1:8787/admin
```

## Cloudflare Tunnel

بعد تثبيت cloudflared:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

انسخ رابط `https://...trycloudflare.com` وضعه في شاشة التفعيل داخل البرنامج عند العميل.
