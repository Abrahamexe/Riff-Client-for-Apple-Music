import { describe, expect, it } from 'vitest'
import { PANEL_SETTLED_DEFAULT } from './panelSettled'
import { isExitDefinition, rightPanelMotion } from './motion'

describe('panelSettled', () => {
  it('panel dışında içerik beklemeden kurulur (varsayılan: oturmuş)', () => {
    expect(PANEL_SETTLED_DEFAULT).toBe(true)
  })

  it('açılışın sonu ile kapanışın sonu ayırt edilir (ana ekran genişliği yalnızca açılışta)', () => {
    expect(isExitDefinition(rightPanelMotion.exit)).toBe(true)
    expect(isExitDefinition({ ...rightPanelMotion.exit })).toBe(true)
    expect(isExitDefinition(rightPanelMotion.animate)).toBe(false)
    expect(isExitDefinition('animate')).toBe(false)
    expect(isExitDefinition(null)).toBe(false)
  })
})
