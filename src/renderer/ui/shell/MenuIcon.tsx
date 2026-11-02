import { motion } from 'motion/react'
import { MENU_ICON_LINES_Y, MENU_ICON_SPRING, menuIconLine } from './motion'

/**
 * Sol menü düğmesinin ikonu: kapalıyken üç çizgi, açıkken X; arada çizgiler yayla akar
 * (`menuIconLine`). Ölçü ve çizgi kalınlığı eski Lucide `Menu` ikonuyla aynı.
 */
export function MenuIcon({ open, size = 20 }: { open: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {MENU_ICON_LINES_Y.map((y, i) => (
        <motion.line
          key={y}
          x1={4}
          x2={20}
          y1={y}
          y2={y}
          initial={false}
          animate={menuIconLine(i as 0 | 1 | 2, open)}
          transition={
            i === 1
              ? { ...MENU_ICON_SPRING, opacity: { duration: open ? 0.1 : 0.18 } }
              : MENU_ICON_SPRING
          }
        />
      ))}
    </svg>
  )
}
