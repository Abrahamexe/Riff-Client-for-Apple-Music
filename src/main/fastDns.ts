import { FAST_DNS } from '@shared/app-config'

// Hızlı DNS — Chromium tarafı (2026-10-15, R2; gerekçe ve ölçüm `FAST_DNS`, shared/app-config.ts).
// MusicKit, çalma, Apple API ve kapak istekleri Chromium ağ servisinden geçer; DNS'i burada kurulur.
//  - açık + DoH erişilebilir → "secure": yalnızca DoH (yavaş sistem DNS'i hiç beklenmez).
//    "automatic" ölçüldü: DoH sunucusu yoklanana kadar sistem DNS'i kullanılıyor, açılış hâlâ yavaş.
//  - açık + DoH erişilemiyor (ağ engelliyor) → "automatic": Chromium sistem DNS'ine düşer, DoH
//    sunucusunu kendisi yoklar ve erişilince ona geçer. "secure"de kalınsaydı her istek düşerdi.
//  - kapalı (İnce Ayar) → sistem DNS'i (Electron'un Windows varsayılanı: yerleşik çözümleyici kapalı).
// Erişilebilirlik tek küçük DoH sorgusuyla yoklanır: açılışta, uyanınca (zorla) ve ana pencere
// odaklanınca (en sık `minRecheckMs`'de bir). Periyodik zamanlayıcı yok (enerji kuralı 1.8b).

export interface HostResolverConfig {
  enableBuiltInResolver: boolean
  secureDnsMode: 'off' | 'automatic' | 'secure'
  secureDnsServers: string[]
}

export interface FastDnsDeps {
  /** Electron `app.configureHostResolver`. */
  configure: (config: HostResolverConfig) => void
  /** DoH sunucusu yanıt veriyor mu (zaman aşımı dahil; asla fırlatmamalı). */
  probe: () => Promise<boolean>
  now?: () => number
  /** Odaklanmada yoklamanın en sık aralığı. */
  minRecheckMs?: number
}

export const SYSTEM_DNS: HostResolverConfig = {
  enableBuiltInResolver: false,
  secureDnsMode: 'off',
  secureDnsServers: []
}

export function fastDnsConfig(enabled: boolean, reachable: boolean): HostResolverConfig {
  if (!enabled) return SYSTEM_DNS
  return {
    enableBuiltInResolver: true,
    secureDnsMode: reachable ? 'secure' : 'automatic',
    secureDnsServers: [...FAST_DNS.dohTemplates]
  }
}

/** Açılışta (app ready) bir kez oluşturulur; varsayılan açık ve erişilebilir varsayılır. */
export function createFastDns({
  configure,
  probe,
  now = Date.now,
  minRecheckMs = 60_000
}: FastDnsDeps) {
  let enabled = true
  let reachable = true
  let applied = ''
  let lastCheck = -Infinity
  const apply = (): void => {
    const config = fastDnsConfig(enabled, reachable)
    const key = JSON.stringify(config)
    if (key === applied) return
    applied = key
    configure(config)
  }
  const check = async (): Promise<void> => {
    if (!enabled) return
    lastCheck = now()
    reachable = await probe()
    apply()
  }
  apply()
  void check()
  return {
    /** Worker bildirdi (açılış ve İnce Ayar değişikliği). */
    setEnabled(next: boolean): void {
      if (next === enabled) return
      enabled = next
      apply()
      if (enabled) void check()
    },
    /** Uyanma (`force`) / pencere odağı: erişilebilirlik yeniden yoklanır. */
    recheck: (force = false): Promise<void> =>
      force || now() - lastCheck >= minRecheckMs ? check() : Promise.resolve(),
    current: (): HostResolverConfig => fastDnsConfig(enabled, reachable)
  }
}

/**
 * DoH yoklaması için RFC 8484 GET sorgusu (`apple.com` A kaydı, base64url). Adres IP'li olduğundan
 * DNS gerektirmez.
 */
export const DOH_PROBE_QUERY = 'AAABAAABAAAAAAAABWFwcGxlA2NvbQAAAQAB'

/** `fetch` biçiminde istek (main'de Electron `net.fetch`). */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<{ ok: boolean }>

/** DoH sunucularından biri 3 sn içinde yanıt verirse erişilebilir. */
export function createDohProbe(fetchFn: FetchLike, timeoutMs = 3000): () => Promise<boolean> {
  return async () => {
    for (const template of FAST_DNS.dohTemplates) {
      try {
        const res = await fetchFn(`${template}?dns=${DOH_PROBE_QUERY}`, {
          headers: { accept: 'application/dns-message' },
          signal: AbortSignal.timeout(timeoutMs)
        })
        if (res.ok) return true
      } catch {
        // Sıradaki sunucu denenir.
      }
    }
    return false
  }
}
