# Riff Client token servisi (PLAN 4.1)

Apple Music **developer token**'ını sunucuda imzalayan küçük bir Cloudflare Worker. `.p8` anahtarı
yalnızca Cloudflare'in gizli deposunda durur; uygulama paketinde anahtar yoktur.

- Uç nokta: `GET /v1/developer-token` → `{ "token": "<JWT>", "expiresAt": <unix sn> }` (`no-store`)
- Ömür: 6 saat (`TOKEN_TTL_SECONDS`); istemci süresi dolmadan 10 dk önce yeniler
- Hız sınırı: IP başına dakikada 10 istek (aşımda `429` + `Retry-After: 60`)
- İzleme: Workers Logs'ta `{"event":"issued|rate_limited|misconfigured|sign_failed","status":…}`
  (IP ve token loglanmaz)
- Sağlık: `GET /health` → `ok`

Not: developer token istemcide her zaman görülebilir (MusicKit onu tarayıcıya verir). Amaç `.p8`'i
korumak ve kötüye kullanılan bir token'ın etkisini kısa ömürle sınırlamaktır.

## Maliyet

Workers Free: günde 100.000 istek, istek başına 10 ms CPU — bu servis için yeterli (istemci başına
günde ~4–10 istek). Paid: aylık en az 5 $ (developers.cloudflare.com/workers/platform/pricing,
2026-10-12).

## Kurulum (👤 geliştirici yapar)

PowerShell'de `npx` yerine `npx.cmd` kullan (execution policy). Wrangler projeye bağımlılık olarak
eklenmez; `npx` ile çalıştırılır (sürüm ≥ 4.36, hız sınırı bağlamı için).

```powershell
cd <proje klasörü>\server\token-service

# 1) Cloudflare hesabına giriş (tarayıcı açılır)
npx.cmd wrangler@4 login

# 2) Gizli değerler (değerler ekrana/loga yazılmaz)
npx.cmd wrangler@4 secret put APPLE_TEAM_ID      # 10 karakter, sorulunca yapıştır
npx.cmd wrangler@4 secret put APPLE_KEY_ID       # 10 karakter
Get-Content -Raw "<.p8 dosyasının yolu>" | npx.cmd wrangler@4 secret put APPLE_PRIVATE_KEY

# 3) Yayınla — çıktıdaki adresi not et (ör. https://riff-client-token.<hesap>.workers.dev)
npx.cmd wrangler@4 deploy

# 4) Dene
curl.exe https://riff-client-token.<hesap>.workers.dev/health
```

`/v1/developer-token` yanıtını konsola yazdırma (token içerir); doğrulamayı uygulama yapar (aşağıda).

## Uygulamayı servise bağlama

Derleme sırasında adres verilir (gizli değildir):

```powershell
$env:AM_TOKEN_SERVICE_URL = "https://riff-client-token.<hesap>.workers.dev/v1/developer-token"
npm.cmd run build:dev   # önce dev build ile dene: .env yerine servis kullanılır
npm.cmd run preview:dev # giriş + bir şarkı çal → çalışıyorsa servis tamam
npm.cmd run dist        # dağıtım build'i (RELEASE_CHECKLIST)
```

Adres verilmezse production build "sağlayıcı yok" hatası verir (`TOKEN_PROVIDER_UNAVAILABLE`); dev
build `.env` + `.p8` ile çalışmaya devam eder.

## Anahtar yenileme / iptal

Apple Developer → Keys'ten yeni MusicKit anahtarı oluştur → 2. adımı yeni değerlerle tekrarla →
eskisini Apple'da iptal et. İptal edilen anahtarla imzalanmış token'lar en geç 6 saatte geçersizleşir.

## Testler

`npm run check` sunucu kodunu da test eder (`src/index.test.ts`: imza, önbellek, hız sınırı, hatalı
yapılandırma, gizli bilgi sızmaması; `tests/token-service-roundtrip.test.ts`: istemci ↔ sunucu).
Testler geçici anahtar üretir; ağa ve Apple'a çıkmaz.
