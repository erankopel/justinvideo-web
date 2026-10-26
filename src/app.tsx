import { useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks'
import { isRightToLeft, type Language, LANGUAGES, pickLanguage } from './i18n'
import type { Offline } from './offline/register'
import type { Blocked, Services } from './services'
import { STRINGS } from './strings'
import { LanguageContext, ServicesContext, translation } from './ui/context'
import { Home } from './ui/Home'
import { ProjectGate } from './ui/ProjectGate'
import { parseRoute } from './ui/route'

const LANGUAGE_KEY = 'justinvideo-language'

function savedLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY)
    const match = LANGUAGES.find((language) => language === saved)
    if (match) return match
  } catch {
    // Storage may be blocked; the browser's own language is the fallback.
  }
  return pickLanguage(navigator.languages)
}

/** The site: the list of projects and a project's page, in the person's language. blocked is set when the browser refuses storage. */
export function App({ services, blocked, offline }: { services: Services | null; blocked: Blocked | null; offline: Offline }) {
  const [language, setLanguage] = useState<Language>(savedLanguage)
  const [hash, setHash] = useState(location.hash)
  const [update, setUpdate] = useState(offline.updateReady)
  useEffect(() => offline.subscribe(setUpdate), [offline])
  const text = useMemo(() => translation(language), [language])
  const { t } = text

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = isRightToLeft(language) ? 'rtl' : 'ltr'
    try {
      localStorage.setItem(LANGUAGE_KEY, language)
    } catch {
      // The choice is only remembered while storage allows.
    }
  }, [language])

  useEffect(() => {
    const changed = (): void => setHash(location.hash)
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])

  const route = parseRoute(hash)
  // Which page is shown, for the styles: the editor on a phone takes the whole screen, and the rest of the page goes under it.
  useLayoutEffect(() => {
    document.documentElement.dataset['view'] = route.name
  }, [route.name])

  return (
    <LanguageContext.Provider value={text}>
      <header class="site">
        <a class="brand" href="#/">
          {t('siteName')}
        </a>
        <nav aria-label={t('language')}>
          {LANGUAGES.map((code) => (
            <button key={code} type="button" lang={code} aria-pressed={code === language} onClick={() => setLanguage(code)}>
              {STRINGS[code].name}
            </button>
          ))}
        </nav>
      </header>
      {services === null ? (
        <main>
          <p role="alert" data-blocked={blocked}>
            {t(blocked === 'browser' ? 'browserUnsupported' : 'storageUnavailable')}
          </p>
        </main>
      ) : (
        <ServicesContext.Provider value={services}>
          {route.name === 'project' ? <ProjectGate key={route.id} id={route.id} /> : <Home />}
        </ServicesContext.Provider>
      )}
      <footer class="site">
        <a href="/privacy/">{t('privacy')}</a>
        <a href="/licenses/">{t('licenses')}</a>
        {update && (
          <span class="update" role="status" data-testid="update-ready">
            {t('updateReady')}{' '}
            <button type="button" data-testid="update-now" onClick={() => offline.apply()}>
              {t('updateNow')}
            </button>
          </span>
        )}
      </footer>
    </LanguageContext.Provider>
  )
}
