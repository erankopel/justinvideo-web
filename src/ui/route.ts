import { isValidId } from '../engine'

export type Route = { readonly name: 'home' } | { readonly name: 'project'; readonly id: string }

/** The page that an address fragment names: #/p/<id> is a project, anything else is the list. */
export function parseRoute(hash: string): Route {
  const match = /^#\/p\/([^/?#]+)/.exec(hash)
  const id = match?.[1]
  return id !== undefined && isValidId(id) ? { name: 'project', id } : { name: 'home' }
}

export const hrefOf = (route: Route): string => (route.name === 'project' ? `#/p/${route.id}` : '#/')
