import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '@shared/errors'
import { openDatabase, type Db } from '../db/connection'
import { IsrcResolver, MISSING_ISRC_RETRY_MS, type IsrcApi } from './isrcResolver'

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

function setup(table: Record<string, string | null> = { '111': 'GBUM71029604', '222': null }) {
  const clock = { t: 1_000_000 }
  let signedIn = true
  const getSongIsrcs = vi.fn(async (ids: readonly string[]) => {
    const out = new Map<string, string | null>()
    for (const id of ids) if (id in table) out.set(id, table[id]!)
    return out
  })
  const api: IsrcApi = { getSongIsrcs, isSignedIn: () => signedIn }
  const resolver = new IsrcResolver(db, api, () => clock.t, 0)
  return { resolver, getSongIsrcs, clock, setSignedIn: (v: boolean) => (signedIn = v) }
}

describe('IsrcResolver (V8)', () => {
  it('Apple’dan çözer, kalıcı saklar; ikinci istek ağa çıkmaz', async () => {
    const { resolver, getSongIsrcs } = setup()
    expect(await resolver.resolve('111')).toBe('GBUM71029604')
    expect(await resolver.resolve('111')).toBe('GBUM71029604')
    expect(getSongIsrcs).toHaveBeenCalledTimes(1)
    // Yeni süreç (aynı DB): yine ağa çıkmaz.
    const again = new IsrcResolver(db, { getSongIsrcs, isSignedIn: () => true })
    expect(await again.resolve('111')).toBe('GBUM71029604')
    expect(getSongIsrcs).toHaveBeenCalledTimes(1)
  })

  it('eşzamanlı istekler tek Apple isteğinde toplanır', async () => {
    const { resolver, getSongIsrcs } = setup()
    const [a, b, c] = await Promise.all([
      resolver.resolve('111'),
      resolver.resolve('222'),
      resolver.resolve('111')
    ])
    expect([a, b, c]).toEqual(['GBUM71029604', undefined, 'GBUM71029604'])
    expect(getSongIsrcs).toHaveBeenCalledTimes(1)
    expect([...getSongIsrcs.mock.calls[0]![0]].sort()).toEqual(['111', '222'])
  })

  it('ISRC’si olmayan şarkı bir süre yeniden sorulmaz, sonra sorulur', async () => {
    const { resolver, getSongIsrcs, clock } = setup()
    expect(await resolver.resolve('222')).toBeUndefined()
    expect(await resolver.resolve('222')).toBeUndefined()
    expect(getSongIsrcs).toHaveBeenCalledTimes(1)
    clock.t += MISSING_ISRC_RETRY_MS
    await resolver.resolve('222')
    expect(getSongIsrcs).toHaveBeenCalledTimes(2)
  })

  it('giriş yoksa ağa çıkmaz; hata olursa undefined (eşleştirme aramayla sürer) ve sonra yeniden dener', async () => {
    const { resolver, getSongIsrcs, setSignedIn } = setup()
    setSignedIn(false)
    expect(await resolver.resolve('111')).toBeUndefined()
    expect(getSongIsrcs).not.toHaveBeenCalled()
    setSignedIn(true)
    getSongIsrcs.mockRejectedValueOnce(new CoreError('OFFLINE', 'ağ yok'))
    expect(await resolver.resolve('111')).toBeUndefined()
    expect(await resolver.resolve('111')).toBe('GBUM71029604')
  })

  it('çıkışta silinir', async () => {
    const { resolver } = setup()
    await resolver.resolve('111')
    resolver.clear()
    expect(db.prepare('SELECT COUNT(*) AS n FROM apple_isrc').get()).toEqual({ n: 0 })
  })

  it('çıkış sırasında uçuştaki isteğin sonucu yazılmaz (2.7 Y2)', async () => {
    const { resolver, getSongIsrcs } = setup()
    let release!: () => void
    getSongIsrcs.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r))
      return new Map([['111', 'GBUM71029604']])
    })
    const inFlight = resolver.resolve('111')
    await vi.waitFor(() => expect(getSongIsrcs).toHaveBeenCalled())
    resolver.clear()
    release()
    await inFlight
    expect(db.prepare('SELECT COUNT(*) AS n FROM apple_isrc').get()).toEqual({ n: 0 })
  })
})
