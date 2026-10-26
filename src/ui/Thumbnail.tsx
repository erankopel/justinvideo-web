import { useEffect, useState } from 'preact/hooks'
import { useServices } from './context'

/** The picture kept for a project, or an empty frame while there is none. */
export function Thumbnail({ id }: { id: string }) {
  const { projects } = useServices()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    let created: string | null = null
    projects
      .thumbnail(id)
      .then((image) => {
        if (image && current) {
          created = URL.createObjectURL(image)
          setUrl(created)
        }
      })
      .catch(() => undefined)
    return () => {
      current = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [id, projects])
  return url ? <img class="thumb" src={url} alt="" /> : <div class="thumb" aria-hidden="true" />
}
