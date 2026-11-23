import type { SecureStore } from '../storage/secureStore'
import { decodeSession } from '../storage/authSession'
import { scanForSecret } from '../storage/plaintextScan'

// YALNIZCA DEV BUILD (PLAN 1.5 hazırlık): `--scan-plaintext` ile açılışta userData klasöründe
// kayıtlı Music User Token'ın şifresiz bir kopyası olup olmadığını tarar ve sonucu main konsoluna
// yazar. Token main'den çıkmaz; renderer'a hiçbir kanal açılmaz; rapor yalnızca dosya yollarıdır.
// Production bundle'ında bu modül yoktur (scripts/verify-prod-bundle.mjs).
//
// Kullanım (Apple key gelince): giriş yap → uygulamayı kapat → `npm run scan:plaintext`.

export async function runPlaintextCheck(userDataDir: string, store: SecureStore): Promise<boolean> {
  const token = decodeSession(await store.load())?.token ?? null
  if (token === null) {
    console.warn(
      '[1.5 tarama] kayıtlı token yok: önce giriş yapıp uygulamayı kapatın, sonra tekrar çalıştırın.'
    )
    return false
  }
  const report = await scanForSecret(userDataDir, token)
  const mb = (report.scannedBytes / 1024 / 1024).toFixed(1)
  console.info(`[1.5 tarama] ${report.scannedFiles} dosya (${mb} MB) tarandı: ${userDataDir}`)
  for (const m of report.matches) {
    console.error(`[1.5 tarama] ✖ ŞİFRESİZ KOPYA: ${m.file} (${m.encodings.join(', ')})`)
  }
  for (const u of report.unreadable) {
    console.warn(`[1.5 tarama] okunamadı (${u.code}): ${u.file}`)
  }
  if (report.persistentStorage.length > 0) {
    console.warn(
      `[1.5 tarama] kalıcı tarayıcı depolaması var (sıkıştırılmış kopya bayt aramasıyla görünmeyebilir): ${report.persistentStorage.join(', ')}`
    )
  }
  const clean = report.matches.length === 0 && report.unreadable.length === 0
  console.info(
    clean
      ? '[1.5 tarama] ✔ token hiçbir dosyada şifresiz bulunmadı.'
      : report.matches.length === 0
        ? '[1.5 tarama] ? eşleşme yok ama bazı dosyalar okunamadı; uygulama kapalıyken tekrarlayın.'
        : '[1.5 tarama] ✖ şifresiz kopya bulundu; PLAN 1.5 gereği alternatifler geliştiriciye raporlanmalı.'
  )
  return clean
}
