import type { HTMLAttributes, ReactNode } from 'react'

/** Liquid glass yüzeyi (panel veya iç içe kapsül). Görünüm `styles/ui.css` `.glass`. */
export function Glass({
  variant = 'panel',
  className,
  children,
  ...rest
}: {
  variant?: 'panel' | 'capsule'
  className?: string
  children?: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  const classes = ['glass', variant === 'capsule' ? 'glass--capsule' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
