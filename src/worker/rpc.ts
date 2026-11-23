import type { z } from 'zod/mini'
import {
  isWorkerMethod,
  workerContract,
  WorkerRequestSchema,
  type WorkerMethod,
  type WorkerResponse,
  type WorkerResult
} from '@shared/ipc-contract'
import { CoreError, logError } from '@shared/errors'

// Renderer → worker istekleri (MessagePort). Main'deki IPC dispatcher'ın worker karşılığıdır:
// port yalnızca main'in doğruladığı renderer çerçevesine verilir, yine de her istek sözleşmedeki
// şemayla doğrulanır; bilinmeyen yöntem ve geçersiz yük reddedilir (PLAN 1.3a, Güvenlik kuralı 4).

export type WorkerHandlers = {
  [K in WorkerMethod]: (
    params: z.output<(typeof workerContract)[K]['params']>
  ) => WorkerResult<K> | Promise<WorkerResult<K>>
}

const fail = (id: number, error: CoreError): WorkerResponse => ({
  id,
  result: { ok: false, error: error.toWire() }
})

/** Zarfı geçersiz (yanıt verilemeyecek) mesajlar için `null` döner. */
export function createRpcHandler(
  handlers: WorkerHandlers
): (data: unknown) => Promise<WorkerResponse | null> {
  return async (data) => {
    const envelope = WorkerRequestSchema.safeParse(data)
    if (!envelope.success) {
      logError('worker', new CoreError('INVALID_PAYLOAD', 'geçersiz istek zarfı yoksayıldı'))
      return null
    }
    const { id, method, params } = envelope.data

    if (!isWorkerMethod(method)) {
      logError(
        'worker',
        new CoreError(
          'UNKNOWN_CHANNEL',
          `bilinmeyen yöntem: ${JSON.stringify(method).slice(0, 80)}`
        )
      )
      return fail(id, new CoreError('UNKNOWN_CHANNEL', 'İstek reddedildi.'))
    }

    const parsed = workerContract[method].params.safeParse(params)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(params)'}:${i.code}`)
      logError(
        'worker',
        new CoreError('INVALID_PAYLOAD', `${method}: geçersiz yük (${issues.join(', ')})`)
      )
      return fail(id, new CoreError('INVALID_PAYLOAD', 'İstek verisi geçersiz.'))
    }

    try {
      const handler = handlers[method] as (p: unknown) => unknown
      return { id, result: { ok: true, value: await handler(parsed.data) } }
    } catch (err) {
      // Beklenmeyen (ör. SQLite) hataların ayrıntısı renderer'a sızdırılmaz, burada loglanır.
      if (err instanceof CoreError) return fail(id, err)
      logError('worker', err, 'INTERNAL', `${method} beklenmeyen hata`)
      return fail(id, new CoreError('INTERNAL', 'Beklenmeyen bir hata oluştu.'))
    }
  }
}
