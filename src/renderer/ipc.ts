import { fromWireError } from '@core/errors'
import type { IpcResult } from '@shared/types'

/** `window.api` sonucunu değere çevirir; hata katalog kodlu bir CoreError olarak fırlatılır. */
export async function unwrap<T>(request: Promise<IpcResult<T>>): Promise<T> {
  const res = await request
  if (!res.ok) throw fromWireError(res.error)
  return res.value
}
