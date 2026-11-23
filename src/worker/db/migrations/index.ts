// Sürümlü şema geçişleri (PLAN 1.7a). Sürüm `PRAGMA user_version` içinde tutulur; her geçiş kendi
// transaction'ında uygulanır. Yayınlanmış bir geçiş DEĞİŞTİRİLMEZ, yenisi eklenir.
// DB bir cache'tir (tek kaynak Apple): şema kırılırsa silinip yeniden oluşturulabilir.

export interface Migration {
  version: number
  sql: string
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE playlists (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        can_edit    INTEGER NOT NULL DEFAULT 0,
        artwork_url TEXT,
        position    INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE tracks (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        album_name  TEXT NOT NULL,
        duration_ms INTEGER,
        play_params TEXT,
        artwork_url TEXT
      ) STRICT;

      CREATE TABLE playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        track_id    TEXT NOT NULL REFERENCES tracks(id),
        PRIMARY KEY (playlist_id, position)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX playlist_tracks_track ON playlist_tracks(track_id);

      -- Kapak görseli disk cache'i (içerik mantığı PLAN 2.2'de; tablo şimdiden hazır).
      CREATE TABLE artwork (
        url          TEXT PRIMARY KEY,
        file_path    TEXT NOT NULL,
        bytes        INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX artwork_lru ON artwork(last_used_at);

      CREATE TABLE player_state (
        id           INTEGER PRIMARY KEY CHECK (id = 1),
        queue        TEXT NOT NULL,
        position     INTEGER NOT NULL,
        position_sec REAL NOT NULL,
        updated_at   INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE sync_meta (
        scope        TEXT PRIMARY KEY,
        synced_at    INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        item_count   INTEGER NOT NULL
      ) STRICT;
    `
  },
  {
    // PLAN 3.A1: dış kaynak (MusicBrainz, Wikimedia, LRCLIB) yanıt cache'i. Anahtar,
    // gizli parametreler (API key) ÇIKARILMIŞ istek adresidir. Gövde şemadan geçmiş JSON'dur;
    // `status` 404 ise gövde boştur ("bulunamadı" da cache'lenir). Tazelik kaynağa göre okunurken
    // hesaplanır (TTL'ler kodda; şema değişmeden ayarlanabilir).
    version: 2,
    sql: `
      CREATE TABLE bg_http_cache (
        key        TEXT PRIMARY KEY,
        source     TEXT NOT NULL,
        status     INTEGER NOT NULL,
        body       TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX bg_http_cache_source_age ON bg_http_cache(source, fetched_at);
    `
  },
  {
    // PLAN 3.A2: şarkı → MusicBrainz eşleşmesi (MBID'ler + güven). Anahtar, normalleştirilmiş şarkı
    // bilgisinin özetidir (refKey); şarkı adı açık metin olarak anahtar yapılmaz.
    version: 3,
    sql: `
      CREATE TABLE bg_match (
        ref_key    TEXT PRIMARY KEY,
        result     TEXT NOT NULL,
        matched_at INTEGER NOT NULL
      ) STRICT;
    `
  },
  {
    // PLAN 3.A7: birleşik arka plan sonucu (TrackBackground JSON), şarkı anahtarı + dil başına.
    // SWR: okuma buradan anında döner, eskiyse arka planda yenilenir.
    version: 4,
    sql: `
      CREATE TABLE bg_track (
        ref_key    TEXT NOT NULL,
        lang       TEXT NOT NULL,
        data       TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (ref_key, lang)
      ) STRICT, WITHOUT ROWID;
    `
  },
  {
    // PLAN 3.A8: arka plan cache'i boyut yönetimi. Her satır kendi boyutunu (`bytes`: anahtar +
    // saklanan JSON) ve son erişim zamanını (`last_access`) taşır: toplam boyut ve LRU silme dizinden
    // okunur, gövdelere dokunulmaz. Bunlar cache olduğu için tablolar boşaltılarak yeniden kurulur
    // (eski satırların boyutu bilinmiyor). Silinen alanın dosyadan çıkması için `auto_vacuum =
    // incremental` gerekir; bu bir migration değil açılış adımıdır (connection.ts).
    version: 5,
    sql: `
      DROP TABLE bg_http_cache;
      DROP TABLE bg_match;
      DROP TABLE bg_track;

      CREATE TABLE bg_http_cache (
        key         TEXT PRIMARY KEY,
        source      TEXT NOT NULL,
        status      INTEGER NOT NULL,
        body        TEXT NOT NULL,
        fetched_at  INTEGER NOT NULL,
        bytes       INTEGER NOT NULL,
        last_access INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX bg_http_cache_source_age ON bg_http_cache(source, fetched_at);
      CREATE INDEX bg_http_cache_lru ON bg_http_cache(last_access, bytes);

      CREATE TABLE bg_match (
        ref_key     TEXT PRIMARY KEY,
        result      TEXT NOT NULL,
        matched_at  INTEGER NOT NULL,
        bytes       INTEGER NOT NULL,
        last_access INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX bg_match_lru ON bg_match(last_access, bytes);

      CREATE TABLE bg_track (
        ref_key     TEXT NOT NULL,
        lang        TEXT NOT NULL,
        data        TEXT NOT NULL,
        fetched_at  INTEGER NOT NULL,
        bytes       INTEGER NOT NULL,
        last_access INTEGER NOT NULL,
        PRIMARY KEY (ref_key, lang)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX bg_track_lru ON bg_track(last_access, bytes);
    `
  },
  {
    // V8: kütüphane öğelerinde (i.…) ISRC yok; arka plan eşleştirmesi için katalog id'sinden Apple
    // API ile çözülür ve burada saklanır (açılışta cache okuması ağ beklemesin). `isrc` NULL: Apple'da
    // ISRC yok. Dinleme alışkanlığını ele verebilir → çıkışta silinir.
    version: 6,
    sql: `
      CREATE TABLE apple_isrc (
        apple_id   TEXT PRIMARY KEY,
        isrc       TEXT,
        fetched_at INTEGER NOT NULL
      ) STRICT, WITHOUT ROWID;
    `
  },
  {
    // 3.B1: son aramalar (yalnızca yerel). Dinleme/ilgi alanını ele verir → çıkışta silinir.
    version: 7,
    sql: `
      CREATE TABLE recent_searches (
        term        TEXT PRIMARY KEY COLLATE NOCASE,
        searched_at INTEGER NOT NULL
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX recent_searches_time ON recent_searches(searched_at);
    `
  },
  {
    // 3.B2: çevrimdışı yazma kuyruğu (sırayla gönderilir) ve kişisel puanların yerel kopyası.
    // İkisi de kullanıcıya ait → çıkışta silinir.
    version: 8,
    sql: `
      CREATE TABLE pending_writes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        op         TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE ratings (
        kind       TEXT NOT NULL,
        id         TEXT NOT NULL,
        value      INTEGER NOT NULL CHECK (value IN (1, -1)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (kind, id)
      ) STRICT, WITHOUT ROWID;
    `
  },
  {
    // 3.B3: ayarlar (tek JSON kayıt; kendi şema sürümü shared/settings.ts'te). Cihaza ait: çıkışta
    // yalnızca şarkıya özel EQ eşlemesi silinir.
    version: 9,
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;
    `
  },
  {
    // Arayüz veri kapsamı: explicit işareti + kütüphane bölümleri (Şarkılar, Albümler, Sanatçılar).
    // Kullanıcının kütüphanesidir → çıkışta silinir.
    version: 10,
    sql: `
      ALTER TABLE tracks ADD COLUMN explicit INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE library_song (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        album_name  TEXT NOT NULL,
        duration_ms INTEGER,
        play_params TEXT,
        artwork_url TEXT,
        explicit    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX library_song_name ON library_song(name COLLATE NOCASE);
      CREATE INDEX library_song_artist ON library_song(artist_name COLLATE NOCASE);

      CREATE TABLE library_album (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        artist_name  TEXT NOT NULL,
        track_count  INTEGER,
        play_params  TEXT,
        artwork_url  TEXT,
        explicit     INTEGER NOT NULL DEFAULT 0,
        release_date TEXT,
        position     INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX library_album_name ON library_album(name COLLATE NOCASE);
      CREATE INDEX library_album_artist ON library_album(artist_name COLLATE NOCASE);

      CREATE TABLE library_artist (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        artwork_url TEXT,
        position    INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX library_artist_name ON library_artist(name COLLATE NOCASE);
    `
  },
  {
    // PLAN_v5 A4: büyük kütüphanede (50.000 şarkı) sayfa okuma 100–200 ms idi: indeksler ORDER BY'ı
    // tam karşılamıyordu (geçici B-tree sıralaması). İndeksler sıralama ifadeleriyle birebir; Apple
    // sırası (`position`) için de indeks.
    version: 11,
    sql: `
      DROP INDEX library_song_name;
      DROP INDEX library_song_artist;
      CREATE INDEX library_song_name ON library_song(name COLLATE NOCASE, artist_name COLLATE NOCASE);
      CREATE INDEX library_song_artist ON library_song(
        artist_name COLLATE NOCASE, album_name COLLATE NOCASE, name COLLATE NOCASE
      );
      CREATE INDEX library_song_position ON library_song(position);

      DROP INDEX library_album_artist;
      CREATE INDEX library_album_artist ON library_album(artist_name COLLATE NOCASE, name COLLATE NOCASE);
      CREATE INDEX library_album_position ON library_album(position);

      CREATE INDEX library_artist_position ON library_artist(position);
    `
  },
  {
    // PLAN_v5 P5: büyük playlist'in şarkıları parça parça yazılırken bağlantılar burada bekler; tek
    // transaction'da playlist_tracks'e taşınır. Sahipsiz şarkı temizliği bunları da sayar (başka bir
    // playlist'in senkronu arada yazılmış şarkıları silmesin). Kullanıcı verisi: çıkışta silinir.
    version: 12,
    sql: `
      CREATE TABLE playlist_tracks_stage (
        playlist_id TEXT NOT NULL,
        position    INTEGER NOT NULL,
        track_id    TEXT NOT NULL,
        PRIMARY KEY (playlist_id, position)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX playlist_tracks_stage_track ON playlist_tracks_stage(track_id);
    `
  },
  {
    // §3.6 (2026-10-14): Arşiv → Türler, Besteciler, Derlemeler. Tür kütüphane özniteliğinden
    // (`genreNames`), besteci ve derleme katalog ilişkisinden (`include=catalog` + seyrek alanlar;
    // gözlem: kütüphane şarkısında `composerName`, albümünde `isCompilation` yok). Şarkı ve albüm
    // senkron kaydı silinir: yeni sütunlar bir sonraki açılışta dolar.
    version: 13,
    sql: `
      ALTER TABLE library_song ADD COLUMN genre TEXT;
      ALTER TABLE library_song ADD COLUMN composer TEXT;
      ALTER TABLE library_album ADD COLUMN genre TEXT;
      ALTER TABLE library_album ADD COLUMN is_compilation INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX library_song_genre ON library_song(genre COLLATE NOCASE);
      DELETE FROM sync_meta WHERE scope IN ('songs', 'albums');
    `
  },
  {
    // 2026-10-15: kütüphane sanatçılarının görseli katalog ilişkisinden geliyor (`toLibraryArtist`);
    // eski kayıtlar görselsiz: sanatçı senkron kaydı silinir, bir sonraki açılışta dolar.
    version: 14,
    sql: `DELETE FROM sync_meta WHERE scope = 'artists';`
  },
  {
    // R2 (2026-10-15): katalog sayfalarının kalıcı önbelleği (CatalogCacheRepository). Açılışta Ana
    // Sayfa her seferinde Apple'dan ~0,8 sn bekliyordu; artık diskten anında, arka planda tazelenir.
    version: 15,
    sql: `
      CREATE TABLE catalog_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      ) STRICT, WITHOUT ROWID;
    `
  }
]
