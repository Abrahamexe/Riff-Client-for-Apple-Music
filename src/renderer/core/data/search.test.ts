import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchSuggestions, UnifiedSearch } from '@shared/ipc-contract'
import type { IpcResult } from '@shared/types'
import { SearchController, type SearchState } from './search'

const result = (term: string): UnifiedSearch => ({
  term,
  catalog: { top: [], songs: [], albums: [], artists: [], playlists: [], stations: [] },
  library: null,
  catalogError: null,
  libraryError: null
})

const suggestions = (term: string): SearchSuggestions => ({
  term,
  terms: [{ searchTerm: `${term}n`, displayTerm: `${term}n` }],
  top: []
})

function setup() {
  const pending = new Map<string, (r: IpcResult<UnifiedSearch>) => void>()
  const pendingSuggest = new Map<string, (r: IpcResult<SearchSuggestions>) => void>()
  const api = {
    searchSuggestions: vi.fn(
      ({ term }: { term: string }) =>
        new Promise<IpcResult<SearchSuggestions>>((resolve) => pendingSuggest.set(term, resolve))
    ),
    search: vi.fn(
      ({ term }: { term: string }) =>
        new Promise<IpcResult<UnifiedSearch>>((resolve) => pending.set(term, resolve))
    ),
    getRecentSearches: vi.fn(async () => ({ ok: true as const, value: [] })),
    addRecentSearch: vi.fn(async () => ({ ok: true as const, value: null })),
    clearRecentSearches: vi.fn(async () => ({ ok: true as const, value: null }))
  }
  const controller = new SearchController(api, { debounceMs: 250, now: () => 0 })
  const states: SearchState[] = []
  controller.onChange((s) => states.push(s))
  const shown: (SearchSuggestions | null)[] = []
  controller.onSuggestions((s) => shown.push(s))
  return { controller, api, pending, pendingSuggest, states, shown }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SearchController (3.B1)', () => {
  it('debounce: hızlı yazımda yalnızca son terim için istek atılır', async () => {
    vi.useFakeTimers()
    const { controller, api } = setup()
    for (const t of ['q', 'qu', 'que', 'quee', 'queen']) {
      controller.input(t)
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(250)
    expect(api.search).toHaveBeenCalledTimes(1)
    expect(api.search).toHaveBeenCalledWith({ term: 'queen' })
  })

  it('geç gelen eski yanıt gösterilmez; yalnızca son terimin sonucu', async () => {
    vi.useFakeTimers()
    const { controller, pending, states } = setup()
    controller.input('tarkan')
    await vi.advanceTimersByTimeAsync(250)
    controller.input('queen')
    await vi.advanceTimersByTimeAsync(250)
    pending.get('queen')!({ ok: true, value: result('queen') })
    await vi.advanceTimersByTimeAsync(0)
    pending.get('tarkan')!({ ok: true, value: result('tarkan') })
    await vi.advanceTimersByTimeAsync(0)
    const done = states.filter((s) => s.status === 'done')
    expect(done).toHaveLength(1)
    expect(controller.current).toMatchObject({ status: 'done', result: { term: 'queen' } })
  })

  it('iptal edilen istek hata olarak gösterilmez; boş terim sonucu temizler', async () => {
    vi.useFakeTimers()
    const { controller, pending, states } = setup()
    controller.input('queen')
    await vi.advanceTimersByTimeAsync(250)
    controller.input('  ')
    pending.get('queen')!({
      ok: false,
      error: { code: 'REQUEST_CANCELLED', message: 'iptal' }
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(states.some((s) => s.status === 'error')).toBe(false)
    expect(controller.current).toEqual({ status: 'idle' })
  })

  it('submit beklemeden arar ve son aramalara ekler; hata durumu terimi taşır', async () => {
    const { controller, api, pending } = setup()
    const done = controller.submit(' queen ')
    await vi.waitFor(() => expect(pending.has('queen')).toBe(true))
    pending.get('queen')!({ ok: false, error: { code: 'OFFLINE', message: 'ağ yok' } })
    await done
    expect(api.addRecentSearch).toHaveBeenCalledWith({ term: 'queen' })
    expect(controller.current).toMatchObject({ status: 'error', term: 'queen' })
    expect(controller.current.status === 'error' && controller.current.error.code).toBe('OFFLINE')
  })
})

describe('SearchController önerileri (PLAN_v5 P2)', () => {
  it('aynı debounce ile aramayla paralel istenir; yalnızca son terimin önerisi gösterilir', async () => {
    vi.useFakeTimers()
    const { controller, api, pendingSuggest, shown } = setup()
    controller.input('que')
    await vi.advanceTimersByTimeAsync(250)
    controller.input('quee')
    await vi.advanceTimersByTimeAsync(250)
    expect(api.searchSuggestions).toHaveBeenCalledTimes(2)
    pendingSuggest.get('quee')!({ ok: true, value: suggestions('quee') })
    await vi.advanceTimersByTimeAsync(0)
    pendingSuggest.get('que')!({ ok: true, value: suggestions('que') })
    await vi.advanceTimersByTimeAsync(0)
    expect(shown.filter((s) => s !== null).map((s) => s.term)).toEqual(['quee'])
    expect(controller.suggestions?.term).toBe('quee')
  })

  it('boş terim ve seçim (submit) öneri kutusunu kapatır; hata → boş, iptal → değişmez', async () => {
    vi.useFakeTimers()
    const { controller, pendingSuggest, shown } = setup()
    controller.input('a')
    await vi.advanceTimersByTimeAsync(250)
    pendingSuggest.get('a')!({ ok: false, error: { code: 'REQUEST_CANCELLED', message: 'x' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(shown).toEqual([])
    controller.input('b')
    await vi.advanceTimersByTimeAsync(250)
    pendingSuggest.get('b')!({ ok: true, value: suggestions('b') })
    await vi.advanceTimersByTimeAsync(0)
    controller.input('')
    expect(controller.suggestions).toBeNull()
    controller.input('c')
    await vi.advanceTimersByTimeAsync(250)
    pendingSuggest.get('c')!({ ok: false, error: { code: 'SERVER_ERROR', message: 'x' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.suggestions).toBeNull()
    void controller.submit('d')
    expect(shown.at(-1)).toBeNull()
  })
})

describe('SearchController — B7 arayüz kipi', () => {
  it('liveResults: false → yazarken yalnızca öneri istenir, arama durumu değişmez', async () => {
    vi.useFakeTimers()
    const api = {
      searchSuggestions: vi.fn(async ({ term }: { term: string }) => ({
        ok: true as const,
        value: suggestions(term)
      })),
      search: vi.fn(async ({ term }: { term: string }) => ({
        ok: true as const,
        value: result(term)
      })),
      getRecentSearches: vi.fn(),
      addRecentSearch: vi.fn(),
      clearRecentSearches: vi.fn()
    }
    const controller = new SearchController(api, { debounceMs: 250, liveResults: false })
    const states: SearchState[] = []
    controller.onChange((s) => states.push(s))
    const shown: (SearchSuggestions | null)[] = []
    controller.onSuggestions((s) => shown.push(s))
    controller.input('que')
    await vi.advanceTimersByTimeAsync(250)
    expect(api.search).not.toHaveBeenCalled()
    expect(api.searchSuggestions).toHaveBeenCalledWith({ term: 'que' })
    expect(shown.at(-1)?.term).toBe('que')
    expect(states).toEqual([])
    vi.useRealTimers()
  })

  it('find: kapsam ve sınırla arar; hata CoreError olarak fırlatılır', async () => {
    const api = {
      searchSuggestions: vi.fn(),
      search: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: result('queen') })
        .mockResolvedValueOnce({
          ok: false,
          error: { code: 'REQUEST_CANCELLED', message: 'iptal' }
        }),
      getRecentSearches: vi.fn(),
      addRecentSearch: vi.fn(),
      clearRecentSearches: vi.fn()
    }
    const controller = new SearchController(api, { liveResults: false })
    const found = await controller.find(' queen ', { scope: 'catalog', limit: 25 })
    expect(found.term).toBe('queen')
    expect(api.search).toHaveBeenCalledWith({ term: 'queen', scope: 'catalog', limit: 25 })
    await expect(controller.find('x')).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
  })
})
