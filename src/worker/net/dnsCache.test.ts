import { describe, expect, it, vi } from 'vitest'
import {
  createCachedLookup,
  createPublicResolve,
  createRacingLookup,
  type LookupFn
} from './dnsCache'

const A = [{ address: '23.67.130.123', family: 4 }]
const B = [{ address: '2.20.134.217', family: 4 }]

function setup(results: (typeof A | Error)[] = [A, B, A]) {
  let t = 0
  const pending: (() => void)[] = []
  const original = vi.fn<LookupFn>((_host, opts, cb) => {
    const r = results.shift() ?? A
    void opts
    pending.push(() => (r instanceof Error ? cb(r) : cb(null, r)))
  })
  const lookup = createCachedLookup(original, {
    ttlMs: 1_000,
    staleMs: 10_000,
    now: () => t,
    defer: (fn) => fn()
  })
  const flush = (): void => {
    while (pending.length) pending.shift()!()
  }
  const ask = (host = 'aod-ssl.itunes.apple.com', opts: unknown = {}) => {
    const cb = vi.fn()
    lookup(host, opts, cb)
    return cb
  }
  return { original, ask, flush, advance: (ms: number) => void (t += ms) }
}

describe('worker DNS önbelleği', () => {
  it('ilk sorgu çözülür; taze sonuç yeniden sorulmaz; tek adres ve `all` biçimi', () => {
    const { original, ask, flush } = setup()
    const first = ask()
    flush()
    expect(first).toHaveBeenCalledWith(null, '23.67.130.123', 4)
    const all = ask('aod-ssl.itunes.apple.com', { all: true })
    expect(all).toHaveBeenCalledWith(null, A)
    expect(original).toHaveBeenCalledTimes(1)
    // Önbellek için her zaman tüm adresler istenir.
    expect(original.mock.calls[0]![1]).toMatchObject({ all: true })
  })

  it('TTL geçince eski sonuç anında verilir, arka planda yenilenir; sonra yenisi', () => {
    const { original, ask, flush, advance } = setup()
    ask()
    flush()
    advance(1_500)
    const stale = ask()
    expect(stale).toHaveBeenCalledWith(null, '23.67.130.123', 4)
    ask() // yenileme sürerken ikinci istek yeni sorgu başlatmaz
    expect(original).toHaveBeenCalledTimes(2)
    flush()
    const fresh = ask()
    expect(fresh).toHaveBeenCalledWith(null, '2.20.134.217', 4)
  })

  it('çok eski sonuç kullanılmaz; hata önbelleğe alınmaz', () => {
    const err = Object.assign(new Error('zaman aşımı'), { code: 'ETIMEOUT' })
    const { original, ask, flush, advance } = setup([A, err, B])
    ask()
    flush()
    advance(20_000)
    const failed = ask()
    expect(failed).not.toHaveBeenCalled()
    flush()
    expect(failed).toHaveBeenCalledWith(err)
    const next = ask()
    flush()
    expect(next).toHaveBeenCalledWith(null, '2.20.134.217', 4)
    expect(original).toHaveBeenCalledTimes(3)
  })

  it('IP ve localhost doğrudan geçer; aile ayrı anahtar', () => {
    const { original, ask, flush } = setup()
    ask('127.0.0.1')
    ask('localhost')
    expect(original).toHaveBeenCalledTimes(2)
    flush()
    ask('api.music.apple.com', 4)
    ask('api.music.apple.com', 6)
    expect(original).toHaveBeenCalledTimes(4)
  })
})

describe('createRacingLookup (Hızlı DNS, R2)', () => {
  const C = [{ address: '1.2.3.4', family: 4 }]

  function race(enabled = true) {
    let systemCb: Parameters<LookupFn>[2] | null = null
    const system = vi.fn<LookupFn>((_h, _o, cb) => void (systemCb = cb))
    let resolvePublic!: (v: typeof C) => void
    let rejectPublic!: (e: Error) => void
    const pub = vi.fn(
      () =>
        new Promise<typeof C>((res, rej) => {
          resolvePublic = res
          rejectPublic = rej
        })
    )
    const lookup = createRacingLookup(system, pub, () => enabled)
    const cb = vi.fn()
    return {
      system,
      pub,
      cb,
      ask: (host = 'api.music.apple.com', opts: Record<string, unknown> = { all: true }) =>
        lookup(host, opts, cb),
      systemAnswers: (r: typeof C | Error) =>
        r instanceof Error ? systemCb!(r) : systemCb!(null, r),
      publicAnswers: (r: typeof C) => resolvePublic(r),
      publicFails: () => rejectPublic(new Error('udp kapalı'))
    }
  }
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('açık DNS önce yanıtlarsa o kullanılır; geç gelen sistem yanıtı yoksayılır', async () => {
    const r = race()
    r.ask()
    r.publicAnswers(C)
    await tick()
    r.systemAnswers(A)
    expect(r.cb).toHaveBeenCalledTimes(1)
    expect(r.cb).toHaveBeenCalledWith(null, C)
  })

  it('sistem önce yanıtlarsa o kullanılır', async () => {
    const r = race()
    r.ask()
    r.systemAnswers(A)
    r.publicAnswers(C)
    await tick()
    expect(r.cb).toHaveBeenCalledTimes(1)
    expect(r.cb).toHaveBeenCalledWith(null, A)
  })

  it('açık DNS düşerse sistem beklenir; ikisi de düşerse sistemin hatası', async () => {
    const r = race()
    r.ask()
    r.publicFails()
    await tick()
    expect(r.cb).not.toHaveBeenCalled()
    const err = Object.assign(new Error('yok'), { code: 'ENOTFOUND' })
    r.systemAnswers(err)
    expect(r.cb).toHaveBeenCalledWith(err)
  })

  it('all: false → tek adres + aile', async () => {
    const r = race()
    r.ask('api.music.apple.com', { family: 0 })
    r.publicAnswers(C)
    await tick()
    expect(r.cb).toHaveBeenCalledWith(null, '1.2.3.4', 4)
  })

  it('kapalıyken, IP ve localhost için yalnızca sistem', () => {
    const off = race(false)
    off.ask()
    expect(off.pub).not.toHaveBeenCalled()
    const r = race()
    r.ask('127.0.0.1')
    r.ask('localhost')
    expect(r.pub).not.toHaveBeenCalled()
    expect(r.system).toHaveBeenCalledTimes(2)
  })
})

describe('createPublicResolve', () => {
  it('aile 0: IPv4 önce, yoksa IPv6; aile 4/6 doğrudan', async () => {
    const resolver = {
      resolve4: vi.fn((h: string) =>
        h === 'v6only' ? Promise.reject(new Error('ENODATA')) : Promise.resolve(['1.1.1.1'])
      ),
      resolve6: vi.fn(() => Promise.resolve(['::1']))
    }
    const resolve = createPublicResolve(resolver)
    expect(await resolve('a', 0)).toEqual([{ address: '1.1.1.1', family: 4 }])
    expect(await resolve('v6only', 0)).toEqual([{ address: '::1', family: 6 }])
    expect(await resolve('a', 6)).toEqual([{ address: '::1', family: 6 }])
    expect(await resolve('a', 4)).toEqual([{ address: '1.1.1.1', family: 4 }])
  })
})
