/** A value with two buttons that make it smaller or larger, or earlier or later, in the steps the app uses. */
export function Stepper({
  label,
  id,
  backText,
  forwardText,
  onBack,
  onForward,
}: {
  label: string
  /** The test ids of the words and of the two buttons. */
  id: { label: string; back: string; forward: string }
  backText: string
  forwardText: string
  onBack: () => void
  onForward: () => void
}) {
  return (
    <div class="stepper">
      <span data-testid={id.label}>{label}</span>
      <span class="stepper-buttons">
        <button type="button" data-testid={id.back} onClick={onBack}>
          {backText}
        </button>
        <button type="button" data-testid={id.forward} onClick={onForward}>
          {forwardText}
        </button>
      </span>
    </div>
  )
}
