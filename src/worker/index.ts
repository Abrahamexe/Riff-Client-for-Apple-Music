import type { MessageEvent, MessagePortMain } from 'electron'
import { MainToWorkerSchema, type WorkerEvent, type WorkerToMain } from '@shared/ipc-contract'
import { APP_CONFIG, FAST_DNS, buildUserAgent } from '@shared/app-config'
import { CoreError, fromWireError, logError } from '@shared/errors'
import { ArtworkStore } from './artwork/artworkStore'
import { BackgroundService } from './background/service'
import { rmSync } from 'node:fs'
import dns from 'node:dns'
import { createCachedLookup, createPublicResolve, createRacingLookup } from './net/dnsCache'
import { openDatabaseResilient } from './db/connection'
import { AppleMusicApi } from './net/appleApi'
import { createRpcHandler } from './rpc'
import { IsrcResolver } from './net/isrcResolver'
import { createWorkerServices, type WorkerServices } from './services'
import { installProcessErrorHandlers } from '@shared/errors/global'

// Worker süreci (Electron utilityProcess, PLAN 1.7a): SQLite, senkronizasyon ve Apple API çağrıları
// burada yapılır; main bloklanmaz. Main ile `process.parentPort`, renderer ile main'in verdiği
// MessagePort üzerinden konuşur. Token'lar yalnızca bu sürecin belleğinde durur, diske yazılmaz.

// Yavaş / TTL=0 DNS'te her yeni bağlantı 2–6 sn bekliyordu: worker'ın tüm istekleri (Apple, LRCLIB,
// arka plan kaynakları) önbellekli çözümleme kullanır (`net/dnsCache.ts`, gerekçe ve ölçüm orada).
// R2: önbellek kaçınca sistem DNS'i açık DNS'le yarışır (İnce Ayar "Hızlı DNS"; `createRacingLookup`).
let fastDns = true
const publicResolver = new dns.promises.Resolver({ timeout: 2000, tries: 1 })
publicResolver.setServers([...FAST_DNS.servers])
dns.lookup = createCachedLookup(
  createRacingLookup(dns.lookup.bind(dns), createPublicResolve(publicResolver), () => fastDns)
) as unknown as typeof dns.lookup

const parentPort = process.parentPort
const ports = new Set<MessagePortMain>()
const TOKEN_TIMEOUT_MS = 10_000

let userToken: string | null = null
/** Çökme döngüsünde main açar (PLAN 2.3): arka plan katmanı ve ön yükleme kapalı. */
let safeMode = false

// PLAN 2.3: yakalanmamış hatalar katalog koduyla loglanır; worker çökmez.
installProcessErrorHandlers('worker', process)
let services: WorkerServices | null = null
let dbPathForWipe: string | null = null
let handleRequest: ReturnType<typeof createRpcHandler> | null = null
let artwork: ArtworkStore | null = null

const send = (msg: WorkerToMain): void => parentPort.postMessage(msg)

function broadcast(event: WorkerEvent): void {
  for (const port of ports) port.postMessage(event)
}

// --- Developer token: main'deki TokenProvider'dan istenir (main cache'ler ve yeniler) ----------
let nextTokenRequest = 1
const tokenRequests = new Map<
  number,
  { resolve: (token: string) => void; reject: (err: CoreError) => void; timer: NodeJS.Timeout }
>()

function requestDeveloperToken(refresh = false): Promise<string> {
  const requestId = nextTokenRequest++
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      tokenRequests.delete(requestId)
      reject(new CoreError('DEVELOPER_TOKEN_UNAVAILABLE', 'Developer token zaman aşımına uğradı.'))
    }, TOKEN_TIMEOUT_MS)
    tokenRequests.set(requestId, { resolve, reject, timer })
    send({ type: 'getDeveloperToken', requestId, ...(refresh ? { refresh } : {}) })
  })
}

// --- Renderer bağlantıları ---------------------------------------------------------------------
function attach(port: MessagePortMain): void {
  ports.add(port)
  port.on('message', (event: MessageEvent) => {
    if (!handleRequest) return
    void handleRequest(event.data).then((response) => {
      if (response) port.postMessage(response)
    })
  })
  port.on('close', () => ports.delete(port))
  port.start()
}

function init(dbPath: string, artworkDir: string): void {
  if (services) return
  dbPathForWipe = dbPath
  // A3.2: kapak indirme + disk önbelleği (DB'den bağımsız). Boyut kontrolü açılışı geciktirmesin.
  artwork ??= new ArtworkStore({ dir: artworkDir, ...APP_CONFIG.artworkCache, fetch })
  setTimeout(() => void artwork?.sweep(), 10_000).unref()
  try {
    const api = new AppleMusicApi({
      getDeveloperToken: requestDeveloperToken,
      getUserToken: () => userToken
    })
    // PLAN 2.3: bozuk/açılamayan DB silinip yeniden kurulur (DB bir önbellektir).
    const db = openDatabaseResilient(dbPath)
    // PLAN 3.A: dış kaynaklara tanımlayıcı User-Agent; key'ler yalnızca bu sürecin belleğinde.
    const background = new BackgroundService({
      db,
      userAgent: buildUserAgent(__APP_VERSION__),
      emit: broadcast
    })
    // V8: kütüphane öğelerinin ISRC'si katalog id'sinden çözülür (arka plan eşleştirmesi).
    const isrc = new IsrcResolver(db, api)
    services = createWorkerServices({
      db,
      api,
      emit: broadcast,
      background,
      isrc,
      isSafeMode: () => safeMode,
      isSignedIn: () => userToken !== null,
      onSettings: (settings) => {
        if (settings.tweaks.fastDns === fastDns && services) return
        fastDns = settings.tweaks.fastDns
        send({ type: 'fastDns', enabled: fastDns })
      }
    })
    handleRequest = createRpcHandler(services.handlers)
    send({ type: 'ready' })
  } catch (err) {
    const error = logError('worker', err, 'DB_OPEN_FAILED', 'Yerel veritabanı açılamadı.')
    send({ type: 'fatal', code: error.code, message: error.message })
  }
}

/**
 * Çıkış silmesi (2.7 O1). DB açıksa satırlar silinip dosya yeniden yazılır; DB hiç açılamadıysa
 * (fatal) dosyalar kapalıdır ve doğrudan silinir. Sonuç main'e onaylanır.
 */
function clearUserData(): boolean {
  try {
    if (services) services.clearUserData()
    else if (dbPathForWipe && dbPathForWipe !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) rmSync(dbPathForWipe + suffix, { force: true })
    }
    return true
  } catch (err) {
    logError('worker', err, 'INTERNAL', 'Çıkışta yerel veri silinemedi.')
    return false
  }
}

parentPort.on('message', (event: MessageEvent) => {
  const parsed = MainToWorkerSchema.safeParse(event.data)
  if (!parsed.success) {
    logError('worker', new CoreError('INVALID_PAYLOAD', 'geçersiz main mesajı yoksayıldı'))
    return
  }
  const msg = parsed.data
  switch (msg.type) {
    case 'init':
      init(msg.dbPath, msg.artworkDir)
      break
    case 'fetchArtwork': {
      const { requestId } = msg
      const store = artwork
      if (!store) send({ type: 'artworkFetched', requestId, result: 'failed' })
      else
        void store
          .fetch(msg.url)
          .catch(() => 'failed' as const)
          .then((result) => send({ type: 'artworkFetched', requestId, result }))
      break
    }
    case 'connect': {
      const port = event.ports[0]
      if (port) attach(port)
      break
    }
    case 'userToken':
      userToken = msg.token
      if (userToken !== null) services?.onSignedIn()
      break
    case 'clearUserData':
      send({ type: 'userDataCleared', ok: clearUserData() })
      break
    case 'safeMode':
      safeMode = msg.enabled
      break
    case 'savePlayerState': {
      let ok = false
      try {
        if (services) {
          void services.handlers.savePlayerState(msg.state)
          ok = true
        }
      } catch (err) {
        logError('worker', err, 'INTERNAL', 'Player durumu kaydedilemedi.')
      }
      send({ type: 'playerStateSaved', requestId: msg.requestId, ok })
      break
    }
    case 'developerToken': {
      const pending = tokenRequests.get(msg.requestId)
      if (!pending) break
      tokenRequests.delete(msg.requestId)
      clearTimeout(pending.timer)
      if (msg.result.ok) pending.resolve(msg.result.value.token)
      // Main'in katalog kodu (ör. TOKEN_ENV_MISSING) korunur: renderer doğru mesajı gösterir.
      else pending.reject(fromWireError(msg.result.error))
      break
    }
  }
})
