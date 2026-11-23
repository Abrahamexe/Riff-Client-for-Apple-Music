import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEdgeMoving, onEdgeSettled, setEdgeMoving } from './edgeMotion'

describe('edgeMotion', () => {
  afterEach(() => setEdgeMoving(false))

  it('hareket bitince bekleyenler bir kez çağrılır', () => {
    const settled = vi.fn()
    const off = onEdgeSettled(settled)
    setEdgeMoving(true)
    expect(isEdgeMoving()).toBe(true)
    expect(settled).not.toHaveBeenCalled()
    setEdgeMoving(false)
    setEdgeMoving(false)
    expect(isEdgeMoving()).toBe(false)
    expect(settled).toHaveBeenCalledTimes(1)
    off()
    setEdgeMoving(true)
    setEdgeMoving(false)
    expect(settled).toHaveBeenCalledTimes(1)
  })
})
