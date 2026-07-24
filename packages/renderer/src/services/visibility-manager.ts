/**
 * 全局可见性管理器 — 统一暂停/恢复后台轮询
 *
 * 所有定时轮询应使用 createManagedPoller 替代裸 setInterval。
 * 当页面隐藏（切到其他应用 / 最小化）时自动暂停所有轮询，
 * 恢复时立即执行一轮 + 恢复正常间隔。
 *
 * 这避免了 Chromium 在 Electron 窗口中的后台节流不一致问题：
 * 后台积压的定时器在切回前台时集中爆发，导致 IPC + setState 风暴。
 */

interface Poller {
  fn: () => void
  ms: number
  timer: ReturnType<typeof setTimeout> | null
}

const pollers = new Set<Poller>()
let visible = typeof document !== "undefined" ? !document.hidden : true

function scheduleNext(p: Poller) {
  if (!visible) return
  p.timer = setTimeout(() => {
    p.timer = null
    p.fn()
    scheduleNext(p)
  }, p.ms)
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const wasVisible = visible
    visible = !document.hidden

    if (wasVisible && !visible) {
      // ── 切到后台：暂停所有轮询 ──
      for (const p of pollers) {
        if (p.timer) {
          clearTimeout(p.timer)
          p.timer = null
        }
      }
    } else if (!wasVisible && visible) {
      // ── 切回前台：延迟 300ms 让 UI 先稳定，然后立即执行一轮 + 恢复间隔 ──
      setTimeout(() => {
        for (const p of pollers) {
          if (p.timer) continue // 已经在运行
          p.fn()
          scheduleNext(p)
        }
      }, 300)
    }
  })
}

/**
 * 创建受可见性管理的轮询器。
 *
 * @param fn 轮询函数（同步或异步均可，异步时下一次 tick 会在 fn 返回后调度）
 * @param ms 轮询间隔
 * @returns 取消函数，调用后停止该轮询
 *
 * 行为：
 * - 页面可见时：立即执行 fn()，然后按 ms 间隔重复
 * - 页面隐藏时：暂停（不执行 fn，不调度下一次）
 * - 页面恢复可见时：延迟 300ms 后立即执行一轮 fn()，然后恢复正常间隔
 */
export function createManagedPoller(fn: () => void, ms: number): () => void {
  const p: Poller = { fn, ms, timer: null }
  pollers.add(p)

  if (visible) {
    fn()
    scheduleNext(p)
  }

  return () => {
    if (p.timer) clearTimeout(p.timer)
    pollers.delete(p)
  }
}

/**
 * 创建受可见性管理的定时器（不立即执行第一次）。
 * 用于需要自己控制首次执行时机的场景。
 */
export function createManagedInterval(fn: () => void, ms: number): () => void {
  const p: Poller = { fn, ms, timer: null }
  pollers.add(p)

  if (visible) {
    scheduleNext(p)
  }

  return () => {
    if (p.timer) clearTimeout(p.timer)
    pollers.delete(p)
  }
}

export function isAppVisible(): boolean {
  return visible
}
