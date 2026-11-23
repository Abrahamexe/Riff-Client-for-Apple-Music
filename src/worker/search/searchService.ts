import type { Locale } from '@shared/i18n'
import type {
  SearchGroups,
  SearchScope,
  SearchSuggestions,
  UnifiedSearch
} from '@shared/ipc-contract'
import { CoreError } from '@shared/errors'
import type { Db } from '../db/connection'
import type { AppleMusicApi } from '../net/appleApi'

// Birleşik arama (PLAN 3.B1). Katalog ve kütüphane aynı anda aranır, sonuçlar türe göre gruplu
// döner. Yazarken arama: yeni istek süren öncekini iptal eder (latest-wins) — Apple'a yalnızca son
// terimin istekleri tamamlanır; iptal edilen `REQUEST_CANCELLED` ile biter. Son aramalar yerelde
// (recent_searches) ve çıkışta silinir.

const DEFAULT_SEARCH_LIMIT = 10
const DEFAULT_SUGGESTION_LIMIT = 5
/** Saklanan en fazla son arama (Apple Music uygulamasındaki liste kadar kısa). */
export const MAX_RECENT_SEARCHES = 20

export type SearchApi = Pick<AppleMusicApi, 'searchGroups' | 'searchSuggestions' | 'isSignedIn'>

export interface SearchParams {
  term: string
  limit?: number
  scope?: SearchScope
  /** Katalog sonuçlarının dili (B7). */
  locale?: Locale
}

export class SearchService {
  private current: AbortController | null = null
  /** Öneriler aramadan bağımsız iptal edilir (ikisi aynı anda süren iki ayrı istek). */
  private currentSuggest: AbortController | null = null

  constructor(
    private readonly db: Db,
    private readonly api: SearchApi,
    private readonly now: () => number = Date.now
  ) {}

  async search({
    term,
    limit = DEFAULT_SEARCH_LIMIT,
    scope = 'all',
    locale
  }: SearchParams): Promise<UnifiedSearch> {
    // Katalog da hesabın mağazasını gerektirir; giriş yokken arama yapılmaz.
    if (!this.api.isSignedIn()) throw new CoreError('NOT_SIGNED_IN', 'Arama için giriş yapın.')
    this.current?.abort()
    const controller = new AbortController()
    this.current = controller
    const { signal } = controller

    const run = (source: 'catalog' | 'library'): Promise<SearchGroups> | null => {
      if (scope !== 'all' && scope !== source) return null
      return this.api.searchGroups(source, term, limit, signal, locale)
    }
    const [catalog, library] = await Promise.allSettled([run('catalog'), run('library')])
    if (this.current === controller) this.current = null
    if (signal.aborted) {
      throw new CoreError('REQUEST_CANCELLED', 'Arama, daha yeni bir aramayla değiştirildi.')
    }
    const value = (r: PromiseSettledResult<SearchGroups | null>): SearchGroups | null =>
      r.status === 'fulfilled' ? r.value : null
    const error = (r: PromiseSettledResult<SearchGroups | null>) =>
      r.status === 'rejected'
        ? (r.reason instanceof CoreError
            ? r.reason
            : new CoreError('INTERNAL', 'Arama başarısız.', { cause: r.reason })
          ).toWire()
        : null
    return {
      term,
      catalog: value(catalog),
      library: value(library),
      catalogError: error(catalog),
      libraryError: error(library)
    }
  }

  /**
   * Yazarken öneriler (PLAN_v5 P2): yeni istek süren öncekini iptal eder (latest-wins); iptal edilen
   * `REQUEST_CANCELLED` ile biter.
   */
  async suggest({
    term,
    limit = DEFAULT_SUGGESTION_LIMIT
  }: {
    term: string
    limit?: number
  }): Promise<SearchSuggestions> {
    if (!this.api.isSignedIn()) throw new CoreError('NOT_SIGNED_IN', 'Öneriler için giriş yapın.')
    this.currentSuggest?.abort()
    const controller = new AbortController()
    this.currentSuggest = controller
    try {
      const result = await this.api.searchSuggestions(term, limit, controller.signal)
      if (controller.signal.aborted) throw cancelled()
      return { term, ...result }
    } catch (err) {
      if (controller.signal.aborted) throw cancelled()
      throw err
    } finally {
      if (this.currentSuggest === controller) this.currentSuggest = null
    }
  }

  recent(limit = MAX_RECENT_SEARCHES): { term: string; searchedAt: number }[] {
    const rows = this.db
      .prepare('SELECT term, searched_at FROM recent_searches ORDER BY searched_at DESC LIMIT ?')
      .all(limit) as { term: string; searched_at: number }[]
    return rows.map((r) => ({ term: r.term, searchedAt: r.searched_at }))
  }

  /** Aynı terim (büyük/küçük harf duyarsız) en üste taşınır; liste `MAX_RECENT_SEARCHES` ile sınırlı. */
  addRecent(term: string): void {
    const t = term.trim()
    if (t === '') return
    this.db
      .prepare(
        `INSERT INTO recent_searches (term, searched_at) VALUES (?, ?)
         ON CONFLICT(term) DO UPDATE SET term = excluded.term, searched_at = excluded.searched_at`
      )
      .run(t, this.now())
    this.db
      .prepare(
        `DELETE FROM recent_searches WHERE term NOT IN
           (SELECT term FROM recent_searches ORDER BY searched_at DESC LIMIT ?)`
      )
      .run(MAX_RECENT_SEARCHES)
  }

  /** Kullanıcı "Temizle" dedi veya çıkış yaptı. Süren arama da iptal edilir. */
  clear(): void {
    this.current?.abort()
    this.current = null
    this.currentSuggest?.abort()
    this.currentSuggest = null
    this.db.prepare('DELETE FROM recent_searches').run()
  }
}

const cancelled = (): CoreError =>
  new CoreError('REQUEST_CANCELLED', 'Öneri isteği, daha yeni bir istekle değiştirildi.')
