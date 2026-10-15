// Süreç sınırlarından (IPC, MessagePort) dönen sonuç zarfı.
import type { ErrorCode, WireError } from './errors'

/** IPC katmanının kendi hata kodları (katalogda `ipc` ve `app` kategorileri). */
export type IpcErrorCode = Extract<
  ErrorCode,
  'UNKNOWN_CHANNEL' | 'FORBIDDEN' | 'INVALID_PAYLOAD' | 'IPC_RATE_LIMITED' | 'INTERNAL'
>

export type IpcError = WireError

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError }
