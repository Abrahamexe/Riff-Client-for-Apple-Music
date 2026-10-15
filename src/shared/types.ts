// Ortak tipler. Kanal adları ve şemalar ipc-contract.ts'dedir (tek kaynak); buradaki tipler oradan
// yeniden dışa aktarılır ki mevcut import'lar değişmesin.

export type { CdmStatus, DeveloperTokenInfo, RendererApi } from './ipc-contract'
export type { IpcError, IpcErrorCode, IpcResult } from './result'
