import { createHash } from 'node:crypto'
import {
  TrackBackgroundSchema,
  type ArtistSummary,
  type BackgroundProgress,
  type BackgroundSource,
  type BackgroundStage,
  type Match,
  type Sections,
  type SectionStatus,
  type SummaryLang,
  type TrackBackground,
  type TrackRef
} from '@shared/background'
import { APP_CONFIG } from '@shared/app-config'
import type { WorkerEvent } from '@shared/ipc-contract'
import { workerEventContract } from '@shared/ipc-contract'
import { CoreError, logError, toCoreError } from '@shared/errors'
import type { Lyrics } from '@shared/lyrics'
import type { Db } from '../db/connection'
import { cancelledError, isCancelled } from './abort'
import { fetchArtistSummary } from './artistSummary'
import { BackgroundHttpCache } from './cache'
import {
  CacheMaintenance,
  entryBytes,
  TOUCH_GRANULARITY_MS,
  type CacheMaintenanceOptions
} from './cacheMaintenance'
import { fetchMusicBrainzBackground, type MusicBrainzBackground } from './credits'
import { MatchCache, Matcher, refKey } from './matcher'
import { mergeBackground } from './merge'
import type { Priority } from './rateLimiter'
import { createSourceClient, type SourceClientDeps } from './sources/factory'
import { MusicBrainzSource } from './sources/musicbrainz'
import { LrclibSource } from './sources/lrclib'
import { inspectWikimediaBody, WikimediaSource } from './sources/wikimedia'

// Erişim API'si (PLAN 3.A7): `getBackground` SWR ile — birleşik sonuç `bg_track`'ten anında döner;
// eskiyse arka planda (düşük öncelikle) yenilenir ve içerik değiştiyse `background:changed`
// bildirilir. Yoksa kaynaklar kullanıcı önceliğiyle toplanır. `prefetch` sıradaki şarkıyı düşük
// öncelikle hazırlar: hız sınırlayıcılar kullanıcı isteklerini her zaman önce geçirir.
// Ağ yoksa cache'teki sonuç kullanılmaya devam eder. Çıkışta tüm arka plan cache'leri silinir.
//
// Kademeli sonuç (PLAN 3.A8): toplama üç aşamadır — eşleştirme → MusicBrainz kredileri →
// Wikidata/Wikipedia özeti. Eşleştirmeden sonra iki aşama BİRLİKTE başlar
// (farklı kaynak sınırlayıcıları; gecikme artmaz) ve her biri bitince `background:progress` ile
// bölüm durumları (pending/ready/unavailable/error) ve o ana kadarki ara model bildirilir. Yalnızca
// TAM sonuç (hiçbir bölüm `error` değil) `bg_track`'e yazılır; yarım sonuç çağırana döner ama cache'e
// "tamamlanmış" olarak yazılmaz (sonraki istek eksik bölümü yeniden dener; başarılı alt istekler HTTP
// cache'inde olduğu için ucuzdur). Eşleştirme veya kredi aşaması hata verirse sonuç üretilmez (hata).
// Çalan şarkı değişince (başka şarkı için `get`) önceki şarkının KULLANICI öncelikli toplamaları iptal
// edilir: sırada bekleyen istekler kota harcamaz, ağdakiler kesilir (`BG_CANCELLED`). Ön yüklemeler
// iptal edilmez.

/** Birleşik sonuç bu süre taze sayılır. */
export const TRACK_TTL_MS = 3 * 86_400_000

export type CacheSettings = Pick<
  CacheMaintenanceOptions,
  'maxBytes' | 'lowWaterRatio' | 'sweepEveryWrites'
>

export interface BackgroundServiceDeps {
  db: Db
  /** Cache boyut ayarı (varsayılan: APP_CONFIG.backgroundCache). */
  cache?: CacheSettings
  userAgent: string
  emit: (event: WorkerEvent) => void
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface BackgroundResult {
  key: string
  data: TrackBackground
  cached: boolean
  stale: boolean
  sections: Sections
  /** Hiçbir bölüm `error` değil: sonuç tam ve cache'e yazıldı (cache'ten gelen her sonuç tamdır). */
  complete: boolean
}

interface Outcome {
  data: TrackBackground
  sections: Sections
  complete: boolean
}

type ProgressBody = Omit<BackgroundProgress, 'requestId'>

/** Sürmekte olan bir toplama: aynı şarkı + dil için tek örnek, çağıranlar katılır. */
interface Run {
  key: string
  lang: SummaryLang
  priority: Priority
  controller: AbortController
  promise: Promise<Outcome>
  /** İlerleme bildirimi bekleyen istek kimlikleri. */
  listeners: Set<string>
  /** Şimdiye kadarki bildirimler (sonradan katılana tekrar gönderilir). */
  events: ProgressBody[]
}

const NO_MATCH: Match = {
  status: 'none',
  confidence: 0,
  method: null,
  recording: null,
  release: null
}

/** Cache'teki (tam) sonucun bölüm durumları; yalnızca veriden türetilir. */
function sectionsFromData(data: TrackBackground): Sections {
  const has = (source: BackgroundSource): boolean => data.sources.some((s) => s.source === source)
  return {
    match: data.match.status === 'none' ? 'unavailable' : 'ready',
    credits: has('musicbrainz') ? 'ready' : 'unavailable',
    summary: data.artistSummary ? 'ready' : 'unavailable'
  }
}

const isComplete = (sections: Sections): boolean =>
  Object.values(sections).every((s) => s !== 'error' && s !== 'pending')

class TrackStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
    private readonly onWrite: () => void
  ) {}

  get(key: string, lang: SummaryLang): { data: TrackBackground; fetchedAt: number } | null {
    const row = this.db
      .prepare('SELECT data, fetched_at, last_access FROM bg_track WHERE ref_key = ? AND lang = ?')
      .get(key, lang) as { data: string; fetched_at: number; last_access: number } | undefined
    if (!row) return null
    const now = this.now()
    if (now - row.last_access >= TOUCH_GRANULARITY_MS) {
      this.db
        .prepare('UPDATE bg_track SET last_access = ? WHERE ref_key = ? AND lang = ?')
        .run(now, key, lang)
    }
    try {
      const parsed = TrackBackgroundSchema.safeParse(JSON.parse(row.data))
      return parsed.success ? { data: parsed.data, fetchedAt: row.fetched_at } : null
    } catch {
      return null
    }
  }

  set(key: string, lang: SummaryLang, data: TrackBackground, fetchedAt: number): void {
    const json = JSON.stringify(data)
    this.db
      .prepare(
        `INSERT INTO bg_track (ref_key, lang, data, fetched_at, bytes, last_access)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(ref_key, lang) DO UPDATE SET data = excluded.data,
           fetched_at = excluded.fetched_at, bytes = excluded.bytes, last_access = excluded.last_access`
      )
      .run(key, lang, json, fetchedAt, entryBytes(key + lang, json), this.now())
    this.onWrite()
  }

  clear(): void {
    this.db.exec('DELETE FROM bg_track')
  }
}

/** Zaman damgaları hariç içerik özeti: "değişti mi?" kararı için. */
function contentHash(bg: TrackBackground): string {
  const strip = JSON.stringify(bg, (k, v: unknown) => (k === 'fetchedAt' ? undefined : v))
  return createHash('sha256').update(strip).digest('hex')
}

export class BackgroundService {
  private readonly now: () => number
  private readonly http: BackgroundHttpCache
  private readonly matches: MatchCache
  private readonly store: TrackStore
  private readonly maintenance: CacheMaintenance
  private readonly matcher: Matcher
  private readonly mb: MusicBrainzSource
  private readonly wm: WikimediaSource
  private readonly lrclib: LrclibSource
  /** Süren söz isteği: yeni şarkının sözleri istenince ya da çıkışta iptal edilir. */
  private lyricsRun: AbortController | null = null
  private readonly runs = new Map<string, Run>()
  /** `clear()` sonrası, önceden başlamış toplamanın sonucu yazmasını engeller. */
  private generation = 0

  constructor(private readonly deps: BackgroundServiceDeps) {
    this.now = deps.now ?? Date.now
    this.maintenance = new CacheMaintenance(deps.db, {
      ...(deps.cache ?? APP_CONFIG.backgroundCache),
      now: this.now
    })
    const store = { now: this.now, onWrite: () => this.maintenance.noteWrite() }
    this.http = new BackgroundHttpCache(deps.db, store)
    this.matches = new MatchCache(deps.db, store)
    this.store = new TrackStore(deps.db, this.now, store.onWrite)
    const sourceDeps: SourceClientDeps = {
      userAgent: deps.userAgent,
      cache: this.http,
      fetch: deps.fetch,
      now: deps.now,
      sleep: deps.sleep
    }
    this.mb = new MusicBrainzSource(createSourceClient('musicbrainz', sourceDeps))
    this.wm = new WikimediaSource(
      createSourceClient('wikimedia', sourceDeps, { inspectBody: inspectWikimediaBody })
    )
    this.lrclib = new LrclibSource(createSourceClient('lrclib', sourceDeps))
    this.matcher = new Matcher(this.mb, this.matches, this.now)
    // Açılış temizliği (süresi dolanlar + boyut sınırı). Periyodik zamanlayıcı yok (PLAN 1.8b).
    try {
      this.maintenance.sweep()
    } catch (err) {
      logError('background', err, 'INTERNAL', 'Arka plan cache temizliği başarısız.')
    }
  }

  /**
   * SWR okuma. Cache yoksa toplanır (kullanıcı önceliği; `requestId` verilirse aşama ilerlemesi
   * bildirilir); kaynağa ulaşılamazsa hata. Başka şarkının önceki kullanıcı toplamaları iptal edilir.
   */
  async get(
    ref: TrackRef,
    lang: SummaryLang = 'en',
    requestId?: string
  ): Promise<BackgroundResult> {
    const key = refKey(ref)
    this.cancelOtherUserRuns(key)
    const cached = this.store.get(key, lang)
    if (cached) {
      const stale = this.isStale(cached.fetchedAt)
      if (stale) this.revalidate(ref, key, lang, cached.data)
      return {
        key,
        data: cached.data,
        cached: true,
        stale,
        sections: sectionsFromData(cached.data),
        complete: true
      }
    }
    const outcome = await this.collect(ref, key, lang, 'user', requestId)
    return { key, ...outcome, cached: false, stale: false }
  }

  /** Sıradaki şarkı: tazeyse hiçbir şey yapmaz; değilse düşük öncelikle toplar. Hata yutulur. */
  prefetch(ref: TrackRef, lang: SummaryLang = 'en'): void {
    const key = refKey(ref)
    const cached = this.store.get(key, lang)
    if (cached && !this.isStale(cached.fetchedAt)) return
    this.revalidate(ref, key, lang, cached?.data ?? null)
  }

  /**
   * Şarkı sözleri (B11b, LRCLIB). Yanıtlar HTTP cache'inde tutulur (ağ yoksa eskisi kullanılır).
   * Yeni bir söz isteği öncekini `BG_CANCELLED` ile iptal eder (çalan şarkı değişti).
   */
  async lyrics(ref: TrackRef): Promise<Lyrics> {
    this.lyricsRun?.abort(cancelledError('çalan şarkı değişti'))
    const controller = new AbortController()
    this.lyricsRun = controller
    try {
      return await this.lrclib.find(ref, { priority: 'user', signal: controller.signal })
    } finally {
      if (this.lyricsRun === controller) this.lyricsRun = null
    }
  }

  /**
   * Sözleri düşük öncelikle önden yükler (sıradaki şarkı / Sözler düğmesinin üzerine gelme); süren
   * kullanıcı isteğini iptal etmez, hata yutulur. Sonuç HTTP cache'ine girer.
   */
  prefetchLyrics(ref: TrackRef): void {
    this.lrclib.find(ref, { priority: 'prefetch' }).catch(() => {})
  }

  /** Çıkış: arka plan cache'lerinin tamamı silinir (dinleme geçmişini ele verebilir). */
  clear(): void {
    this.generation++
    this.lyricsRun?.abort(cancelledError('çıkış yapıldı'))
    for (const run of this.runs.values()) run.controller.abort(cancelledError('çıkış yapıldı'))
    this.store.clear()
    this.matches.clear()
    this.http.clear()
    this.maintenance.reclaim()
  }

  /** Cache boyut yöneticisi (tanılama ve testler). */
  get cacheMaintenance(): CacheMaintenance {
    return this.maintenance
  }

  /** Çalan şarkı değişti: başka şarkıların kullanıcı öncelikli toplamaları artık gereksiz. */
  private cancelOtherUserRuns(key: string): void {
    for (const run of this.runs.values()) {
      if (run.priority === 'user' && run.key !== key) {
        run.controller.abort(cancelledError('çalan şarkı değişti'))
      }
    }
  }

  private isStale(fetchedAt: number): boolean {
    return this.now() - fetchedAt >= TRACK_TTL_MS
  }

  /** Arka planda yeniler; tam sonuç değiştiyse bildirir. Hatalar loglanır (cache kullanılmaya devam). */
  private revalidate(
    ref: TrackRef,
    key: string,
    lang: SummaryLang,
    previous: TrackBackground | null
  ): void {
    this.collect(ref, key, lang, 'prefetch').then(
      (next) => {
        // Yarım sonuç cache'e yazılmadı; "değişti" bildirilirse istemci eski veriyi okurdu.
        if (!next.complete) return
        if (!previous || contentHash(previous) !== contentHash(next.data)) {
          this.deps.emit({
            event: workerEventContract.onBackgroundChanged.event,
            payload: { key, lang }
          })
        }
      },
      (err: unknown) => {
        if (!isCancelled(err)) {
          logError('background', err, 'BG_SOURCE_UNAVAILABLE', 'Arka plan yenilenemedi.')
        }
      }
    )
  }

  /** Aynı şarkı + dil için eşzamanlı çağrılar tek toplamada birleşir. */
  private collect(
    ref: TrackRef,
    key: string,
    lang: SummaryLang,
    priority: Priority,
    requestId?: string
  ): Promise<Outcome> {
    const id = `${key}:${lang}`
    let run = this.runs.get(id)
    if (!run) {
      const started = this.startRun(ref, key, lang, priority)
      this.runs.set(id, started)
      started.promise = started.promise.finally(() => {
        if (this.runs.get(id) === started) this.runs.delete(id)
      })
      run = started
    }
    if (requestId) {
      run.listeners.add(requestId)
      for (const event of run.events) this.emitProgress(requestId, event) // geç katılana tekrar
    }
    return run.promise
  }

  private startRun(ref: TrackRef, key: string, lang: SummaryLang, priority: Priority): Run {
    const run: Run = {
      key,
      lang,
      priority,
      controller: new AbortController(),
      promise: Promise.resolve(null as never),
      listeners: new Set(),
      events: []
    }
    const generation = this.generation
    run.promise = this.build(ref, lang, run).then((outcome) => {
      // Yalnızca TAM sonuç tamamlanmış olarak yazılır; çıkıştan sonra hiçbir şey yazılmaz.
      if (outcome.complete && generation === this.generation) {
        this.store.set(key, lang, outcome.data, this.now())
      }
      return outcome
    })
    return run
  }

  private emitProgress(requestId: string, event: ProgressBody): void {
    this.deps.emit({
      event: workerEventContract.onBackgroundProgress.event,
      payload: { requestId, ...event } satisfies BackgroundProgress
    })
  }

  private async build(ref: TrackRef, lang: SummaryLang, run: Run): Promise<Outcome> {
    const opts = { priority: run.priority, signal: run.controller.signal }
    const startedAt = this.now()
    const sections: Sections = {
      match: 'pending',
      credits: 'pending',
      summary: 'pending'
    }
    let match: Match = NO_MATCH
    let musicbrainz: MusicBrainzBackground | null = null
    let summary: ArtistSummary | null = null

    const merged = (): TrackBackground =>
      mergeBackground({ match, musicbrainz, summary, now: this.now() })
    const report = (
      stage: BackgroundStage,
      status: SectionStatus,
      stageStartedAt: number
    ): void => {
      sections[stage] = status
      const now = this.now()
      const event: ProgressBody = {
        key: run.key,
        lang,
        stage,
        sections: { ...sections },
        atMs: now - startedAt,
        tookMs: now - stageStartedAt,
        done: Object.values(sections).every((s) => s !== 'pending'),
        data: merged()
      }
      run.events.push(event)
      for (const requestId of run.listeners) this.emitProgress(requestId, event)
    }

    // 1. Eşleştirme (çekirdek): başarısızsa diğer aşamalar çalışmaz, sonuç üretilmez.
    const matchStart = this.now()
    try {
      match = await this.matcher.match(ref, opts)
    } catch (err) {
      if (isCancelled(err)) throw err
      for (const stage of ['credits', 'summary'] as const) sections[stage] = 'error'
      report('match', 'error', matchStart)
      throw err
    }
    report('match', match.status === 'none' ? 'unavailable' : 'ready', matchStart)
    const primary = match.recording?.artists[0] ?? null

    // 2-3. Farklı kaynak sınırlayıcılarında: birlikte başlar, her biri bitince bildirilir.
    let coreError: Error | null = null as Error | null
    const creditsStage = async (): Promise<void> => {
      const start = this.now()
      let status: SectionStatus
      try {
        musicbrainz = await fetchMusicBrainzBackground(match, this.mb, opts, ref.album)
        status = musicbrainz ? 'ready' : 'unavailable'
      } catch (err) {
        if (isCancelled(err)) throw err
        // krediler çekirdektir: tüm aşamalar bitince hata verilir
        coreError = err instanceof Error ? err : new Error(String(err))
        status = 'error'
      }
      report('credits', status, start)
    }
    const summaryStage = async (): Promise<void> => {
      const start = this.now()
      let status: SectionStatus = 'unavailable'
      if (primary) {
        const part = await this.softPart('wikipedia', () =>
          fetchArtistSummary(primary, lang, this.wm, opts)
        )
        summary = part.value
        status = part.failed ? 'error' : summary ? 'ready' : 'unavailable'
      }
      report('summary', status, start)
    }
    await Promise.all([creditsStage(), summaryStage()])
    if (coreError) throw coreError

    return { data: merged(), sections: { ...sections }, complete: isComplete(sections) }
  }

  /**
   * Yardımcı kaynak hatası tüm sonucu düşürmez: loglanır, o parça boş kalır ve bölüm `error` olur
   * (sonuç tam sayılmaz). İptal hata değildir, yukarı fırlatılır.
   */
  private async softPart<T>(
    source: string,
    fn: () => Promise<T>
  ): Promise<{ value: T | null; failed: boolean }> {
    try {
      return { value: await fn(), failed: false }
    } catch (err) {
      if (isCancelled(err)) throw err
      const error = toCoreError(err, 'BG_SOURCE_UNAVAILABLE', `${source}: veri alınamadı.`)
      logError('background', new CoreError(error.code, `${source}: ${error.message}`))
      return { value: null, failed: true }
    }
  }
}
