import type { CdmSource } from '@core/cdm'
import { unwrap } from './ipc'

/** CdmSource'un IPC (preload → main) uygulaması. */
export const ipcCdmSource: CdmSource = {
  getStatus: () => unwrap(window.api.getCdmStatus()),
  onStatus: (listener) => window.api.onCdmStatus(listener)
}
