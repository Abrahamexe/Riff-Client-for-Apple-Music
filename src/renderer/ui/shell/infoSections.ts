import type { Credit, CreditRole, TrackBackground } from '@shared/background'
import type { MessageKey } from '@shared/i18n'

// Bilgi paneli (§3.5, geliştirici kararı 2026-10-14: sağ panelde "Bilgi" modu; sample'lar da olsun).
// Saf gruplama (testli): krediler Apple Music'teki "Krediler" görünümüne benzer gruplara ayrılır,
// kayıt bilgisi satırlara dönüşür. Ad ve ayrıntılar kaynaktaki metindir (düz metin olarak basılır).

export type CreditGroupKey = 'writers' | 'producers' | 'performers' | 'engineering' | 'other'

export interface CreditPerson {
  name: string
  /** Rol(ler) — i18n anahtarı; icracılarda enstrüman / vokal türü kaynaktaki metinle `detail`'de. */
  roles: MessageKey[]
  detail: string | null
}

const GROUP_OF: Readonly<Record<CreditRole, CreditGroupKey>> = {
  composer: 'writers',
  lyricist: 'writers',
  writer: 'writers',
  producer: 'producers',
  performer: 'performers',
  vocal: 'performers',
  instrument: 'performers',
  engineer: 'engineering',
  recording: 'engineering',
  mix: 'engineering',
  mastering: 'engineering',
  programming: 'engineering',
  arranger: 'other',
  remixer: 'other',
  design: 'other',
  other: 'other'
}

const ROLE_KEY: Readonly<Record<CreditRole, MessageKey>> = {
  composer: 'info.role.composer',
  lyricist: 'info.role.lyricist',
  writer: 'info.role.writer',
  producer: 'info.role.producer',
  performer: 'info.role.performer',
  vocal: 'info.role.vocal',
  instrument: 'info.role.instrument',
  engineer: 'info.role.engineer',
  recording: 'info.role.recording',
  mix: 'info.role.mix',
  mastering: 'info.role.mastering',
  programming: 'info.role.programming',
  arranger: 'info.role.arranger',
  remixer: 'info.role.remixer',
  design: 'info.role.design',
  other: 'info.role.other'
}

const CREDIT_GROUP_ORDER: readonly CreditGroupKey[] = [
  'writers',
  'producers',
  'performers',
  'engineering',
  'other'
]

/** Krediler gruplara; aynı kişi bir grupta bir kez (rolleri ve ayrıntıları birleşir). Boş gruplar yok. */
export function creditGroups(
  bg: TrackBackground
): { key: CreditGroupKey; people: CreditPerson[] }[] {
  const all: Credit[] = [
    ...bg.work.composers,
    ...bg.work.lyricists,
    ...bg.work.writers,
    ...bg.credits
  ]
  type Entry = CreditPerson & { details: string[] }
  const groups = new Map<CreditGroupKey, Map<string, Entry>>()
  for (const c of all) {
    const group = GROUP_OF[c.role]
    const people = groups.get(group) ?? new Map<string, Entry>()
    groups.set(group, people)
    const id = c.mbid ?? c.name.toLocaleLowerCase()
    const person: Entry = people.get(id) ?? { name: c.name, roles: [], detail: null, details: [] }
    people.set(id, person)
    const role = ROLE_KEY[c.role]
    if (!person.roles.includes(role)) person.roles.push(role)
    for (const a of c.attributes) if (!person.details.includes(a)) person.details.push(a)
  }
  return CREDIT_GROUP_ORDER.filter((k) => groups.has(k)).map((key) => ({
    key,
    people: [...groups.get(key)!.values()].map(({ details, ...p }) => ({
      ...p,
      detail: details.length > 0 ? details.join(', ') : null
    }))
  }))
}

/** Kayıt bilgisi satırları (yalnızca dolu olanlar). */
export function recordingRows(bg: TrackBackground): { label: MessageKey; value: string }[] {
  const rows: { label: MessageKey; value: string }[] = []
  const r = bg.recording
  if (r.releaseTitle) rows.push({ label: 'info.release', value: r.releaseTitle.value })
  if (r.releaseDate) rows.push({ label: 'info.releaseDate', value: r.releaseDate.value })
  if (r.recordedDate) rows.push({ label: 'info.recordedDate', value: r.recordedDate.value })
  const studios = [...new Set(r.studios.map((s) => s.name))]
  if (studios.length > 0) rows.push({ label: 'info.studio', value: studios.join(', ') })
  const labels = [...new Set(r.labels.map((l) => l.name))]
  if (labels.length > 0) rows.push({ label: 'info.label', value: labels.join(', ') })
  return rows
}

/** Panelde gösterilecek bir şey var mı (eşleşme yoksa ya da tüm bölümler boşsa "bulunamadı"). */
export function hasAnyInfo(bg: TrackBackground): boolean {
  return (
    bg.artistSummary !== null ||
    creditGroups(bg).length > 0 ||
    recordingRows(bg).length > 0 ||
    bg.samples.samples.length > 0 ||
    bg.samples.sampledBy.length > 0
  )
}
