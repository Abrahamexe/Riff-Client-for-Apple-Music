import { createContext, useContext } from 'react'

// Sağ panelin açılış animasyonu bitti mi (2026-11-02). Ölçüm: Sıradaki açılırken sürüklenebilir satırlar
// (`Reorder`) ve yerleşim animasyonlu satırlar kurulurken Motion her birini ölçüyordu
// (`getBoundingClientRect` ~140 ms + `measureScroll` ~60 ms; 49–94 ms'lik kareler) ve bu panel büyürken
// oluyordu. Ağır listeler panel yerine oturduktan sonra kurulur: ölçüm hiçbir şey hareket etmezken olur.

/** Panel dışında (varsayılan) beklenecek bir animasyon yok: içerik hemen kurulur. */
export const PANEL_SETTLED_DEFAULT = true

export const PanelSettledContext = createContext(PANEL_SETTLED_DEFAULT)

export function usePanelSettled(): boolean {
  return useContext(PanelSettledContext)
}
