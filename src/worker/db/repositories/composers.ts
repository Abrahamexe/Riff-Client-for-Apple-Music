// §3.6 Besteciler (geliştirici kararı 2026-10-14: "kişi kişi ayır"). Apple'ın besteci alanı tek dize:
// "Ye, 88-Keys, Sheffmade, Quadwoofer, Assi Rahbbani & Mansour El Rahbani" → altı ayrı besteci.
// Ayırıcılar: virgül, "&", "/", ";" ve iki yanı boşluklu "and" / "ve". Aynı ad (büyük/küçük harf
// farkı) bir kez.

export function splitComposers(value: string | null | undefined): string[] {
  if (!value) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value.split(/\s*(?:[,&/;]|\s(?:and|ve)\s)\s*/i)) {
    const name = raw.replace(/\s+/g, ' ').trim()
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** Bestecilerin şarkı sayıları; ada göre (yerel) sıralı. */
export function countComposers(
  values: readonly (string | null)[]
): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>()
  for (const v of values) {
    for (const name of splitComposers(v)) {
      const key = name.toLocaleLowerCase()
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { name, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}
