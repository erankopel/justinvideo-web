import { useEffect, useState } from 'preact/hooks'
import { smoothed } from '../audio/meter'
import { useTranslation } from './context'

/**
 * How loud the microphone is, as a bar. It asks for the level on every frame, and shows what it is told: waiting until the
 * audio engine has started, the bar once it has, and a note where this browser cannot measure the level at all, so that a
 * bar that never moves is not taken for a microphone that is silent.
 */
export function LevelMeter({ read, unavailable, testId }: { read: () => number | null; unavailable: () => boolean; testId: string }) {
  const { t } = useTranslation()
  const [percent, setPercent] = useState(0)
  const [state, setState] = useState<'waiting' | 'measuring' | 'unavailable'>('waiting')

  useEffect(() => {
    let shown = 0
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const level = read()
      shown = smoothed(shown, level ?? 0, now - last)
      last = now
      setPercent(Math.round(shown * 100))
      setState(level !== null ? 'measuring' : unavailable() ? 'unavailable' : 'waiting')
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [read, unavailable])

  return (
    <span class="meter-wrap">
      <span
        class="meter"
        role="meter"
        aria-label={t('levelLabel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state === 'measuring' ? percent : undefined}
        data-testid={testId}
        data-state={state}
        data-level={percent}
      >
        <span class="meter-bar" style={{ width: `${percent}%` }} />
      </span>
      {state === 'unavailable' && (
        <span class="hint" data-testid={`${testId}-unavailable`}>
          {t('levelUnavailable')}
        </span>
      )}
    </span>
  )
}
