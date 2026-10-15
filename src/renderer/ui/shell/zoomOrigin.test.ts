import { describe, expect, it } from 'vitest'
import {
  anchoredZoomTransform,
  closestBox,
  HEADER_ART,
  ORIGIN_TTL_MS,
  setZoomOrigin,
  takeZoomOrigin,
  zoomTransform
} from './zoomOrigin'

const el = (x: number, y: number, w: number, h: number) =>
  ({
    getBoundingClientRect: () => ({ left: x, top: y, width: w, height: h })
  }) as unknown as Element

describe('karttan büyüyen sayfa', () => {
  it('kart kutusu bir kez alınır; eskiyse ya da boyutsuzsa yok', () => {
    setZoomOrigin(el(300, 200, 176, 176), 1_000)
    expect(takeZoomOrigin(1_100)).toEqual({ x: 300, y: 200, width: 176, height: 176 })
    expect(takeZoomOrigin(1_100)).toBeNull()
    setZoomOrigin(el(1, 1, 10, 10), 0)
    expect(takeZoomOrigin(ORIGIN_TTL_MS + 1)).toBeNull()
    setZoomOrigin(el(1, 1, 0, 0), 0)
    expect(takeZoomOrigin(1)).toBeNull()
  })

  it('sayfanın sol üstü kartın sol üstüne, genişliği kartınkine oturur', () => {
    const t = zoomTransform(
      { x: 300, y: 200, width: 176, height: 176 },
      { x: 76, y: 68, width: 1100, height: 800 }
    )
    expect(t).toEqual({ x: 224, y: 132, scale: 0.16 })
    expect(
      zoomTransform({ x: 0, y: 0, width: 5000, height: 1 }, { x: 0, y: 0, width: 100, height: 1 })
        .scale
    ).toBe(1)
  })
})

describe('başlık kapağına hizalı büyüme', () => {
  it('başlık kapağı tam kartın yerine ve boyutuna oturur', () => {
    const card = { x: 340, y: 167, width: 248, height: 248 }
    const page = { x: 72, y: 68 }
    const t = anchoredZoomTransform(card, page)
    // Sayfa sol üstten ölçeklenir: kapağın ekrandaki yeri = sayfa + kaydırma + ölçek × kapak konumu.
    expect(page.x + t.x + t.scale * HEADER_ART.x).toBeCloseTo(card.x)
    expect(page.y + t.y + t.scale * HEADER_ART.y).toBeCloseTo(card.y)
    expect(t.scale * HEADER_ART.size).toBeCloseTo(card.width)
  })
})

describe('geri dönüşte karta uçuş', () => {
  const target = { x: 300, y: 200, width: 176, height: 176 }
  it('kutusu kart kutusuna en yakın kapağı seçer', () => {
    expect(
      closestBox(target, [
        { item: 'uzak', box: { x: 600, y: 200, width: 176, height: 176 } },
        { item: 'yakın', box: { x: 304, y: 210, width: 176, height: 176 } },
        { item: 'tam', box: { x: 300, y: 200, width: 176, height: 176 } }
      ])
    ).toBe('tam')
  })
  it('boyutu ya da yeri çok farklıysa yok', () => {
    expect(
      closestBox(target, [{ item: 'küçük', box: { x: 300, y: 200, width: 60, height: 60 } }])
    ).toBeNull()
    expect(
      closestBox(target, [{ item: 'kaymış', box: { x: 300, y: 300, width: 176, height: 176 } }])
    ).toBeNull()
  })
})
