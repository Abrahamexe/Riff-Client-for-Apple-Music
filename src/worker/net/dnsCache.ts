import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'

// Worker DNS önbelleği (2026-10-14). Ölçüm: geliştiricinin DNS sunucusu (bağlantı paylaşımı) önbellekte
// olmayan her alan adı için 1,8–5,9 sn bekletiyor ve TTL=0 döndürüyor; Windows sonucu önbelleğe almıyor.
// Node'un yerleşik `fetch`'i boşta kalan bağlantıyı birkaç saniyede kapatıyor → her yeni bağlantıda
// yeniden çözümleme: 15 sn boşta kaldıktan sonra Apple isteği 0,4 → 2,1 sn, sözler ilk açılışta yavaş.
// Node `fetch`'i `dns.lookup`'ı çağırır (yerel sunucuyla doğrulandı); worker açılışta onu bu önbellekli
// sürümle değiştirir: sonuç `ttlMs` taze, `staleMs`'e kadar eski sonuç anında verilip arka planda
// yenilenir (ağ değişse de en fazla bir istek eski adrese gider). Hatalar önbelleğe alınmaz; IP ve
// localhost doğrudan geçer.

type Callback = (
  err: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number
) => void

interface Options {
  family?: number
  hints?: number
  all?: boolean
  [key: string]: unknown
}

/** `dns.lookup`'ın kullandığımız biçimi: (ad, seçenekler, geri çağırma). */
export type LookupFn = (hostname: string, options: Options, callback: Callback) => void

export interface DnsCacheOptions {
  ttlMs?: number
  staleMs?: number
  now?: () => number
  /** Önbellekteki yanıtın ertelenmesi (geri çağırma asla eşzamanlı değil). */
  defer?: (fn: () => void) => void
}

export function createCachedLookup(
  original: LookupFn,
  {
    ttlMs = 5 * 60_000,
    staleMs = 30 * 60_000,
    now = Date.now,
    defer = (fn) => process.nextTick(fn)
  }: DnsCacheOptions = {}
) {
  const cache = new Map<string, { at: number; addresses: LookupAddress[] }>()
  const refreshing = new Set<string>()

  const resolve = (
    host: string,
    opts: Options,
    key: string,
    done: (err: NodeJS.ErrnoException | null, addresses?: LookupAddress[]) => void
  ): void => {
    original(host, { ...opts, all: true }, (err, addresses) => {
      if (!err && Array.isArray(addresses) && addresses.length > 0) {
        cache.set(key, { at: now(), addresses })
        done(null, addresses)
      } else done(err ?? Object.assign(new Error(`DNS: ${host} çözülemedi`), { code: 'ENOTFOUND' }))
    })
  }

  function lookup(hostname: string, a: unknown, b?: unknown): void {
    const callback = (typeof a === 'function' ? a : b) as Callback
    const opts: Options =
      typeof a === 'function' ? {} : typeof a === 'number' ? { family: a } : ((a as Options) ?? {})
    if (isIP(hostname) !== 0 || hostname === 'localhost') {
      original(hostname, opts, callback)
      return
    }
    const key = `${hostname.toLowerCase()}|${opts.family ?? 0}|${opts.hints ?? 0}`
    const answer = (addresses: LookupAddress[]): void => {
      if (opts.all) callback(null, addresses)
      else callback(null, addresses[0]!.address, addresses[0]!.family)
    }
    const hit = cache.get(key)
    const age = hit ? now() - hit.at : Infinity
    if (hit && age < staleMs) {
      defer(() => answer(hit.addresses))
      if (age >= ttlMs && !refreshing.has(key)) {
        refreshing.add(key)
        resolve(hostname, opts, key, () => refreshing.delete(key))
      }
      return
    }
    resolve(hostname, opts, key, (err, addresses) => {
      if (err || !addresses) callback(err)
      else answer(addresses)
    })
  }

  return Object.assign(lookup, { clear: () => cache.clear() })
}

/** Açık DNS sunucusundan çözümleme (`createPublicResolve`); aile 4 / 6 / 0 (önce IPv4). */
export type PublicResolve = (hostname: string, family: number) => Promise<LookupAddress[]>

/**
 * Hızlı DNS (2026-10-15, R2): önbellek kaçınca sistem çözümleyicisi ile açık DNS (Cloudflare) aynı anda
 * sorulur, ilk geçerli yanıt kazanır. Ölçüm: geliştiricinin sistem DNS'i alan adı başına 4–10 sn,
 * 1.1.1.1 25–60 ms. Açık DNS erişilemezse (UDP 53 kapalı ağ) sistem yanıtı kullanılır; ikisi de
 * düşerse sistemin hatası döner. `isEnabled` false iken (İnce Ayar "Hızlı DNS" kapalı) yalnızca sistem.
 */
export function createRacingLookup(
  system: LookupFn,
  resolvePublic: PublicResolve,
  isEnabled: () => boolean
): LookupFn {
  return (hostname, opts, callback) => {
    if (!isEnabled() || isIP(hostname) !== 0 || hostname === 'localhost') {
      system(hostname, opts, callback)
      return
    }
    let settled = false
    let failures = 0
    let systemError: NodeJS.ErrnoException | null = null
    const win = (addresses: LookupAddress[]): void => {
      if (settled) return
      settled = true
      if (opts.all) callback(null, addresses)
      else callback(null, addresses[0]!.address, addresses[0]!.family)
    }
    const lose = (): void => {
      if (settled || ++failures < 2) return
      settled = true
      callback(
        systemError ??
          Object.assign(new Error(`DNS: ${hostname} çözülemedi`), { code: 'ENOTFOUND' })
      )
    }
    system(hostname, { ...opts, all: true }, (err, addresses) => {
      if (!err && Array.isArray(addresses) && addresses.length > 0) win(addresses)
      else {
        systemError = err
        lose()
      }
    })
    resolvePublic(hostname, opts.family ?? 0).then(
      (addresses) => (addresses.length > 0 ? win(addresses) : lose()),
      () => lose()
    )
  }
}

/** `Resolver`'ın kullandığımız yüzeyi (`node:dns` `promises.Resolver`; testte sahte). */
export interface ResolverLike {
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
}

/** Açık DNS: IPv4 önce (IPv6'sız ağlarda bağlantı denemesi takılmasın), yoksa IPv6. */
export function createPublicResolve(resolver: ResolverLike): PublicResolve {
  const v4 = async (h: string): Promise<LookupAddress[]> =>
    (await resolver.resolve4(h)).map((address) => ({ address, family: 4 }))
  const v6 = async (h: string): Promise<LookupAddress[]> =>
    (await resolver.resolve6(h)).map((address) => ({ address, family: 6 }))
  return async (hostname, family) => {
    if (family === 4) return v4(hostname)
    if (family === 6) return v6(hostname)
    try {
      const found = await v4(hostname)
      if (found.length > 0) return found
    } catch {
      // IPv4 kaydı yok / hata: IPv6 denenir.
    }
    return v6(hostname)
  }
}
