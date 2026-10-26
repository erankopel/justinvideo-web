import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { type Edge, type EditOp, type EditResult, randomTextId, spans } from '../engine'
import type { AudioItem, AudioOp, AudioResult } from '../engine/audio'
import { activeAt, newTitleAt, type TextItem, type TextOp, type TextResult, textItem } from '../engine/text'
import { AudioImportError, prepareMusic, removeAudioFile } from '../audio/files'
import { saveMicrophone, savedMicrophone } from '../audio/devices'
import { duplicateClipAction, type EditAction, moveEarlierAction, moveLaterAction, refusalText, removeClipAction, removeRangeAction, splitAction, trimToPlayheadAction } from '../editing/actions'
import { EditPlayer } from '../player/EditPlayer'
import { buildSegments } from '../player/segments'
import type { Project } from '../project/model'
import { defaultRange, type TimeSpan, rangeWithin } from '../timeline/range'
import { cutEdges, nextCut, previousCut, steppedFrame } from '../timeline/transport'
import { isRightToLeft } from '../i18n'
import { CaptionOverlay } from './CaptionOverlay'
import { useServices, useTranslation } from './context'
import { Dialog } from './Dialog'
import { AudioItemForm, ClipVolumeForm, MasterFadesForm } from './AudioDialogs'
import { EditorTools } from './EditorTools'
import { MicrophoneForm } from './MicrophoneDialog'
import { AUDIO_FAILURE_TEXT } from './messages'
import type { Notice } from './notice'
import { type TextEdit, TextForm } from './TextDialog'
import { Timeline as TimelineView } from './Timeline'
import { useFilmstrip } from './useFilmstrip'
import { useWaveforms } from './useWaveforms'
import { readKey } from './shortcuts'
import type { Tab } from './tabs'
import { captionsAddedNotice, readSubtitleFile } from './subtitles'
import { useDragEdits } from './useDragEdits'
import { useVoiceover } from './useVoiceover'
import { Transport } from './Transport'

const NOTICE_MS = 6_000
export interface EditorProps {
  project: Project
  /** Makes an edit to the project and says what came of it. */
  onEdit: (op: EditOp) => EditResult
  /** Changes the titles and captions, as one undo step, and says what came of it. */
  onText: (op: TextOp) => TextResult
  /** Changes the music, the voiceovers or the fades of the whole edit, as one undo step, and says what came of it. */
  onAudio: (op: AudioOp) => AudioResult
  onUndo: () => void
  onRedo: () => void
}

/**
 * The preview, the transport, the timeline and the editing buttons of one project. The playhead is the player's
 * position, and the player is told about the edit whenever it changes. Everything here is in edit time.
 */
export function Editor({ project, onEdit, onText, onAudio, onUndo, onRedo }: EditorProps) {
  const { media } = useServices()
  const { t, language } = useTranslation()
  const film = useFilmstrip(project.id, project.sources)
  const waves = useWaveforms(project.id)
  const edit = project.edit
  const clipSpans = useMemo(() => spans(edit.timeline), [edit.timeline])
  const segments = useMemo(() => buildSegments(clipSpans), [clipSpans])
  const durationMs = edit.timeline.durationMs
  const fps = project.fps

  const host = useRef<HTMLDivElement>(null)
  const player = useRef<EditPlayer | null>(null)
  const sources = useRef(project.sources)
  sources.current = project.sources
  const [position, setPosition] = useState(0)
  const positionRef = useRef(0)
  positionRef.current = position
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapping, setSnapping] = useState(true)
  const [range, setRange] = useState<TimeSpan | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  // The clip whose volume, the piece whose settings, or the fades of the whole edit are being set in a dialog.
  const [volumeFor, setVolumeFor] = useState<string | null>(null)
  const [audioEdit, setAudioEdit] = useState<AudioItem | null>(null)
  const [fadesOpen, setFadesOpen] = useState(false)
  // The microphone that voiceovers are recorded with: one the person chose, kept in this browser, or null for the default.
  const [microphone, setMicrophone] = useState<string | null>(savedMicrophone)
  const [microphoneOpen, setMicrophoneOpen] = useState(false)
  const [addingMusic, setAddingMusic] = useState(false)
  // Where the playhead was when Add music was pressed: the music starts there.
  const musicAt = useRef(0)
  const mix = edit.mix
  const mixRef = useRef(mix)
  mixRef.current = mix
  /** Which set of buttons a narrow screen shows. */
  const [tab, setTab] = useState<Tab>('edit')
  const {
    recording,
    recordingRef,
    recordedMs,
    starting: startingRecording,
    locked,
    level: inputLevel,
    levelUnavailable: inputLevelUnavailable,
    start: startRecording,
    stop: stopRecording,
  } = useVoiceover({ media, projectId: project.id, microphone, player, positionRef, playing, durationMs, onAudio, setNotice, voiceoverName: t('audioKindVoiceover') })
  useEffect(() => {
    const element = host.current
    if (!element) return
    const created = new EditPlayer(
      element,
      async (sourceId) => {
        const source = sources.current.find((s) => s.id === sourceId)
        if (!source) throw new Error('A clip refers to a recording the project does not have')
        return media.read(project.id, source.file)
      },
      {
        position: (ms) => {
          positionRef.current = ms
          setPosition(ms)
        },
        playing: setPlaying,
        ended: () => undefined,
        failed: () => setFailed(true),
        itemFailed: () => setNotice({ key: 'audioPlaybackFailed' }),
      },
      { itemFile: (item) => media.read(project.id, item.file) },
    )
    created.setMix(mixRef.current)
    player.current = created
    // The pictures and the decoders are let go of when the page is, and not left to the browser's own tidying of it: a page that
    // is reloaded while a picture is still being loaded or read is one that some browsers have been seen to hang on. A page
    // that is kept for going back to (persisted) is not touched.
    const leaving = (event: PageTransitionEvent): void => {
      if (!event.persisted) created.dispose()
    }
    window.addEventListener('pagehide', leaving)
    return () => {
      window.removeEventListener('pagehide', leaving)
      created.dispose()
      player.current = null
    }
  }, [media, project.id])

  // The music, the voiceovers and the fades go to the player; they do not stop the picture.
  useEffect(() => {
    player.current?.setMix(mix)
  }, [mix])

  // A new edit goes to the player, with the playhead kept where it is, or where the edit that made it put it.
  useEffect(() => {
    setFailed(false)
    const kept = Math.min(positionRef.current, durationMs)
    if (kept !== positionRef.current) {
      positionRef.current = kept
      setPosition(kept)
    }
    player.current?.setEdit(segments, durationMs, kept)
  }, [segments, durationMs])

  useEffect(() => {
    if (selectedId !== null && !clipSpans.some((span) => span.clip.id === selectedId)) setSelectedId(null)
  }, [clipSpans, selectedId])

  // A range that no longer fits a shorter edit is cut down, or dropped if nothing of it is left.
  useEffect(() => {
    if (!range) return
    const kept = rangeWithin(range, durationMs, fps)
    if (!kept) setRange(null)
    else if (kept.endMs !== range.endMs) setRange(kept)
  }, [durationMs, fps, range])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  /** Puts the playhead at a time, at once on screen and then in the picture. */
  const moveTo = (ms: number): void => {
    if (recordingRef.current) return
    const target = Math.min(Math.max(ms, 0), durationMs)
    // The ref is set at once, not at the next render, so that the player is given this position even if the edit that
    // was made a moment ago reaches it first.
    positionRef.current = target
    setPosition(target)
    void player.current?.seek(target)
  }
  const pauseAndMoveTo = (ms: number): void => {
    if (recordingRef.current) return
    player.current?.pause()
    moveTo(ms)
  }
  const toggle = (): void => {
    if (recordingRef.current) return
    if (playing) player.current?.pause()
    else player.current?.play()
  }

  /** Makes an edit; if it is refused or changes nothing, says why, and leaves the playhead and the selection alone. */
  const act = (action: EditAction | null): boolean => {
    if (!action) return false
    player.current?.pause()
    // A jump of the picture that is still on its way must not arrive after this and take the playhead back: the edit puts it
    // somewhere, and the player is given the edit and goes there.
    player.current?.supersede()
    const reason = refusalText(onEdit(action.op))
    if (reason) {
      setNotice({ key: reason })
      // Nothing was changed, so the picture goes where the jump that was let go was going.
      void player.current?.seek(positionRef.current)
      return false
    }
    setNotice(null)
    if (action.playheadAfter !== undefined) {
      positionRef.current = action.playheadAfter
      setPosition(action.playheadAfter)
    }
    if (action.clearSelection) setSelectedId(null)
    return true
  }

  const {
    draft,
    guide,
    clearGuide,
    clipDrag,
    pieceDraft,
    titleDraft,
    cues,
    titleIds,
    trimDrag,
    trimEnd,
    clipDragMove,
    clipDragEnd,
    rangeDrag,
    pieceDrag,
    pieceDragEnd,
    titleDrag,
    titleDragEnd,
  } = useDragEdits({ project, clipSpans, snapping, range, setRange, positionRef, recordingRef, mixRef, act, onText, onAudio, setNotice })

  const under = [...clipSpans].reverse().find((span) => span.startMs <= position) ?? clipSpans[0]
  const selectedIndex = clipSpans.findIndex((span) => span.clip.id === selectedId)
  const selected = clipSpans[selectedIndex]
  const empty = clipSpans.length === 0

  const split = (): void => void act(splitAction(position))
  const removeSelected = (): void => void (selected && act(removeClipAction(selected)))
  const duplicateSelected = (): void => void (selected && act(duplicateClipAction(selected)))
  const earlier = (): void => void act(moveEarlierAction(clipSpans, selectedIndex))
  const later = (): void => void act(moveLaterAction(clipSpans, selectedIndex))
  /** Trims the start or the end of the selected clip to the playhead, from the keyboard or a button. */
  const trimHere = (edge: Edge): void => {
    const source = selected && project.sources.find((s) => s.id === selected.clip.sourceId)
    if (selected && source) void act(trimToPlayheadAction(edit.timeline, selected, edge, positionRef.current, source.durationMs, fps))
  }
  const removeTheRange = (): void => {
    if (range && act(removeRangeAction(range))) setRange(null)
  }
  const toggleRange = (): void => {
    if (range) setRange(null)
    else setRange(defaultRange(edit.timeline, position, fps))
  }

  const edges = cutEdges(clipSpans, durationMs)

  const openNewTitle = (): void => {
    player.current?.pause()
    setTextEdit({ item: textItem(randomTextId(), '', newTitleAt(position, durationMs)), isNew: true })
  }
  const openText = (id: string): void => {
    if (recordingRef.current) return
    const item = edit.texts.find((text) => text.id === id)
    if (!item) return
    player.current?.pause()
    setTextEdit({ item, isNew: false })
  }
  const saveText = (item: TextItem): void => {
    const result = onText({ type: textEdit?.isNew ? 'add' : 'replace', item })
    if (result.kind === 'rejected') {
      setNotice({ key: 'textRefused' })
      return
    }
    setNotice(null)
    setTextEdit(null)
  }
  const deleteText = (): void => {
    if (textEdit) onText({ type: 'remove', id: textEdit.item.id })
    setTextEdit(null)
  }

  const openClipVolume = (): void => {
    if (!selected) return
    player.current?.pause()
    setVolumeFor(selected.clip.id)
  }
  const saveClipVolume = (percent: number): void => {
    const clip = clipSpans.find((span) => span.clip.id === volumeFor)?.clip
    setVolumeFor(null)
    if (clip && clip.volumePercent !== percent) act({ op: { type: 'setClipVolume', clipId: clip.id, volumePercent: percent } })
  }
  const openAudio = (id: string): void => {
    if (recordingRef.current) return
    const item = mix.items.find((piece) => piece.id === id)
    if (!item) return
    player.current?.pause()
    setAudioEdit(item)
  }
  const saveAudio = (item: AudioItem): void => {
    const result = onAudio({ type: 'replace', item })
    if (result.kind === 'rejected') {
      setNotice({ key: 'audioRefused' })
      return
    }
    setNotice(null)
    setAudioEdit(null)
  }
  const deleteAudio = (): void => {
    if (audioEdit) onAudio({ type: 'remove', id: audioEdit.id })
    setAudioEdit(null)
  }
  const saveFades = (fadeInMs: number, fadeOutMs: number): void => {
    const result = onAudio({ type: 'setMasterFades', fadeInMs, fadeOutMs })
    if (result.kind === 'rejected') setNotice({ key: 'audioRefused' })
    else setNotice(null)
    setFadesOpen(false)
  }
  /** Copies a piece of music into the project and lays it under the edit from the playhead, the whole file to begin with. */
  const addMusic = async (file: File): Promise<void> => {
    if (addingMusic) return
    setAddingMusic(true)
    try {
      const item = await prepareMusic({ media }, project.id, file, musicAt.current)
      if (onAudio({ type: 'add', item }).kind === 'changed') {
        setNotice(null)
      } else {
        await removeAudioFile(media, project.id, item.file)
        setNotice({ key: 'audioRefused' })
      }
    } catch (error) {
      setNotice({ key: error instanceof AudioImportError ? AUDIO_FAILURE_TEXT[error.failure] : 'audioUnreadable' })
    } finally {
      setAddingMusic(false)
    }
  }

  const saveChosenMicrophone = (microphoneId: string | null): void => {
    saveMicrophone(microphoneId)
    setMicrophone(microphoneId)
    setMicrophoneOpen(false)
    setNotice(null)
  }

  /** Subtitles go to the recording of the selected clip, or else of the clip under the playhead. */
  const subtitleSource = project.sources.find((s) => s.id === (selected?.clip.sourceId ?? under?.clip.sourceId))
  const importSubtitles = async (file: File): Promise<void> => {
    if (!subtitleSource) return
    const reading = await readSubtitleFile(file, subtitleSource, language)
    if (reading.kind === 'refused') {
      setNotice(reading.notice)
      return
    }
    // Importing again replaces the captions of that recording, as one change.
    const result = onText({ type: 'replaceCaptionsOf', sourceId: subtitleSource.id, items: reading.items })
    setNotice(result.kind === 'rejected' ? { key: 'textRefused' } : captionsAddedNotice(reading))
  }

  // The key handler is replaced on every render, as the render happens, so that a key pressed right after a click sees the
  // click's result. The listener itself is added once.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined)
  onKey.current = (event: KeyboardEvent): void => {
    const reading = readKey(event, {
      recording: recordingRef.current !== null,
      hasSelection: selected !== undefined,
      selectedIndex,
      clipCount: clipSpans.length,
      hasRange: range !== null,
      empty,
      positionMs: position,
      fps,
      durationMs,
    })
    if (!reading) return
    if (reading.preventDefault) event.preventDefault()
    const command = reading.command
    if (!command) return
    switch (command.type) {
      case 'undo':
        onUndo()
        break
      case 'redo':
        onRedo()
        break
      case 'duplicate':
        duplicateSelected()
        break
      case 'toggle':
        toggle()
        break
      case 'seek':
        pauseAndMoveTo(command.ms)
        break
      case 'split':
        split()
        break
      case 'removeClip':
        removeSelected()
        break
      case 'removeRange':
        removeTheRange()
        break
      case 'trim':
        trimHere(command.edge)
        break
      case 'earlier':
        earlier()
        break
      case 'later':
        later()
        break
      case 'clearSelection':
        setSelectedId(null)
        break
      case 'clearRange':
        setRange(null)
        break
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onKey.current(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])

  const activeKey = activeAt(cues, position).map((cue) => `${cue.id}@${cue.startMs}`).join()
  const activeCues = useMemo(() => activeAt(cues, positionRef.current), [cues, activeKey])
  // The picture is shown in its own shape, that of the recording under the playhead.
  const source = under ? project.sources.find((s) => s.id === under.clip.sourceId) : undefined
  const turned = source ? source.rotationDegrees % 180 !== 0 : false
  const aspect = source && source.width > 0 && source.height > 0 ? (turned ? source.height / source.width : source.width / source.height) : 16 / 9

  return (
    <section
      class="editor"
      data-tab={tab}
      data-recording={recording !== null}
      aria-label={t('previewLabel')}
      // A button that was pressed with the mouse gives up the focus, so that Space then plays the picture instead of pressing the button again.
      onClick={(event) => {
        if (event.detail > 0 && event.target instanceof Element) event.target.closest('button')?.blur()
      }}
    >
      <div class="picture">
        <div
          class="preview"
          ref={host}
          data-testid="preview"
          data-position-ms={Math.round(position)}
          data-playing={playing}
          role="img"
          aria-label={t('previewLabel')}
          style={{ aspectRatio: String(aspect), '--aspect': String(aspect) }}
        >
          {empty && <p class="empty">{t('emptyEdit')}</p>}
          <CaptionOverlay active={activeCues} appIsRightToLeft={isRightToLeft(language)} />
        </div>
      </div>
      <p class="sr-only" data-testid="caption-text">
        {activeCues.map((cue) => cue.text).join(' ')}
      </p>
      {failed && <p role="alert">{t('playbackFailed')}</p>}
      <Transport
        positionMs={position}
        durationMs={durationMs}
        fps={fps}
        playing={playing}
        disabled={empty || locked}
        onPreviousCut={() => moveTo(previousCut(edges, position))}
        onFrameBack={() => pauseAndMoveTo(steppedFrame(position, fps, -1, durationMs))}
        onToggle={toggle}
        onFrameForward={() => pauseAndMoveTo(steppedFrame(position, fps, 1, durationMs))}
        onNextCut={() => moveTo(nextCut(edges, position, durationMs))}
      />
      <TimelineView
        spans={draft ? spans(draft) : clipSpans}
        committed={clipSpans}
        sources={project.sources}
        film={film}
        waves={waves}
        cues={cues}
        onTapText={openText}
        audio={pieceDraft ? mix.items.map((piece) => (piece.id === pieceDraft.id ? pieceDraft : piece)) : mix.items}
        movingId={pieceDraft?.id ?? titleDraft?.id ?? null}
        clipDrag={clipDrag}
        onClipDrag={clipDragMove}
        onClipDragEnd={clipDragEnd}
        titleIds={titleIds}
        onTitleDrag={titleDrag}
        onTitleDragEnd={titleDragEnd}
        onPieceDrag={pieceDrag}
        onPieceDragEnd={pieceDragEnd}
        onTapAudio={openAudio}
        positionMs={position}
        fps={fps}
        selectedId={selectedId}
        range={range}
        guide={guide}
        onScrubStart={() => {
          if (!recordingRef.current) player.current?.pause()
        }}
        onScrub={moveTo}
        onSelect={(id) => {
          if (!recordingRef.current) setSelectedId(id)
        }}
        onSeek={pauseAndMoveTo}
        onTrimDrag={trimDrag}
        onTrimEnd={trimEnd}
        onRangeDrag={rangeDrag}
        onRangeEnd={clearGuide}
      />
      <EditorTools
        tab={tab}
        onTab={setTab}
        locked={locked}
        recording={recording !== null}
        startingRecording={startingRecording}
        recordedMs={recordedMs}
        inputLevel={inputLevel}
        inputLevelUnavailable={inputLevelUnavailable}
        empty={empty}
        hasSelection={selected !== undefined}
        selectedIndex={selectedIndex}
        clipCount={clipSpans.length}
        hasRange={range !== null}
        snapping={snapping}
        canImportSubtitles={subtitleSource !== undefined}
        addingMusic={addingMusic}
        positionMs={position}
        durationMs={durationMs}
        onSplit={split}
        onRemoveClip={removeSelected}
        onDuplicate={duplicateSelected}
        onEarlier={earlier}
        onLater={later}
        onTrimHere={trimHere}
        onToggleRange={toggleRange}
        onRemoveRange={removeTheRange}
        onToggleSnapping={() => setSnapping(!snapping)}
        onAddText={openNewTitle}
        onSubtitleFile={(file) => void importSubtitles(file)}
        onClipVolume={openClipVolume}
        onAddMusic={() => {
          player.current?.pause()
          musicAt.current = positionRef.current
        }}
        onMusicFile={(file) => void addMusic(file)}
        onFades={() => setFadesOpen(true)}
        onRecord={() => void (recording ? stopRecording() : startRecording())}
        onMicrophone={() => {
          player.current?.pause()
          setMicrophoneOpen(true)
        }}
      />
      <p class={notice?.ok ? 'notice ok' : 'notice'} role="status" data-testid="notice">
        {notice ? t(notice.key, notice.values) : ''}
      </p>
      <Dialog open={volumeFor !== null} title={t('clipVolumeTitle')} onClose={() => setVolumeFor(null)}>
        {volumeFor !== null && (
          <ClipVolumeForm
            key={volumeFor}
            percent={clipSpans.find((span) => span.clip.id === volumeFor)?.clip.volumePercent ?? 100}
            onSave={saveClipVolume}
            onCancel={() => setVolumeFor(null)}
          />
        )}
      </Dialog>
      <Dialog open={audioEdit !== null} title={audioEdit?.kind === 'voiceover' ? t('audioEditVoiceover') : t('audioEditMusic')} onClose={() => setAudioEdit(null)}>
        {audioEdit && <AudioItemForm key={audioEdit.id} item={audioEdit} onSave={saveAudio} onDelete={deleteAudio} onCancel={() => setAudioEdit(null)} />}
      </Dialog>
      <Dialog open={microphoneOpen} title={t('microphoneTitle')} onClose={() => setMicrophoneOpen(false)}>
        {microphoneOpen && <MicrophoneForm choice={microphone} onSave={saveChosenMicrophone} onCancel={() => setMicrophoneOpen(false)} />}
      </Dialog>
      <Dialog open={fadesOpen} title={t('fadesTitle')} onClose={() => setFadesOpen(false)}>
        {fadesOpen && <MasterFadesForm fadeInMs={mix.masterFadeInMs} fadeOutMs={mix.masterFadeOutMs} onSave={saveFades} onCancel={() => setFadesOpen(false)} />}
      </Dialog>
      <Dialog open={textEdit !== null} title={textEdit?.isNew ? t('textNewTitle') : t('textEditTitle')} onClose={() => setTextEdit(null)}>
        {textEdit && <TextForm key={textEdit.item.id} edit={textEdit} durationMs={durationMs} onSave={saveText} onDelete={deleteText} onCancel={() => setTextEdit(null)} />}
      </Dialog>
    </section>
  )
}
