import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

/** A modal box on the browser's own dialog element, which brings the focus in, keeps it there and closes on Escape. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ComponentChildren }) {
  const box = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = box.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={box} onClose={onClose} aria-label={title}>
      {open && (
        <div class="dialog-body">
          <h2>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  )
}
