import { isolateName } from '../i18n'
import type { ImportProgress } from '../import/importer'
import { useTranslation } from './context'

/** What the import is doing now, and a list of the files that were refused with the reason. */
export function ImportStatus({ progress, problems }: { progress: ImportProgress | null; problems: readonly string[] }) {
  const { t } = useTranslation()
  return (
    <>
      <div role="status">
        {progress && (
          <>
            <p>{t('importing', { name: isolateName(progress.name), index: progress.fileIndex + 1, count: progress.fileCount })}</p>
            <progress max={progress.total} value={progress.done} />
          </>
        )}
      </div>
      {problems.length > 0 && (
        <ul role="alert" class="problems">
          {problems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      )}
    </>
  )
}
