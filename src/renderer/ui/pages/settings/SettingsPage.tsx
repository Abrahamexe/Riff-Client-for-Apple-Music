import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Trash2 } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import {
  BUILTIN_EQ_PRESETS,
  EQ_BANDS_HZ,
  EQ_MAX_DB,
  TWEAK_LIMITS,
  defaultSettings,
  type Settings,
  type SettingsPatch,
  type ThemeMode
} from '@shared/settings'
import { i18n } from '@core/i18n'
import { useApp, useSettings } from '../../context'
import { Picker } from '../../components/Picker'
import { EASE_OUT } from '../../shell/motion'
import { SHORTCUTS } from '../../shell/shortcuts'
import { ABOUT_SOURCES as SOURCES, CC_BY_SA_URL } from './aboutSources'
import {
  bandLabel,
  choosePreset,
  deleteCustomPreset,
  saveCustomPreset,
  setBand,
  setPreamp
} from './eq'

// Ayarlar (B9; geliştirici kararı: ana ekranda sayfa + üstte sekmeler). İçerik Apple Music
// (Windows) uygulama ayarlarının MusicKit JS'in desteklediği kadarı + kendi EQ'muz + görünüm;
// eşleme ve desteklenmeyenler docs/SETTINGS.md. Her değişiklik anında kaydedilir ve uygulanır.

const TABS = [
  'general',
  'playback',
  'restrictions',
  'equalizer',
  'appearance',
  'advanced',
  'tweaks',
  'about'
] as const
type Tab = (typeof TABS)[number]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')
  const settings = useSettings() ?? defaultSettings()
  return (
    <>
      <h1 className="page__title">{i18n.t('settings.title')}</h1>
      <div
        className="segmented glass glass--capsule settings-tabs"
        role="tablist"
        aria-label={i18n.t('settings.tabs')}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className={`segmented__item${t === tab ? ' segmented__item--on' : ''}`}
            onClick={() => setTab(t)}
          >
            {i18n.format(`settings.tab.${t}` as MessageKey)}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          role="tabpanel"
          className="settings-panel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <TabContent tab={tab} settings={settings} />
        </motion.div>
      </AnimatePresence>
    </>
  )
}

function useUpdate(): (patch: SettingsPatch | null) => void {
  const app = useApp()
  return (patch) => {
    if (patch) void app.settings.update(patch).catch(() => {})
  }
}

function TabContent({ tab, settings }: { tab: Tab; settings: Settings }) {
  const update = useUpdate()
  switch (tab) {
    case 'general':
      return (
        <>
          <Card>
            <Row
              label="settings.general.listeningHistory"
              hint="settings.general.listeningHistoryHint"
            >
              <Switch
                on={settings.general.useListeningHistory}
                label="settings.general.listeningHistory"
                onChange={(v) => update({ general: { useListeningHistory: v } })}
              />
            </Row>
          </Card>
          <ShortcutsCard />
        </>
      )
    case 'playback':
      return (
        <Card>
          <Row label="settings.playback.quality" hint="settings.playback.qualityHint">
            <Segmented
              label="settings.playback.quality"
              value={settings.playback.streamingQuality}
              options={[
                ['high', 'settings.playback.qualityHigh'],
                ['standard', 'settings.playback.qualityStandard']
              ]}
              onChange={(v) => update({ playback: { streamingQuality: v } })}
            />
          </Row>
          <Row label="settings.playback.autoplay" hint="settings.playback.autoplayHint">
            <Switch
              on={settings.playback.autoplay}
              label="settings.playback.autoplay"
              onChange={(v) => update({ playback: { autoplay: v } })}
            />
          </Row>
        </Card>
      )
    case 'restrictions':
      return (
        <Card>
          <Row label="settings.restrictions.explicit" hint="settings.restrictions.explicitHint">
            <Switch
              on={settings.restrictions.allowExplicit}
              label="settings.restrictions.explicit"
              onChange={(v) => update({ restrictions: { allowExplicit: v } })}
            />
          </Row>
        </Card>
      )
    case 'equalizer':
      return <EqualizerTab settings={settings} />
    case 'appearance':
      return (
        <Card>
          <Row label="settings.appearance.theme">
            <Segmented<ThemeMode>
              label="settings.appearance.theme"
              value={settings.appearance.theme}
              options={[
                ['system', 'settings.appearance.themeSystem'],
                ['light', 'settings.appearance.themeLight'],
                ['dark', 'settings.appearance.themeDark']
              ]}
              onChange={(v) => update({ appearance: { theme: v } })}
            />
          </Row>
          <Row label="settings.appearance.transparency" hint="settings.appearance.transparencyHint">
            <ThrottledSlider
              className="settings-slider"
              label={i18n.t('settings.appearance.transparency')}
              min={0}
              max={100}
              step={1}
              value={settings.appearance.transparency}
              onCommit={(v) => update({ appearance: { transparency: Math.round(v) } })}
            />
          </Row>
        </Card>
      )
    case 'advanced':
      return <AdvancedTab settings={settings} />
    case 'tweaks':
      return <TweaksTab settings={settings} />
    case 'about':
      return <AboutTab />
  }
}

/**
 * İnce Ayar (geliştirici isteği 2026-10-14: "uygulama meraklısı için ince ayar"). Her satır bir
 * davranışa bağlı (shared/settings.ts TweaksSchema, docs/SETTINGS.md).
 */
function TweaksTab({ settings }: { settings: Settings }) {
  const update = useUpdate()
  const t = settings.tweaks
  const set = (patch: Partial<Settings['tweaks']>): void => update({ tweaks: patch })
  const slider = (
    key: 'pulseStrength' | 'lyricsOffsetMs' | 'volumeStep' | 'seekStep' | 'librarySyncMinutes',
    label: MessageKey,
    step: number,
    unit: 'tweaks.unit.ms' | 'tweaks.unit.percent' | 'tweaks.unit.seconds' | 'tweaks.unit.minutes'
  ) => (
    <div className="tweak-slider">
      <ThrottledSlider
        className="settings-slider"
        label={i18n.format(label)}
        min={TWEAK_LIMITS[key][0]}
        max={TWEAK_LIMITS[key][1]}
        step={step}
        value={t[key]}
        onCommit={(v) => set({ [key]: Math.round(v) })}
      />
      <span className="tweak-slider__value">
        {i18n.t(unit, { value: key === 'lyricsOffsetMs' && t[key] > 0 ? `+${t[key]}` : t[key] })}
      </span>
    </div>
  )
  return (
    <>
      <p className="settings-row__hint tweaks__intro">{i18n.t('tweaks.intro')}</p>
      <Card>
        <h3 className="settings-card__title">{i18n.t('tweaks.section.motion')}</h3>
        <Row label="tweaks.motion" hint="tweaks.motionHint">
          <Segmented
            label="tweaks.motion"
            value={t.motion}
            options={[
              ['system', 'tweaks.motion.system'],
              ['reduced', 'tweaks.motion.reduced'],
              ['full', 'tweaks.motion.full']
            ]}
            onChange={(v) => set({ motion: v })}
          />
        </Row>
        <Row label="tweaks.glassBlur" hint="tweaks.glassBlurHint">
          <Switch
            on={t.glassBlur}
            label="tweaks.glassBlur"
            onChange={(v) => set({ glassBlur: v })}
          />
        </Row>
        <Row label="tweaks.pulse" hint="tweaks.pulseHint">
          {slider('pulseStrength', 'tweaks.pulse', 10, 'tweaks.unit.percent')}
        </Row>
      </Card>
      <Card>
        <h3 className="settings-card__title">{i18n.t('tweaks.section.lyrics')}</h3>
        <Row label="tweaks.lyricsOffset" hint="tweaks.lyricsOffsetHint">
          {slider('lyricsOffsetMs', 'tweaks.lyricsOffset', 100, 'tweaks.unit.ms')}
        </Row>
        <Row label="tweaks.lyricsSize">
          <Segmented
            label="tweaks.lyricsSize"
            value={t.lyricsSize}
            options={[
              ['small', 'tweaks.lyricsSize.small'],
              ['medium', 'tweaks.lyricsSize.medium'],
              ['large', 'tweaks.lyricsSize.large']
            ]}
            onChange={(v) => set({ lyricsSize: v })}
          />
        </Row>
      </Card>
      <Card>
        <h3 className="settings-card__title">{i18n.t('tweaks.section.controls')}</h3>
        <Row label="tweaks.volumeStep" hint="tweaks.volumeStepHint">
          {slider('volumeStep', 'tweaks.volumeStep', 1, 'tweaks.unit.percent')}
        </Row>
        <Row label="tweaks.seekStep" hint="tweaks.seekStepHint">
          {slider('seekStep', 'tweaks.seekStep', 1, 'tweaks.unit.seconds')}
        </Row>
        <Row label="tweaks.wheelVolume" hint="tweaks.wheelVolumeHint">
          <Switch
            on={t.wheelVolume}
            label="tweaks.wheelVolume"
            onChange={(v) => set({ wheelVolume: v })}
          />
        </Row>
      </Card>
      <Card>
        <h3 className="settings-card__title">{i18n.t('tweaks.section.system')}</h3>
        <Row label="tweaks.warmup" hint="tweaks.warmupHint">
          <Switch
            on={t.playbackWarmup}
            label="tweaks.warmup"
            onChange={(v) => set({ playbackWarmup: v })}
          />
        </Row>
        <Row label="tweaks.fastDns" hint="tweaks.fastDnsHint">
          <Switch on={t.fastDns} label="tweaks.fastDns" onChange={(v) => set({ fastDns: v })} />
        </Row>
        <Row label="tweaks.syncMinutes" hint="tweaks.syncMinutesHint">
          {slider('librarySyncMinutes', 'tweaks.syncMinutes', 1, 'tweaks.unit.minutes')}
        </Row>
        <Row label="tweaks.fpsMeter" hint="tweaks.fpsMeterHint">
          <Switch on={t.fpsMeter} label="tweaks.fpsMeter" onChange={(v) => set({ fpsMeter: v })} />
        </Row>
      </Card>
      <div className="tweaks__reset">
        <button
          type="button"
          className="pill-button"
          onClick={() => update({ tweaks: defaultSettings().tweaks })}
        >
          {i18n.t('tweaks.reset')}
        </button>
      </div>
    </>
  )
}

/** Hakkında (§3.5, geliştirici kararı: Ayarlar'da son sekme). Bağlantılar yalnızca izinli kaynaklara. */
function AboutTab() {
  const app = useApp()
  const open = (url: string) => (): void => void app.openSourceLink(url).catch(() => {})
  return (
    <>
      <Card>
        <div className="about__head">
          <span className="about__name">{app.appInfo.name}</span>
          <span className="settings-row__hint">
            {i18n.t('about.version', { version: app.appInfo.build })}
          </span>
          <span className="settings-row__hint">{i18n.t('about.notApple')}</span>
        </div>
      </Card>
      <Card>
        <h3 className="settings-card__title">{i18n.t('about.sources')}</h3>
        {SOURCES.map((s) => (
          <div key={s.name} className="settings-row">
            <div className="settings-row__text">
              {s.url ? (
                <button type="button" className="info__link about__link" onClick={open(s.url)}>
                  {s.name}
                </button>
              ) : (
                <span className="settings-row__label">{s.name}</span>
              )}
              <span className="settings-row__hint">{i18n.format(s.what)}</span>
            </div>
            {s.license && (
              <div className="settings-row__control">
                {s.license === 'CC BY-SA 4.0' ? (
                  <button type="button" className="info__link" onClick={open(CC_BY_SA_URL)}>
                    {s.license}
                  </button>
                ) : (
                  <span className="settings-row__hint">{s.license}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
      <Card>
        <h3 className="settings-card__title">{i18n.t('about.privacy')}</h3>
        <ul className="about__list">
          <li>{i18n.t('about.privacy.account')}</li>
          <li>{i18n.t('about.privacy.sources')}</li>
          <li>{i18n.t('about.privacy.noTracking')}</li>
        </ul>
      </Card>
      <Card>
        <h3 className="settings-card__title">{i18n.t('about.openSource')}</h3>
        <p className="settings-row__hint about__text">{i18n.t('about.openSourceText')}</p>
      </Card>
    </>
  )
}

function AdvancedTab({ settings }: { settings: Settings }) {
  const app = useApp()
  const update = useUpdate()
  return (
    <Card>
      <Row label="settings.advanced.addOnPlaylist">
        <Switch
          on={settings.advanced.addSongsToLibraryOnPlaylistAdd}
          label="settings.advanced.addOnPlaylist"
          onChange={(v) => update({ advanced: { addSongsToLibraryOnPlaylistAdd: v } })}
        />
      </Row>
      <Row label="settings.advanced.addOnFavorite">
        <Switch
          on={settings.advanced.addSongsToLibraryOnFavorite}
          label="settings.advanced.addOnFavorite"
          onChange={(v) => update({ advanced: { addSongsToLibraryOnFavorite: v } })}
        />
      </Row>
      <Row label="settings.advanced.miniOnTop">
        <Switch
          on={settings.advanced.keepMiniPlayerOnTop}
          label="settings.advanced.miniOnTop"
          onChange={(v) => update({ advanced: { keepMiniPlayerOnTop: v } })}
        />
      </Row>
      <Row label="settings.advanced.resetWarnings" hint="settings.advanced.resetWarningsHint">
        <ActionButton
          disabled={settings.advanced.dismissedWarnings.length === 0}
          run={() => app.settings.update({ advanced: { dismissedWarnings: [] } })}
        />
      </Row>
      <Row label="settings.advanced.resetCaches" hint="settings.advanced.resetCachesHint">
        <ActionButton run={() => app.resetCaches()} />
      </Row>
    </Card>
  )
}

/** "Sıfırla" düğmesi: bitince kısa süre "Sıfırlandı" / "Yapılamadı" gösterir. */
function ActionButton({ run, disabled }: { run: () => Promise<unknown>; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  useEffect(() => {
    if (state !== 'done' && state !== 'failed') return
    const t = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(t)
  }, [state])
  const label: MessageKey =
    state === 'done'
      ? 'settings.advanced.done'
      : state === 'failed'
        ? 'settings.advanced.failed'
        : 'settings.advanced.reset'
  return (
    <button
      type="button"
      className="pill-button"
      disabled={disabled === true || state === 'busy'}
      onClick={() => {
        setState('busy')
        run().then(
          () => setState('done'),
          () => setState('failed')
        )
      }}
    >
      {i18n.t(label)}
    </button>
  )
}

function EqualizerTab({ settings }: { settings: Settings }) {
  const update = useUpdate()
  const eq = settings.equalizer
  const [name, setName] = useState('')
  const custom = eq.customPresets.find((p) => p.id === eq.presetId)
  const options = [
    ...(eq.presetId === null ? [{ id: '', label: i18n.t('settings.eq.custom') }] : []),
    ...BUILTIN_EQ_PRESETS.map((p) => ({ id: p.id, label: i18n.format(p.nameKey) })),
    ...eq.customPresets.map((p) => ({ id: p.id, label: p.name }))
  ]
  const save = (): void => {
    const patch = saveCustomPreset(eq, name)
    if (patch) {
      update(patch)
      setName('')
    }
  }
  return (
    <>
      <Card>
        <Row label="settings.eq.enabled" hint="settings.eq.enabledHint">
          <Switch
            on={eq.enabled}
            label="settings.eq.enabled"
            onChange={(v) => update({ equalizer: { enabled: v } })}
          />
        </Row>
        <Row label="settings.eq.preset">
          <div className="settings-inline">
            <Picker
              label={i18n.t('settings.eq.preset')}
              value={eq.presetId ?? ''}
              options={options}
              onChange={(id) => update(choosePreset(eq, id))}
            />
            {custom && (
              <button
                type="button"
                className="icon-pill"
                aria-label={i18n.t('settings.eq.delete')}
                title={i18n.t('settings.eq.delete')}
                onClick={() => update(deleteCustomPreset(eq, custom.id))}
              >
                <Trash2 size={16} strokeWidth={1.9} aria-hidden="true" />
              </button>
            )}
          </div>
        </Row>
      </Card>
      <Card className={eq.enabled ? '' : 'settings-card--muted'}>
        <div className="eq">
          <EqSlider
            label={i18n.t('settings.eq.preamp')}
            caption={i18n.t('settings.eq.preamp')}
            value={eq.preamp}
            onCommit={(v) => update(setPreamp(v))}
            preamp
          />
          {EQ_BANDS_HZ.map((hz, i) => (
            <EqSlider
              key={hz}
              label={i18n.t('settings.eq.band', { hz: bandLabel(hz) })}
              caption={bandLabel(hz)}
              value={eq.bands[i] ?? 0}
              onCommit={(v) => update(setBand(eq, i, v))}
            />
          ))}
        </div>
        <div className="settings-inline settings-inline--end">
          <input
            className="settings-input"
            value={name}
            maxLength={60}
            placeholder={i18n.t('settings.eq.namePlaceholder')}
            aria-label={i18n.t('settings.eq.saveAs')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
          <button type="button" className="pill-button" disabled={!name.trim()} onClick={save}>
            {i18n.t('settings.eq.save')}
          </button>
        </div>
      </Card>
    </>
  )
}

function EqSlider({
  label,
  caption,
  value,
  onCommit,
  preamp
}: {
  label: string
  caption: string
  value: number
  onCommit: (v: number) => void
  preamp?: boolean
}) {
  return (
    <div className={`eq__band${preamp ? ' eq__band--preamp' : ''}`}>
      <span className="eq__value">{formatDb(value)}</span>
      <ThrottledSlider
        className="eq__slider"
        label={label}
        min={-EQ_MAX_DB}
        max={EQ_MAX_DB}
        step={0.5}
        value={value}
        onCommit={onCommit}
        vertical
      />
      <span className="eq__caption">{caption}</span>
    </div>
  )
}

const formatDb = (v: number): string => `${v > 0 ? '+' : ''}${v}`

/**
 * Sürüklerken yerel değer anında çizilir; kayıt (IPC + disk) en fazla 100 ms'de bir ve bırakınca
 * son değerle yapılır (her piksel için ayar yazılmaz).
 */
function ThrottledSlider({
  label,
  min,
  max,
  step,
  value,
  onCommit,
  className,
  vertical
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onCommit: (v: number) => void
  className?: string
  vertical?: boolean
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(value)
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const shown = draft ?? value
  const flush = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    commit.current(latest.current)
  }
  const ratio = (shown - min) / (max - min)
  return (
    <input
      className={`slider ${className ?? ''}`}
      type="range"
      min={min}
      max={max}
      step={step}
      value={shown}
      aria-label={label}
      {...(vertical ? { 'aria-orientation': 'vertical' as const } : {})}
      style={{ '--p': `${ratio * 100}%` } as CSSProperties}
      onChange={(e) => {
        const v = Number(e.target.value)
        latest.current = v
        setDraft(v)
        timer.current ??= setTimeout(flush, 100)
      }}
      onPointerUp={() => {
        flush()
        setDraft(null)
      }}
      onKeyUp={() => {
        flush()
        setDraft(null)
      }}
    />
  )
}

/** §3.3: salt okunur klavye kısayolları listesi (değiştirme yok, geliştirici kararı). */
function ShortcutsCard() {
  return (
    <Card>
      <h3 className="settings-card__title">{i18n.t('shortcuts.title')}</h3>
      {SHORTCUTS.map((s) => (
        <Row key={s.action} label={s.label}>
          <span className="kbd-combo">
            {s.keys.map((k) => {
              const text = typeof k === 'string' ? k : i18n.format(k.text)
              return (
                <kbd key={text} className="kbd">
                  {text}
                </kbd>
              )
            })}
          </span>
        </Row>
      ))}
    </Card>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={`glass settings-card ${className ?? ''}`}>{children}</section>
}

function Row({
  label,
  hint,
  children
}: {
  label: MessageKey
  hint?: MessageKey
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <span className="settings-row__label">{i18n.format(label)}</span>
        {hint && <span className="settings-row__hint">{i18n.format(hint)}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

function Switch({
  on,
  label,
  onChange
}: {
  on: boolean
  label: MessageKey
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={i18n.format(label)}
      className={`switch${on ? ' switch--on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <motion.span
        className="switch__knob"
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
      />
    </button>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: MessageKey
  value: T
  options: [T, MessageKey][]
  onChange: (v: T) => void
}) {
  return (
    <div
      className="segmented glass glass--capsule"
      role="radiogroup"
      aria-label={i18n.format(label)}
    >
      {options.map(([v, key]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={`segmented__item${v === value ? ' segmented__item--on' : ''}`}
          onClick={() => onChange(v)}
        >
          {i18n.format(key)}
        </button>
      ))}
    </div>
  )
}
