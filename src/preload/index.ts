/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'
import { invokeContract, WORKER_PORT_CHANNEL } from '@shared/ipc-contract'
import { buildRendererApi, isOwnContent } from './api'
import { buildWorkerApi, WorkerClient } from './workerClient'

// Renderer'a yalnızca sözleşmeden üretilen dar API açılır (Güvenlik kuralı 2, 3 ve 4).
// localhost yalnızca `electron-vite dev` build'inde kabul edilir (__DEV_SERVER__).
if (isOwnContent(location.href, __DEV_SERVER__)) {
  // Worker portu preload'da kalır; renderer yalnızca sözleşmedeki yöntemleri görür (PLAN 1.7a).
  const worker = new WorkerClient()
  ipcRenderer.on(WORKER_PORT_CHANNEL, (event) => {
    const [port] = event.ports
    if (port) worker.attach(port)
  })
  contextBridge.exposeInMainWorld('api', buildRendererApi(ipcRenderer, buildWorkerApi(worker)))
  void ipcRenderer.invoke(invokeContract.connectWorker.channel)
}
