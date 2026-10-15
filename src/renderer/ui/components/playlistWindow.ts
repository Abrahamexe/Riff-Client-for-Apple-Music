// Çalma listesinde bir şarkıdan başlatma (geliştirici hatası 2026-10-14: "bazı playlistlerde alttan
// şarkı açınca en üstteki çalıyor"). Ölçüm: MusicKit `setQueue({ playlist, startWith })` listenin
// yalnızca ilk 100 şarkısını kuyruğa alıyor; 100. sıradan sonrası için konum -1 kalıyor ve liste
// baştan çalıyordu. Kimliklerin tamamıyla kuyruk (1.229 şarkı) istek hatası verdi; 300'lük dilim
// doğru şarkıdan başladı (~2 sn). Bu yüzden: ilk 100'de Apple'ın liste kuyruğu, sonrasında basılan
// şarkıdan başlayan dilim. Dilim basılan şarkıdan ÖNCE başlamaz: Apple çalınamayan şarkıları kuyruktan
// atıyor (300 → 297), öncesinde atılan olursa başlangıç sırası kayıyordu (gerçek arayüz testi: 501.
// satır yerine birkaç sonraki çaldı).

/** MusicKit'in liste kuyruğuna aldığı şarkı sayısı (gözlem). */
const MUSICKIT_PLAYLIST_PAGE = 100
/** Dilim boyutu (basılan şarkı + sonrası). */
const WINDOW_SIZE = 300

/** Apple'ın liste kuyruğu yeterli mi; değilse kuyruğa alınacak dilim ve dilim içindeki başlangıç. */
/** `sorted`: liste farklı sıralı görünüyorsa Apple'ın liste kuyruğu kullanılamaz (onun sırası farklı). */
export function playlistStart(
  index: number,
  total: number,
  sorted = false
): { kind: 'playlist' } | { kind: 'window'; offset: number; limit: number; start: number } {
  if (!sorted && index < MUSICKIT_PLAYLIST_PAGE) return { kind: 'playlist' }
  const limit = Math.min(WINDOW_SIZE, Math.max(1, total - index))
  return { kind: 'window', offset: index, limit, start: 0 }
}
