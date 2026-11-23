// Sol menünün açılıp kapanan bölümleri (geliştirici isteği 2026-10-14: "Çalma Listeleri"nin yanındaki
// oka basınca bölüm açılır / kapanır, menü de küçülür). Durum yalnızca bu bilgisayarda, bu pencere
// için bir kolaylıktır: localStorage'da tutulur; okunamazsa (gizli mod, silinmiş veri) hepsi açık.

export const SIDEBAR_SECTIONS = ['library', 'playlists'] as const
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number]

const KEY = 'am-client.sidebar.collapsed'

/** Kayıtlı değerden kapalı bölümler; bozuk / bilinmeyen değerler yok sayılır. */
export function parseCollapsed(raw: string | null): Set<SidebarSection> {
  const out = new Set<SidebarSection>()
  if (!raw) return out
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return out
    for (const v of value) {
      if ((SIDEBAR_SECTIONS as readonly unknown[]).includes(v)) out.add(v as SidebarSection)
    }
  } catch {
    // bozuk kayıt: hepsi açık
  }
  return out
}

export function loadCollapsed(storage: Pick<Storage, 'getItem'> | null = safeStorage()) {
  try {
    return parseCollapsed(storage?.getItem(KEY) ?? null)
  } catch {
    return new Set<SidebarSection>()
  }
}

export function saveCollapsed(
  collapsed: ReadonlySet<SidebarSection>,
  storage: Pick<Storage, 'setItem'> | null = safeStorage()
): void {
  try {
    storage?.setItem(KEY, JSON.stringify([...collapsed]))
  } catch {
    // yazılamazsa yalnızca bu oturumda geçerli kalır
  }
}

// Sol panelin açık / kapalı durumu (2026-11-23, geliştirici: "sağ paneller gibi olsun"): sağ panel gibi
// hatırlanır. Kilit kalktı: panel açıkken ana ekranı iter, sayfaya gidince kapanmaz. Varsayılan kapalı
// (geliştirici isteği 2026-10-15: uygulama menü kapalı açılır).
const OPEN_KEY = 'am-client.sidebar.open'

export function loadSidebarOpen(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

export function saveSidebarOpen(
  open: boolean,
  storage: Pick<Storage, 'setItem'> | null = safeStorage()
): void {
  try {
    storage?.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // yazılamazsa yalnızca bu oturumda geçerli kalır
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
