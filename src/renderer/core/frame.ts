// UI güncellemelerini kare hızına bağlar (PLAN 1.8, 1.8b). Aynı karede gelen çağrılar birleşir,
// yalnızca son değer çizilir. Pencere gizliyken `requestAnimationFrame` çalışmaz: güncellemeler
// durur ve pencere görünür olunca en son değerle bir kez çizilir. DOM'a doğrudan bağımlı değildir.

export type FrameScheduler = (callback: () => void) => unknown

const defaultScheduler: FrameScheduler = (cb) => requestAnimationFrame(() => cb())

/** `fn`'i en fazla kare başına bir kez, son argümanla çağıran fonksiyon döner. */
export function frameThrottle<T>(
  fn: (value: T) => void,
  schedule: FrameScheduler = defaultScheduler
): (value: T) => void {
  let pending = false
  let latest: T
  return (value) => {
    latest = value
    if (pending) return
    pending = true
    schedule(() => {
      pending = false
      fn(latest)
    })
  }
}
