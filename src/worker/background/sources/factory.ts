import type { CoreError } from '@shared/errors'
import type { RetryOptions } from '@shared/retry'
import type { ResponseCache } from '../cache'
import { RateLimiter } from '../rateLimiter'
import { SourceClient } from '../sourceClient'
import { SOURCE_POLICIES, type BackgroundSourceId } from './policies'

// Kaynak politikasından (policies.ts) SourceClient üretir. Her kaynağın kendi sınırlayıcısı vardır;
// Wikidata ve Wikipedia aynı `wikimedia` sınırlayıcısını paylaşır (limit tüm sitelerde ortak).

export interface SourceClientDeps {
  userAgent: string
  cache?: ResponseCache
  fetch?: typeof fetch
  now?: () => number
  /** Sınırlayıcının ve geri çekilmenin uykusu (testlerde sanal saat). */
  sleep?: (ms: number) => Promise<void>
  retry?: RetryOptions
}

export interface SourceExtras {
  headers?: Readonly<Record<string, string>>
  inspectBody?: (body: unknown) => CoreError | null
}

export function createSourceClient(
  id: BackgroundSourceId,
  deps: SourceClientDeps,
  extras: SourceExtras = {}
): SourceClient {
  const policy = SOURCE_POLICIES[id]
  return new SourceClient({
    source: id,
    origins: policy.origins,
    limiter: new RateLimiter({
      perSecond: policy.perSecond,
      burst: policy.burst,
      maxConcurrent: policy.maxConcurrent,
      now: deps.now,
      sleep: deps.sleep
    }),
    userAgent: deps.userAgent,
    ttlMs: policy.ttlMs,
    notFoundTtlMs: policy.notFoundTtlMs,
    treat503AsRateLimit: policy.treat503AsRateLimit,
    rateLimitPauseMs: policy.rateLimitPauseMs,
    cache: deps.cache,
    fetch: deps.fetch,
    now: deps.now,
    retry: { ...deps.retry, ...(deps.sleep ? { sleep: deps.sleep } : {}) },
    ...extras
  })
}
