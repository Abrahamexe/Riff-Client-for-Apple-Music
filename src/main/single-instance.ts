// Tek örnek kilidi (PLAN 1.8c). Uygulamanın yalnızca bir süreci çalışır: ikinci açılış yeni örnek
// başlatmaz, birinci örneğe `second-instance` olayı gelir ve o, ana pencereyi gösterip öne getirir.
// Kilit alınamazsa ikinci örnek HİÇBİR şeye (DB, token dosyası, worker, pencere) dokunmadan çıkar:
// index.ts, başlatma işlerini yalnızca bu fonksiyon `true` dönerse kaydeder.
// Electron'a yalnızca tip düzeyinde bağlıdır (testlenebilir). Kilit `userData` yoluna göre alınır.

/** Electron `app`'in kullandığımız yüzeyi. */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', listener: () => void): unknown
  quit(): void
}

/**
 * Kilidi almaya çalışır. Alınırsa `onSecondInstance` sonraki açılışlarda çağrılır ve `true` döner;
 * alınamazsa `app.quit()` çağrılır ve `false` döner (çağıran başka hiçbir iş yapmamalıdır).
 */
export function acquireSingleInstance(
  app: SingleInstanceApp,
  onSecondInstance: () => void
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', onSecondInstance)
  return true
}
