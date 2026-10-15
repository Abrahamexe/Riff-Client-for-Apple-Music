import type { Locale } from '@shared/i18n'
import type { SearchScope, SearchSuggestions, UnifiedSearch, WorkerApi } from '@shared/ipc-contract'
import type { IpcResult } from '@shared/types'
import { CoreError, fromWireError } from '../errors'
import { notifyUnauthorized } from '../musickit/guard'

// Yazarken arama (PLAN 3.B1). UI'dan bağımsız: arayüz `input(term)` çağırır, sonuçları `onResult`
// ile alır. Kurallar:
//  - debounce: son tuştan `debounceMs` sonra istek atılır (her tuşa istek yok);
//  - latest-wins: worker yeni istekte süren öncekini iptal eder; buraya geç gelen eski yanıt da
//    sıra numarasıyla elenir — ekranda yalnızca son terimin sonucu görünür;
//  - boş terim: bekleyen istek iptal edilir, sonuç temizlenir (`null`).
// Öneriler (PLAN_v5 P2): aynı debounce'la aramayla paralel istenir (`onSuggestions`); hata olursa
// öneri kutusu boşalır (arama sonucu etkilenmez), eski terimin önerisi gösterilmez.
// B7 arayüzü: `liveResults: false` → yazarken yalnızca öneri istenir (açılır liste); sonuç sayfası
// Enter'la açılır ve `find()` ile kendi kapsamında (Apple Music / Arşivin) arar.

const SEARCH_DEBOUNCE_MS = 250

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; term: string }
  | { status: 'done'; result: UnifiedSearch; elapsedMs: number }
  | { status: 'error'; term: string; error: CoreError }

export interface SearchControllerOptions {
  debounceMs?: number
  limit?: number
  scope?: SearchScope
  now?: () => number
  /** Yazarken birleşik arama da yapılsın mı (varsayılan evet; arayüz yalnızca öneri ister). */
  liveResults?: boolean
}

type SearchApi = Pick<
  WorkerApi,
  'search' | 'searchSuggestions' | 'getRecentSearches' | 'addRecentSearch' | 'clearRecentSearches'
>

export class SearchController {
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(state: SearchState) => void>()
  private readonly suggestionListeners = new Set<(s: SearchSuggestions | null) => void>()
  private state: SearchState = { status: 'idle' }
  private suggestionsState: SearchSuggestions | null = null

  constructor(
    private readonly api: SearchApi = window.api.worker,
    private readonly options: SearchControllerOptions = {}
  ) {}

  get current(): SearchState {
    return this.state
  }

  /** Durum değişince çağrılır; abonelikten çıkan fonksiyon döner. */
  onChange(listener: (state: SearchState) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  get suggestions(): SearchSuggestions | null {
    return this.suggestionsState
  }

  /** Öneriler değişince çağrılır (`null`: öneri yok / kutu kapalı). */
  onSuggestions(listener: (suggestions: SearchSuggestions | null) => void): () => void {
    this.suggestionListeners.add(listener)
    return () => void this.suggestionListeners.delete(listener)
  }

  /** Arama kutusundaki metin değişti. */
  input(term: string): void {
    const q = term.trim()
    const seq = ++this.seq
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (q === '') {
      this.set({ status: 'idle' })
      this.setSuggestions(null)
      return
    }
    const live = this.options.liveResults ?? true
    if (live) this.set({ status: 'loading', term: q })
    this.timer = setTimeout(() => {
      this.timer = null
      if (live) void this.run(q, seq)
      void this.suggest(q, seq)
    }, this.options.debounceMs ?? SEARCH_DEBOUNCE_MS)
  }

  /**
   * Sonuç sayfası (B7): beklemeden, verilen kapsamda arar; durum yayınlamaz. Oturum hatası (bir
   * kaynakta da olsa) yeniden giriş akışını tetikler. Daha yeni aramayla iptal edilirse
   * `REQUEST_CANCELLED` fırlatır.
   */
  async find(
    term: string,
    options: { scope?: SearchScope; limit?: number; locale?: Locale } = {}
  ): Promise<UnifiedSearch> {
    const res = await this.api.search({ term: term.trim(), ...options })
    if (res.ok) {
      for (const wire of [res.value.catalogError, res.value.libraryError]) {
        if (wire?.code === 'UNAUTHORIZED') await notifyUnauthorized(fromWireError(wire))
      }
      return res.value
    }
    const error = fromWireError(res.error)
    if (error.code === 'UNAUTHORIZED') await notifyUnauthorized(error)
    throw error
  }

  /** Enter / öneri seçimi: beklemeden arar ve son aramalara ekler. */
  async submit(term: string): Promise<void> {
    const q = term.trim()
    if (q === '') return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const seq = ++this.seq
    this.set({ status: 'loading', term: q })
    this.setSuggestions(null) // terim seçildi: öneri kutusu kapanır
    await Promise.all([this.run(q, seq), this.addRecent(q)])
  }

  async recentSearches(limit?: number): Promise<{ term: string; searchedAt: number }[]> {
    return unwrap(await this.api.getRecentSearches(limit === undefined ? {} : { limit }))
  }

  async addRecent(term: string): Promise<void> {
    unwrap(await this.api.addRecentSearch({ term }))
  }

  async clearRecent(): Promise<void> {
    unwrap(await this.api.clearRecentSearches({}))
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.seq++
    this.listeners.clear()
    this.suggestionListeners.clear()
  }

  private async run(term: string, seq: number): Promise<void> {
    const now = this.options.now ?? (() => performance.now())
    const started = now()
    const res = await this.api.search({
      term,
      ...(this.options.limit === undefined ? {} : { limit: this.options.limit }),
      ...(this.options.scope === undefined ? {} : { scope: this.options.scope })
    })
    if (seq !== this.seq) return // daha yeni bir terim var: eski yanıt gösterilmez
    if (res.ok) {
      // Bir kaynak (ör. kütüphane) oturum hatası verdiyse diğerinin sonucu yine gösterilir.
      for (const wire of [res.value.catalogError, res.value.libraryError]) {
        if (wire?.code === 'UNAUTHORIZED') await notifyUnauthorized(fromWireError(wire))
      }
      this.set({ status: 'done', result: res.value, elapsedMs: Math.round(now() - started) })
      return
    }
    const error = fromWireError(res.error)
    if (error.code === 'REQUEST_CANCELLED') return
    if (error.code === 'UNAUTHORIZED') await notifyUnauthorized(error)
    this.set({ status: 'error', term, error })
  }

  private async suggest(term: string, seq: number): Promise<void> {
    const res = await this.api.searchSuggestions({ term })
    if (seq !== this.seq) return
    if (res.ok) {
      this.setSuggestions(res.value)
      return
    }
    const error = fromWireError(res.error)
    if (error.code === 'REQUEST_CANCELLED') return
    if (error.code === 'UNAUTHORIZED') await notifyUnauthorized(error)
    this.setSuggestions(null)
  }

  private setSuggestions(suggestions: SearchSuggestions | null): void {
    this.suggestionsState = suggestions
    for (const listener of [...this.suggestionListeners]) listener(suggestions)
  }

  private set(state: SearchState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener(state)
  }
}

function unwrap<T>(res: IpcResult<T>): T {
  if (res.ok) return res.value
  throw fromWireError(res.error)
}
