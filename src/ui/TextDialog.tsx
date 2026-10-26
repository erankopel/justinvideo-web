import { useState } from 'preact/hooks'
import {
  MAX_TEXT_LENGTH,
  movedTitle,
  onOutput,
  type OnOutput,
  resizedTitle,
  TITLE_STEP_MS,
  type TextDirection,
  type TextItem,
  type TextPosition,
  type TextSize,
} from '../engine/text'
import { isolateLtr } from '../i18n'
import { rulerLabel } from '../timeline/ruler'
import type { StringKey } from '../strings'
import { useTranslation } from './context'
import { Stepper } from './Stepper'

/** A title or caption being made or changed in the dialog. isNew is true until it has been saved once. */
export interface TextEdit {
  readonly item: TextItem
  readonly isNew: boolean
}

const DIRECTIONS: readonly [TextDirection, StringKey][] = [['auto', 'textDirectionAuto'], ['ltr', 'textDirectionLtr'], ['rtl', 'textDirectionRtl']]
const POSITIONS: readonly [TextPosition, StringKey][] = [['top', 'textPositionTop'], ['middle', 'textPositionMiddle'], ['bottom', 'textPositionBottom']]
const SIZES: readonly [TextSize, StringKey][] = [['small', 'textSizeSmall'], ['medium', 'textSizeMedium'], ['large', 'textSizeLarge']]

function Choice<T extends string>({ name, legend, options, value, onChange }: { name: string; legend: string; options: readonly [T, StringKey][]; value: T; onChange: (value: T) => void }) {
  const { t } = useTranslation()
  return (
    <fieldset class="choice">
      <legend>{legend}</legend>
      {options.map(([option, label]) => (
        <label key={option}>
          <input type="radio" name={name} value={option} checked={value === option} data-testid={`${name}-${option}`} onChange={() => onChange(option)} />
          <span>{t(label)}</span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * The words of a title or caption and how they look. A title also has its time on the edited video, moved in half-second
 * steps; a caption's time comes from its subtitle file and follows its footage, so only its words and looks change. Nothing
 * is changed in the project until Save.
 */
export function TextForm({ edit, durationMs, onSave, onDelete, onCancel }: { edit: TextEdit; durationMs: number; onSave: (item: TextItem) => void; onDelete: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const { item } = edit
  const [text, setText] = useState(item.text)
  const [direction, setDirection] = useState(item.direction)
  const [position, setPosition] = useState(item.position)
  const [size, setSize] = useState(item.size)
  const [when, setWhen] = useState<OnOutput>(item.placement.type === 'onOutput' ? item.placement : onOutput(item.placement.startMs, item.placement.endMs))
  const isTitle = item.placement.type === 'onOutput'
  const clock = (ms: number): string => isolateLtr(rulerLabel(ms, 100))

  return (
    <form
      class="dialog-form"
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim() === '') return
        onSave({ ...item, text: text.trim(), direction, position, size, placement: isTitle ? when : item.placement })
      }}
    >
      <label class="field">
        {t('textFieldLabel')}
        <textarea
          rows={3}
          dir="auto"
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          autofocus
          data-testid="text-field"
          onInput={(event) => setText(event.currentTarget.value.slice(0, MAX_TEXT_LENGTH))}
        />
        <span class="count" dir="ltr">
          {t('textCount', { n: text.length, max: MAX_TEXT_LENGTH })}
        </span>
      </label>

      {isTitle ? (
        <fieldset class="timing">
          <legend>{t('textWhenLabel')}</legend>
          <Stepper
            label={t('textStarts', { time: clock(when.startMs) })}
            id={{ label: 'text-starts', back: 'text-earlier', forward: 'text-later' }}
            backText={t('textEarlier')}
            forwardText={t('textLater')}
            onBack={() => setWhen(movedTitle(when, -TITLE_STEP_MS, durationMs))}
            onForward={() => setWhen(movedTitle(when, TITLE_STEP_MS, durationMs))}
          />
          <Stepper
            label={t('textLasts', { time: clock(when.endMs - when.startMs) })}
            id={{ label: 'text-lasts', back: 'text-shorter', forward: 'text-longer' }}
            backText={t('textShorter')}
            forwardText={t('textLonger')}
            onBack={() => setWhen(resizedTitle(when, -TITLE_STEP_MS, durationMs))}
            onForward={() => setWhen(resizedTitle(when, TITLE_STEP_MS, durationMs))}
          />
        </fieldset>
      ) : (
        <p class="hint">{t('textCaptionNote')}</p>
      )}

      <Choice name="text-direction" legend={t('textDirectionLabel')} options={DIRECTIONS} value={direction} onChange={setDirection} />
      <Choice name="text-position" legend={t('textPositionLabel')} options={POSITIONS} value={position} onChange={setPosition} />
      <Choice name="text-size" legend={t('textSizeLabel')} options={SIZES} value={size} onChange={setSize} />

      <div class="buttons">
        {!edit.isNew && (
          <button type="button" class="danger" data-testid="text-delete" onClick={onDelete}>
            {t('textDelete')}
          </button>
        )}
        <button type="button" data-testid="text-cancel" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" class="primary" data-testid="text-save" disabled={text.trim() === ''}>
          {t('textSave')}
        </button>
      </div>
    </form>
  )
}
