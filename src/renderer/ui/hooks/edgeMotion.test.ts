import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  edgeMotionFrame,
  endEdgeMotion,
  isEdgeMoving,
  onEdgeMotion,
  onEdgeSettled,
  startEdgeMotion
} from './edgeMotion'

describe('edgeMotion', () => {
  afterEach(() => endEdgeMotion())

  it('başlangıç, kareler ve bitiş sırayla bildirilir; bitiş bir kez', () => {
    const start = vi.fn()
    const frame = vi.fn()
    const settled = vi.fn()
    const off = onEdgeMotion({ start, frame, settled })
    startEdgeMotion(-272)
    expect(isEdgeMoving()).toBe(true)
    expect(start).toHaveBeenCalledWith(-272)
    edgeMotionFrame(0.5)
    expect(frame).toHaveBeenCalledWith(0.5)
    endEdgeMotion()
    endEdgeMotion()
    expect(isEdgeMoving()).toBe(false)
    expect(settled).toHaveBeenCalledTimes(1)
    edgeMotionFrame(0.9)
    expect(frame).toHaveBeenCalledTimes(1)
    off()
  })

  it('abonelik kalkınca çağrılmaz', () => {
    const settled = vi.fn()
    const off = onEdgeSettled(settled)
    off()
    startEdgeMotion(10)
    endEdgeMotion()
    expect(settled).not.toHaveBeenCalled()
  })
})
