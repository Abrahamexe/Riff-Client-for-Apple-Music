import { PlayerStateSchema, type PlayerState } from '@shared/ipc-contract'
import type { Db } from '../connection'

// player_state: tek satırlık (id = 1) son kuyruk ve konum. Çökme/yeniden açılış sonrası geri yüklenir.

export class PlayerStateRepository {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now
  ) {}

  save(state: PlayerState): void {
    this.db
      .prepare(
        `INSERT INTO player_state (id, queue, position, position_sec, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET queue = excluded.queue, position = excluded.position,
           position_sec = excluded.position_sec, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(state.queue), state.position, state.currentTime, this.now())
  }

  /** Kayıt yoksa veya bozuksa `null` (bozuk kayıt uygulamayı durdurmaz). */
  load(): PlayerState | null {
    const row = this.db
      .prepare('SELECT queue, position, position_sec FROM player_state WHERE id = 1')
      .get() as { queue: string; position: number; position_sec: number } | undefined
    if (!row) return null
    try {
      const parsed = PlayerStateSchema.safeParse({
        queue: JSON.parse(row.queue) as unknown,
        position: row.position,
        currentTime: row.position_sec
      })
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  clear(): void {
    this.db.exec('DELETE FROM player_state')
  }
}
