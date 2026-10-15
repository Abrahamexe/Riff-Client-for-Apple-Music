// Profil baş harfleri (B3 geri bildirimi): Apple, adı ve profil fotoğrafını üçüncü taraf uygulamalara
// vermiyor (resmi Apple Music API'de kullanıcı profili uç noktası yok; gözlem 2026-10-13). Kullanıcı
// adını bir kez yazar; ilk iki kelimenin baş harfleri (Türkçe büyük harf kuralıyla) gösterilir.

export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  const letters = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
  return letters.toLocaleUpperCase('tr-TR')
}
