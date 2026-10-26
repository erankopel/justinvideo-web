import type { RefObject } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { type AudioOp, type AudioResult, MIN_AUDIO_ITEM_MS } from '../engine/audio'
import { randomAudioId } from '../engine'
import { AudioImportError, removeAudioFile, storeAudio, voiceoverItem } from '../audio/files'
import { MAX_RECORDING_MS, RecordingError, recordingSupported, VoiceRecorder } from '../audio/recorder'
import type { EditPlayer } from '../player/EditPlayer'
import type { MediaStore } from '../storage/media-store'
import { AUDIO_FAILURE_TEXT } from './messages'
import type { Notice } from './notice'

/** How far past the end of the edit a recording may run before it is stopped, so a slow picture cannot keep the microphone open. */
const RECORDING_GRACE_MS = 400
/** A recording that is this short is not stopped by the picture reaching its end, which may only be the picture starting. */
const RECORDING_MIN_MS = 300

export interface VoiceoverInputs {
  media: MediaStore
  projectId: string
  /** The microphone that was chosen, or null for the default. */
  microphone: string | null
  player: RefObject<EditPlayer | null>
  positionRef: RefObject<number>
  playing: boolean
  durationMs: number
  onAudio: (op: AudioOp) => AudioResult
  setNotice: (notice: Notice | null) => void
  /** The name a recorded voiceover is given. */
  voiceoverName: string
}

/**
 * Recording a voiceover over the picture: asking for the microphone, the time and level while it runs, and laying the recording
 * under the edit where it began when it is stopped. It stops by itself when the edit has run out, and at the longest a recording
 * may be. Leaving the page throws a recording away and lets go of the microphone.
 */
export function useVoiceover({ media, projectId, microphone, player, positionRef, playing, durationMs, onAudio, setNotice, voiceoverName }: VoiceoverInputs) {
  // A voiceover being recorded: where in the edit it began. The picture plays while it is recorded, so it can be spoken over.
  const [recording, setRecording] = useState<{ atMs: number } | null>(null)
  const [recordedMs, setRecordedMs] = useState(0)
  const [starting, setStarting] = useState(false)
  const recorder = useRef<VoiceRecorder | null>(null)
  const level = useCallback(() => recorder.current?.level() ?? null, [])
  const levelUnavailable = useCallback(() => recorder.current?.levelUnavailable ?? false, [])
  const recordingRef = useRef(recording)
  recordingRef.current = recording
  const durationRef = useRef(durationMs)
  durationRef.current = durationMs
  const stopRef = useRef<() => Promise<void>>(async () => undefined)

  // A recording is stopped when the edit has run out, or at the longest a recording may be.
  useEffect(() => {
    if (!recording) return
    const room = durationRef.current - recording.atMs
    const timer = setInterval(() => {
      const elapsed = recorder.current?.elapsedMs() ?? 0
      setRecordedMs(elapsed)
      if (elapsed >= room + RECORDING_GRACE_MS || elapsed >= MAX_RECORDING_MS) void stopRef.current()
    }, 250)
    return () => clearInterval(timer)
  }, [recording])
  // The picture reaching the end of the edit ends the recording too.
  useEffect(() => {
    if (recording && !playing && (recorder.current?.elapsedMs() ?? 0) > RECORDING_MIN_MS) void stopRef.current()
  }, [recording, playing])
  // Leaving the page throws a recording away and lets go of the microphone.
  useEffect(() => () => recorder.current?.cancel(), [])

  /** Asks for the microphone and starts a voiceover at the playhead, with the picture playing so it can be spoken over. */
  const start = async (): Promise<void> => {
    if (recorder.current || starting) return
    if (!recordingSupported()) {
      setNotice({ key: 'recordingUnsupported' })
      return
    }
    player.current?.pause()
    setStarting(true)
    const next = new VoiceRecorder()
    let fellBack = false
    try {
      fellBack = (await next.start(microphone)).fellBack
    } catch (error) {
      setStarting(false)
      const failure = error instanceof RecordingError ? error.failure : 'Unavailable'
      setNotice({ key: failure === 'Denied' ? 'recordingDenied' : failure === 'Unsupported' ? 'recordingUnsupported' : 'recordingFailed' })
      return
    }
    setStarting(false)
    recorder.current = next
    setNotice(null)
    setRecordedMs(0)
    setRecording({ atMs: positionRef.current ?? 0 })
    // A microphone that was chosen and has been unplugged is made up for with the default; the person is told.
    if (fellBack) setNotice({ key: 'microphoneMissing' })
    player.current?.play()
  }

  /** Ends the voiceover and lays it under the edit where it began. One that is too short is thrown away. */
  const stop = async (): Promise<void> => {
    const active = recorder.current
    const atMs = recordingRef.current?.atMs ?? 0
    if (!active) return
    recorder.current = null
    setRecording(null)
    player.current?.pause()
    const result = await active.stop()
    if (!result || result.durationMs < MIN_AUDIO_ITEM_MS) {
      setNotice({ key: 'recordingTooShort' })
      return
    }
    try {
      const file = await storeAudio({ media }, projectId, result.wav, 'wav')
      const item = voiceoverItem({ id: randomAudioId(), file, displayName: voiceoverName, fileDurationMs: result.durationMs }, atMs, durationRef.current)
      if (onAudio({ type: 'add', item }).kind !== 'changed') {
        await removeAudioFile(media, projectId, file)
        setNotice({ key: 'audioRefused' })
        return
      }
      setNotice(result.heardSound ? null : { key: 'recordingSilent' })
    } catch (error) {
      setNotice({ key: error instanceof AudioImportError ? AUDIO_FAILURE_TEXT[error.failure] : 'audioUnreadable' })
    }
  }
  stopRef.current = stop

  return {
    /** Where in the edit the recording began, or null when none is running. */
    recording,
    /** The recording as a ref, for what has to know at the moment of a press and not at the next render. */
    recordingRef,
    recordedMs,
    /** The microphone is being asked for. */
    starting,
    /** The edit and the playhead are left alone while a voiceover is recorded or the microphone is being asked for. */
    locked: recording !== null || starting,
    level,
    levelUnavailable,
    start,
    stop,
  }
}
