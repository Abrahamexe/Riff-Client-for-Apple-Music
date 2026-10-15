import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Minus, Copy, Square, X } from 'lucide-react'
import type { WindowAction } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useWindowState } from '../context'

// Kendi pencere düğmelerimiz (B3, geliştirici: "bize özel, göze güzel"): Windows'un dikdörtgen
// düğmeleri yerine üç küçük cam damla. Üzerine gelince hafifçe büyür (yay); kapat yumuşak kırmızıya
// döner. Pencere odakta değilken soluklaşır. Boş üst şerit pencereyi sürükler.

const run = (action: WindowAction) => (): void => {
  void window.api.windowControl(action)
}

function DropButton({
  label,
  className,
  onClick,
  children
}: {
  label: string
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <motion.button
      type="button"
      className={`window-drop glass glass--capsule${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
    >
      {children}
    </motion.button>
  )
}

export function TitleBar() {
  const { maximized, focused } = useWindowState()
  return (
    <div className={`titlebar${focused ? '' : ' titlebar--blurred'}`}>
      <div className="titlebar__controls">
        <DropButton label={i18n.t('window.minimize')} onClick={run('minimize')}>
          <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
        </DropButton>
        <DropButton
          label={i18n.t(maximized ? 'window.restore' : 'window.maximize')}
          onClick={run('toggleMaximize')}
        >
          {maximized ? (
            <Copy size={12} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <Square size={11} strokeWidth={2.4} aria-hidden="true" />
          )}
        </DropButton>
        <DropButton
          label={i18n.t('window.close')}
          className="window-drop--close"
          onClick={run('close')}
        >
          <X size={14} strokeWidth={2.4} aria-hidden="true" />
        </DropButton>
      </div>
    </div>
  )
}
