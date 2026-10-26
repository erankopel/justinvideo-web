import { useState } from 'preact/hooks'
import {
  AUDIO_STEP_MS,
  type AudioItem,
  fadeInBy,
  fadeOutBy,
  movedBy,
  resizedBy,
  skippedBy,
  steppedFade,
  withVolume,
} from '../engine/audio'
import { MAX_VOLUME_PERCENT } from '../engine'
import { isolateLtr, isolateName } from '../i18n'
import { useTranslation } from './context'
import { Stepper } from './Stepper'

/** A length of time in seconds with one decimal, inside a sentence. Only the number reads left to right. */
export function useSecondsText(): (ms: number) => string {
  const { t } = useTranslation()
  return (ms) => t('secondsValue', { n: isolateLtr((ms / 1000).toFixed(1)) })
}

const PRESETS = [50, 100, 150] as const

/** The volume of a clip or a piece of audio: a slider in steps of five percent, and quick choices for silence and the usual levels. */
export function VolumeControl({ percent, onChange, id }: { percent: number; onChange: (percent: number) => void; id: string }) {
  const { t } = useTranslation()
  return (
    <div class="volume">
      <label>
        <span data-testid={`${id}-value`}>{t('volumeLabel', { value: isolateLtr(`${percent}%`) })}</span>
        <input
          type="range"
          min={0}
          max={MAX_VOLUME_PERCENT}
          step={5}
          value={percent}
          data-testid={id}
          dir="ltr"
          onInput={(event) => onChange(Math.min(MAX_VOLUME_PERCENT, Math.max(0, Number(event.currentTarget.value))))}
        />
      </label>
      <div class="presets">
        <button type="button" aria-pressed={percent === 0} data-testid={`${id}-preset-0`} onClick={() => onChange(0)}>
          {t('volumeMute')}
        </button>
        {PRESETS.map((preset) => (
          <button key={preset} type="button" aria-pressed={percent === preset} data-testid={`${id}-preset-${preset}`} onClick={() => onChange(preset)}>
            {isolateLtr(`${preset}%`)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The volume of one clip's own sound. Nothing changes until Save. */
export function ClipVolumeForm({ percent, onSave, onCancel }: { percent: number; onSave: (percent: number) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(percent)
  return (
    <form
      class="dialog-form"
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(value)
      }}
    >
      <VolumeControl percent={value} onChange={setValue} id="clip-volume" />
      <div class="buttons">
        <button type="button" data-testid="clip-volume-cancel" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" class="primary" data-testid="clip-volume-save">
          {t('textSave')}
        </button>
      </div>
    </form>
  )
}

/**
 * A piece of music or voiceover: its volume, where it starts on the edit, how long it plays, how much of its start is
 * skipped, and its fades, each in half-second steps. Nothing changes until Save.
 */
export function AudioItemForm({ item, onSave, onDelete, onCancel }: { item: AudioItem; onSave: (item: AudioItem) => void; onDelete: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const seconds = useSecondsText()
  const [draft, setDraft] = useState(item)
  const kind = t(draft.kind === 'music' ? 'audioKindMusic' : 'audioKindVoiceover')
  return (
    <form
      class="dialog-form"
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}
    >
      <p data-testid="audio-name">
        {kind}: <bdi>{isolateName(draft.displayName)}</bdi>
      </p>
      <VolumeControl percent={draft.volumePercent} onChange={(percent) => setDraft(withVolume(draft, percent))} id="audio-volume" />
      <fieldset class="timing">
        <legend>{t('audioWhenLabel')}</legend>
        <Stepper
          label={t('audioStarts', { time: seconds(draft.startMs) })}
          id={{ label: 'audio-starts', back: 'audio-earlier', forward: 'audio-later' }}
          backText={t('audioEarlier')}
          forwardText={t('audioLater')}
          onBack={() => setDraft(movedBy(draft, -AUDIO_STEP_MS))}
          onForward={() => setDraft(movedBy(draft, AUDIO_STEP_MS))}
        />
        <Stepper
          label={t('audioLasts', { time: seconds(draft.lengthMs) })}
          id={{ label: 'audio-lasts', back: 'audio-shorter', forward: 'audio-longer' }}
          backText={t('audioShorter')}
          forwardText={t('audioLonger')}
          onBack={() => setDraft(resizedBy(draft, -AUDIO_STEP_MS))}
          onForward={() => setDraft(resizedBy(draft, AUDIO_STEP_MS))}
        />
        <Stepper
          label={t('audioSkips', { time: seconds(draft.trimStartMs) })}
          id={{ label: 'audio-skips', back: 'audio-skip-less', forward: 'audio-skip-more' }}
          backText={t('audioSkipLess')}
          forwardText={t('audioSkipMore')}
          onBack={() => setDraft(skippedBy(draft, -AUDIO_STEP_MS))}
          onForward={() => setDraft(skippedBy(draft, AUDIO_STEP_MS))}
        />
        <Stepper
          label={t('audioFadeIn', { time: seconds(draft.fadeInMs) })}
          id={{ label: 'audio-fadein', back: 'audio-fadein-shorter', forward: 'audio-fadein-longer' }}
          backText={t('audioShorter')}
          forwardText={t('audioLonger')}
          onBack={() => setDraft(fadeInBy(draft, -AUDIO_STEP_MS))}
          onForward={() => setDraft(fadeInBy(draft, AUDIO_STEP_MS))}
        />
        <Stepper
          label={t('audioFadeOut', { time: seconds(draft.fadeOutMs) })}
          id={{ label: 'audio-fadeout', back: 'audio-fadeout-shorter', forward: 'audio-fadeout-longer' }}
          backText={t('audioShorter')}
          forwardText={t('audioLonger')}
          onBack={() => setDraft(fadeOutBy(draft, -AUDIO_STEP_MS))}
          onForward={() => setDraft(fadeOutBy(draft, AUDIO_STEP_MS))}
        />
      </fieldset>
      <div class="buttons">
        <button type="button" class="danger" data-testid="audio-delete" onClick={onDelete}>
          {t('audioRemove')}
        </button>
        <button type="button" data-testid="audio-cancel" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" class="primary" data-testid="audio-save">
          {t('textSave')}
        </button>
      </div>
    </form>
  )
}

/** The fades over the whole video: the sound rises at its start and falls at its end. Nothing changes until Save. */
export function MasterFadesForm({ fadeInMs, fadeOutMs, onSave, onCancel }: { fadeInMs: number; fadeOutMs: number; onSave: (fadeInMs: number, fadeOutMs: number) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const seconds = useSecondsText()
  const [fadeIn, setFadeIn] = useState(fadeInMs)
  const [fadeOut, setFadeOut] = useState(fadeOutMs)
  return (
    <form
      class="dialog-form"
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(fadeIn, fadeOut)
      }}
    >
      <Stepper
        label={t('fadesIn', { time: seconds(fadeIn) })}
        id={{ label: 'master-fadein', back: 'master-fadein-shorter', forward: 'master-fadein-longer' }}
        backText={t('audioShorter')}
        forwardText={t('audioLonger')}
        onBack={() => setFadeIn(steppedFade(fadeIn, -AUDIO_STEP_MS))}
        onForward={() => setFadeIn(steppedFade(fadeIn, AUDIO_STEP_MS))}
      />
      <Stepper
        label={t('fadesOut', { time: seconds(fadeOut) })}
        id={{ label: 'master-fadeout', back: 'master-fadeout-shorter', forward: 'master-fadeout-longer' }}
        backText={t('audioShorter')}
        forwardText={t('audioLonger')}
        onBack={() => setFadeOut(steppedFade(fadeOut, -AUDIO_STEP_MS))}
        onForward={() => setFadeOut(steppedFade(fadeOut, AUDIO_STEP_MS))}
      />
      <div class="buttons">
        <button type="button" data-testid="master-cancel" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" class="primary" data-testid="master-save">
          {t('textSave')}
        </button>
      </div>
    </form>
  )
}
