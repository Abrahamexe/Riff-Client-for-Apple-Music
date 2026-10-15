import { describe, expect, it, vi } from 'vitest'
import { FAST_DNS } from '@shared/app-config'
import {
  DOH_PROBE_QUERY,
  SYSTEM_DNS,
  createDohProbe,
  createFastDns,
  fastDnsConfig,
  type HostResolverConfig
} from './fastDns'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(probeResults: boolean[]) {
  const configs: HostResolverConfig[] = []
  let t = 0
  const probe = vi.fn(() => Promise.resolve(probeResults.shift() ?? true))
  const dns = createFastDns({
    configure: (c) => configs.push(c),
    probe,
    now: () => t,
    minRecheckMs: 1000
  })
  return { dns, configs, probe, advance: (ms: number) => (t += ms) }
}

describe('fastDnsConfig', () => {
  it('açık + erişilebilir → secure; erişilemez → automatic; kapalı → sistem', () => {
    expect(fastDnsConfig(true, true)).toEqual({
      enableBuiltInResolver: true,
      secureDnsMode: 'secure',
      secureDnsServers: [...FAST_DNS.dohTemplates]
    })
    expect(fastDnsConfig(true, false).secureDnsMode).toBe('automatic')
    expect(fastDnsConfig(false, true)).toEqual(SYSTEM_DNS)
  })

  it("DoH şablonları IP'li https (DoH sunucusu yavaş sistem DNS'iyle çözülmesin)", () => {
    for (const t of FAST_DNS.dohTemplates)
      expect(t).toMatch(/^https:\/\/\d+\.\d+\.\d+\.\d+\/dns-query$/)
  })
})

describe('createFastDns', () => {
  it('açılışta hemen secure kurar, yoklama başarısızsa automatic’e iner', async () => {
    const { configs } = setup([false])
    expect(configs.map((c) => c.secureDnsMode)).toEqual(['secure'])
    await flush()
    expect(configs.map((c) => c.secureDnsMode)).toEqual(['secure', 'automatic'])
  })

  it('aynı yapılandırma tekrar uygulanmaz', async () => {
    const { configs } = setup([true])
    await flush()
    expect(configs).toHaveLength(1)
  })

  it('kapatılınca sistem DNS’i, yeniden açılınca yoklayıp secure', async () => {
    const { dns, configs, probe } = setup([true, true])
    await flush()
    dns.setEnabled(false)
    expect(configs.at(-1)).toEqual(SYSTEM_DNS)
    dns.setEnabled(false)
    expect(configs).toHaveLength(2)
    dns.setEnabled(true)
    await flush()
    expect(configs.at(-1)?.secureDnsMode).toBe('secure')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('kapalıyken yoklama yapılmaz', async () => {
    const { dns, probe } = setup([true])
    await flush()
    dns.setEnabled(false)
    await dns.recheck(true)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('odak yoklaması sıklık sınırlı, uyanma zorla yoklar; ağ düzelince secure’e döner', async () => {
    const { dns, configs, probe, advance } = setup([false, true, true])
    await flush()
    await dns.recheck()
    expect(probe).toHaveBeenCalledTimes(1)
    advance(1000)
    await dns.recheck()
    expect(probe).toHaveBeenCalledTimes(2)
    expect(configs.at(-1)?.secureDnsMode).toBe('secure')
    await dns.recheck(true)
    expect(probe).toHaveBeenCalledTimes(3)
    expect(dns.current().secureDnsMode).toBe('secure')
  })
})

describe('createDohProbe', () => {
  it('ilk sunucu yanıt verirse true; RFC 8484 GET, dns-message', async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: true }))
    expect(await createDohProbe(fetchFn)()).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { headers: object }]
    expect(url).toBe(`${FAST_DNS.dohTemplates[0]}?dns=${DOH_PROBE_QUERY}`)
    expect(init.headers).toEqual({ accept: 'application/dns-message' })
  })

  it('ilki düşerse ikincisi denenir; hepsi düşerse false (fırlatmaz)', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ağ'))
      .mockResolvedValueOnce({ ok: true })
    expect(await createDohProbe(fetchFn)()).toBe(true)
    const failing = vi.fn(() => Promise.resolve({ ok: false }))
    expect(await createDohProbe(failing)()).toBe(false)
    expect(failing).toHaveBeenCalledTimes(FAST_DNS.dohTemplates.length)
  })

  it('yoklama sorgusu apple.com A kaydı (base64url, dolgusuz)', () => {
    const q = Buffer.from(DOH_PROBE_QUERY, 'base64url')
    expect(q.readUInt16BE(4)).toBe(1) // QDCOUNT
    expect(q.subarray(12, 23).toString('latin1')).toBe('\x05apple\x03com\x00')
    expect(q.readUInt16BE(23)).toBe(1) // A
  })
})
