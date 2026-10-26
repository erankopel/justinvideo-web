import { formatTimecode } from '../i18n'
import { useTranslation } from './context'
import { FrameBackIcon, FrameForwardIcon, NextCutIcon, PauseIcon, PlayIcon, PreviousCutIcon } from './icons'

export interface TransportProps {
  positionMs: number
  durationMs: number
  fps: number
  playing: boolean
  disabled: boolean
  onPreviousCut: () => void
  onFrameBack: () => void
  onToggle: () => void
  onFrameForward: () => void
  onNextCut: () => void
}

/** Play and pause, a frame at a time, from cut to cut, and the position as hours, minutes, seconds and frames. Laid out left to right in every language, like the timeline under it. */
export function Transport(props: TransportProps) {
  const { t } = useTranslation()
  const { disabled } = props
  return (
    <div class="transport" dir="ltr">
      <div class="buttons">
        <button type="button" class="icon" disabled={disabled} aria-label={t('previousCut')} title={t('previousCut')} onClick={props.onPreviousCut} data-testid="previous-cut">
          <PreviousCutIcon />
        </button>
        <button type="button" class="icon" disabled={disabled} aria-label={t('frameBack')} title={t('frameBack')} onClick={props.onFrameBack} data-testid="frame-back">
          <FrameBackIcon />
        </button>
        <button
          type="button"
          class="icon primary"
          disabled={disabled}
          aria-label={props.playing ? t('pause') : t('play')}
          title={props.playing ? t('pause') : t('play')}
          onClick={props.onToggle}
          data-testid="play"
        >
          {props.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" class="icon" disabled={disabled} aria-label={t('frameForward')} title={t('frameForward')} onClick={props.onFrameForward} data-testid="frame-forward">
          <FrameForwardIcon />
        </button>
        <button type="button" class="icon" disabled={disabled} aria-label={t('nextCut')} title={t('nextCut')} onClick={props.onNextCut} data-testid="next-cut">
          <NextCutIcon />
        </button>
      </div>
      <span class="timecode" role="timer" aria-label={t('positionLabel')} data-testid="timecode">
        {formatTimecode(props.positionMs, props.fps)} / {formatTimecode(props.durationMs, props.fps)}
      </span>
    </div>
  )
}
