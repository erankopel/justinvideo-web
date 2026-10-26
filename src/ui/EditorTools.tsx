import { type RefObject } from 'preact'
import { useRef } from 'preact/hooks'
import type { Edge } from '../engine'
import { MIN_AUDIO_ITEM_MS } from '../engine/audio'
import { recordingSupported } from '../audio/recorder'
import { formatClock, isolateLtr, isRightToLeft } from '../i18n'
import { useTranslation } from './context'
import { LevelMeter } from './LevelMeter'
import { type Tab, TABS, tabAfterKey } from './tabs'

export interface EditorToolsProps {
  tab: Tab
  onTab: (tab: Tab) => void
  /** The edit and the playhead are left alone while a voiceover is recorded or the microphone is being asked for. */
  locked: boolean
  recording: boolean
  startingRecording: boolean
  recordedMs: number
  inputLevel: () => number | null
  inputLevelUnavailable: () => boolean
  /** The edit has no clips. */
  empty: boolean
  hasSelection: boolean
  /** The place of the selected clip among the clips, or -1. */
  selectedIndex: number
  clipCount: number
  hasRange: boolean
  snapping: boolean
  /** Where the subtitles would go: there is a recording to put them on. */
  canImportSubtitles: boolean
  addingMusic: boolean
  positionMs: number
  durationMs: number
  onSplit: () => void
  onRemoveClip: () => void
  onDuplicate: () => void
  onEarlier: () => void
  onLater: () => void
  onTrimHere: (edge: Edge) => void
  onToggleRange: () => void
  onRemoveRange: () => void
  onToggleSnapping: () => void
  onAddText: () => void
  onSubtitleFile: (file: File) => void
  onClipVolume: () => void
  /** Add music was pressed: the playhead is noted, and then the file is asked for. */
  onAddMusic: () => void
  onMusicFile: (file: File) => void
  onFades: () => void
  onRecord: () => void
  onMicrophone: () => void
}

/** The file that was chosen in a hidden input, which is then emptied so that the same file can be chosen again. */
function chosenFile(input: HTMLInputElement): File | undefined {
  const file = input.files?.[0]
  input.value = ''
  return file
}

/**
 * The tabs and the buttons of the editor: editing, trimming, text and sound. All the buttons are always in the page; on a narrow
 * screen the styles show those of the chosen tab (`data-tab`), and on a wide one all of them.
 */
export function EditorTools(props: EditorToolsProps) {
  const { t, language } = useTranslation()
  const { locked, empty, hasSelection, selectedIndex, recording, startingRecording } = props
  const subtitlePicker: RefObject<HTMLInputElement> = useRef(null)
  const musicPicker: RefObject<HTMLInputElement> = useRef(null)
  return (
    <>
      {/* The tabs follow the pattern of a tab list: the chosen tab is the one that is reached with the Tab key, and the arrows, Home and End
          move between the others, choosing as they go. The keys are the tabs' own, and do not step the picture. */}
      <div
        class="tool-tabs"
        role="tablist"
        aria-label={t('toolsLabel')}
        onKeyDown={(event) => {
          const to = tabAfterKey(event.key, TABS.indexOf(props.tab), isRightToLeft(language))
          const name = TABS[to]
          if (!name) return
          event.preventDefault()
          event.stopPropagation()
          const button = document.getElementById(`tool-tab-${name}`) as HTMLButtonElement | null
          if (!button || button.disabled) return
          props.onTab(name)
          button.focus()
        }}
      >
        {TABS.map((name) => (
          <button
            key={name}
            id={`tool-tab-${name}`}
            type="button"
            role="tab"
            aria-selected={props.tab === name}
            tabIndex={props.tab === name ? 0 : -1}
            data-testid={`tab-${name}`}
            disabled={(recording || startingRecording) && name !== props.tab}
            onClick={() => props.onTab(name)}
          >
            {t(name === 'edit' ? 'tabEdit' : name === 'trim' ? 'tabTrim' : name === 'text' ? 'tabText' : 'soundLabel')}
          </button>
        ))}
      </div>
      <div class="tools">
        <div class="actions clip-tools" role="group" aria-label={t('actionsLabel')}>
          <button type="button" data-testid="split" data-tab="edit" disabled={empty || locked} title={`${t('splitHere')} (S)`} onClick={props.onSplit}>
            {t('splitHere')}
          </button>
          <button type="button" data-testid="remove" data-tab="edit" disabled={!hasSelection || locked} title={`${t('removeClip')} (Delete)`} onClick={props.onRemoveClip}>
            {t('removeClip')}
          </button>
          <button type="button" data-testid="duplicate" data-tab="edit" disabled={!hasSelection || locked} title={`${t('duplicateClip')} (Ctrl+D)`} onClick={props.onDuplicate}>
            {t('duplicateClip')}
          </button>
          <button type="button" data-testid="earlier" data-tab="edit" disabled={selectedIndex <= 0 || locked} title={`${t('moveEarlier')} ([)`} onClick={props.onEarlier}>
            {t('moveEarlier')}
          </button>
          <button
            type="button"
            data-testid="later"
            data-tab="edit"
            disabled={selectedIndex < 0 || selectedIndex >= props.clipCount - 1 || locked}
            title={`${t('moveLater')} (])`}
            onClick={props.onLater}
          >
            {t('moveLater')}
          </button>
          <button type="button" data-testid="trim-start-here" data-tab="trim" disabled={!hasSelection || locked} title={`${t('trimStartHere')} (Q)`} onClick={() => props.onTrimHere('start')}>
            {t('trimStartHere')}
          </button>
          <button type="button" data-testid="trim-end-here" data-tab="trim" disabled={!hasSelection || locked} title={`${t('trimEndHere')} (W)`} onClick={() => props.onTrimHere('end')}>
            {t('trimEndHere')}
          </button>
          <button type="button" data-testid="range-tool" data-tab="trim" aria-pressed={props.hasRange} disabled={empty || locked} onClick={props.onToggleRange}>
            {t('range')}
          </button>
          <button type="button" data-testid="remove-range" data-tab="trim" disabled={!props.hasRange || locked} onClick={props.onRemoveRange}>
            {t('removeRange')}
          </button>
          <button type="button" data-testid="snapping" data-tab="trim" aria-pressed={props.snapping} disabled={locked} onClick={props.onToggleSnapping}>
            {t('snapping')}
          </button>
          <button type="button" data-testid="add-text" data-tab="text" disabled={empty || locked} onClick={props.onAddText}>
            {t('addText')}
          </button>
          <button type="button" data-testid="import-subtitles" data-tab="text" disabled={!props.canImportSubtitles || locked} onClick={() => subtitlePicker.current?.click()}>
            {t('importSubtitles')}
          </button>
          <input
            ref={subtitlePicker}
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain"
            hidden
            data-testid="subtitle-input"
            onChange={(event) => {
              const file = chosenFile(event.currentTarget)
              if (file) props.onSubtitleFile(file)
            }}
          />
        </div>
        <div class="actions sound-tools" role="group" aria-label={t('soundLabel')}>
          <button type="button" data-testid="volume" disabled={!hasSelection || locked} onClick={props.onClipVolume}>
            {t('volumeButton')}
          </button>
          <button
            type="button"
            data-testid="add-music"
            disabled={empty || props.addingMusic || locked}
            onClick={() => {
              props.onAddMusic()
              musicPicker.current?.click()
            }}
          >
            {t('addMusic')}
          </button>
          <input
            ref={musicPicker}
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.mp4,.mov,.webm,.mkv"
            hidden
            data-testid="music-input"
            onChange={(event) => {
              const file = chosenFile(event.currentTarget)
              if (file) props.onMusicFile(file)
            }}
          />
          <button type="button" data-testid="fades" disabled={empty || locked} onClick={props.onFades}>
            {t('masterFadesButton')}
          </button>
          <button
            type="button"
            data-testid="record"
            aria-pressed={recording}
            disabled={empty || props.addingMusic || startingRecording || (!recording && props.positionMs >= props.durationMs - MIN_AUDIO_ITEM_MS)}
            onClick={props.onRecord}
          >
            {t(recording ? 'stopRecording' : 'recordVoice')}
          </button>
          {recordingSupported() && (
            <button type="button" data-testid="microphone" disabled={locked} onClick={props.onMicrophone}>
              {t('microphoneButton')}
            </button>
          )}
          {recording && (
            <span class="recording" data-testid="recording">
              {t('recordingNow', { time: isolateLtr(formatClock(props.recordedMs)) })}
            </span>
          )}
          {recording && <LevelMeter read={props.inputLevel} unavailable={props.inputLevelUnavailable} testId="recording-level" />}
        </div>
      </div>
    </>
  )
}
