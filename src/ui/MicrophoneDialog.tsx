import { useCallback, useEffect, useState } from 'preact/hooks'
import { availableChoice, listMicrophones, type Microphones } from '../audio/devices'
import { InputMeter } from '../audio/meter'
import { openMicrophone, RecordingError } from '../audio/recorder'
import { isolateName } from '../i18n'
import { useTranslation } from './context'
import { LevelMeter } from './LevelMeter'

/**
 * The microphone to record voiceovers with: the default of the browser, or one of the microphones it lists. The browser
 * gives the names of the microphones only once it has been allowed to use one, so until then they are numbered, and a
 * button asks for that permission. The list follows microphones being plugged in and out. Nothing changes until Save. A
 * test shows how loud the chosen microphone is, and follows the choice; it records nothing, and it is only ever started by
 * the button, so that the microphone is not opened just by looking at the list.
 */
export function MicrophoneForm({ choice, onSave, onCancel }: { choice: string | null; onSave: (microphoneId: string | null) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [found, setFound] = useState<Microphones | null>(null)
  const [selected, setSelected] = useState<string | null>(choice)
  const [refused, setRefused] = useState(false)
  const [testing, setTesting] = useState(false)
  const [meter, setMeter] = useState<InputMeter | null>(null)
  const [testFailure, setTestFailure] = useState<'recordingDenied' | 'recordingFailed' | null>(null)

  useEffect(() => {
    let current = true
    const refresh = (): void => void listMicrophones().then((microphones) => current && setFound(microphones))
    refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => {
      current = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
    }
  }, [])

  // A microphone that has been chosen and is not connected shows as the default, which is what will be used.
  const shown = found ? availableChoice(selected, found) : selected

  // While testing, the microphone shown is open, and the meter is on it. Another choice moves the test to that microphone,
  // and leaving the dialog, or stopping the test, lets go of it. The names of the microphones appear once one has been opened.
  useEffect(() => {
    if (!testing) return
    let current = true
    let opened: { stream: MediaStream; meter: InputMeter } | null = null
    setTestFailure(null)
    openMicrophone(shown).then(
      ({ stream }) => {
        if (!current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        opened = { stream, meter: new InputMeter(stream) }
        setMeter(opened.meter)
        void listMicrophones().then((microphones) => current && setFound(microphones))
      },
      (error: unknown) => {
        if (!current) return
        setTesting(false)
        setTestFailure(error instanceof RecordingError && error.failure === 'Denied' ? 'recordingDenied' : 'recordingFailed')
      },
    )
    return () => {
      current = false
      setMeter(null)
      opened?.meter.close()
      opened?.stream.getTracks().forEach((track) => track.stop())
    }
  }, [testing, shown])
  const readLevel = useCallback(() => meter?.level() ?? null, [meter])
  const levelUnavailable = useCallback(() => meter?.unavailable ?? false, [meter])

  const allow = async (): Promise<void> => {
    setRefused(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setFound(await listMicrophones())
    } catch {
      setRefused(true)
    }
  }

  return (
    <form
      class="dialog-form"
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(shown)
      }}
    >
      <fieldset class="choice">
        <legend>{t('microphoneLegend')}</legend>
        <label>
          <input type="radio" name="microphone" checked={shown === null} data-testid="microphone-default" onChange={() => setSelected(null)} />
          <span>{t('microphoneDefault')}</span>
        </label>
        {found?.list.map((microphone, index) => (
          <label key={microphone.id}>
            <input type="radio" name="microphone" checked={shown === microphone.id} data-testid={`microphone-${index}`} onChange={() => setSelected(microphone.id)} />
            <span>{microphone.label === '' ? t('microphoneUnnamed', { n: index + 1 }) : <bdi>{isolateName(microphone.label)}</bdi>}</span>
          </label>
        ))}
      </fieldset>
      {found && found.list.length === 0 && <p data-testid="microphone-none">{t('microphoneNone')}</p>}
      {found && found.list.length > 0 && !found.named && (
        <>
          <p class="hint">{t('microphoneNeedsPermission')}</p>
          <div class="buttons">
            <button type="button" data-testid="microphone-allow" onClick={() => void allow()}>
              {t('microphoneAllow')}
            </button>
          </div>
        </>
      )}
      {found && found.list.length > 0 && (
        <div class="buttons test">
          <button type="button" data-testid="microphone-test" aria-pressed={testing} onClick={() => setTesting(!testing)}>
            {t(testing ? 'microphoneTestStop' : 'microphoneTest')}
          </button>
          {testing && <LevelMeter read={readLevel} unavailable={levelUnavailable} testId="microphone-level" />}
        </div>
      )}
      {found && found.list.length > 0 && <p class="hint">{t('microphoneTestHint')}</p>}
      {refused && <p role="alert">{t('recordingDenied')}</p>}
      {testFailure && <p role="alert">{t(testFailure)}</p>}
      <p class="hint">{t('microphoneKept')}</p>
      <div class="buttons">
        <button type="button" data-testid="microphone-cancel" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" class="primary" data-testid="microphone-save">
          {t('textSave')}
        </button>
      </div>
    </form>
  )
}
