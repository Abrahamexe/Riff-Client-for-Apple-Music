// Electron'a bağımlı olmayan sabitler (birim testlerinde de import edilebilsin diye ayrı dosyada).
export const APP_SCHEME = 'app'
export const APP_HOST = 'renderer'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`

// Ana pencerenin oturumu KALICI DEĞİLDİR (in-memory): "persist:" öneki yok (PLAN 1.5). MusicKit
// user token'ı localStorage'a da yazar; bu bölüm diske hiçbir şey yazmadığı için token yalnızca
// safeStorage ile şifreli saklanır (Güvenlik kuralı 9). Apple çerezleri de kapanışta silinir.
export const SESSION_PARTITION = 'am-client'
