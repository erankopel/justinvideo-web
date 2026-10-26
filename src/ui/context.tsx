import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { fill, type Language } from '../i18n'
import type { Services } from '../services'
import { STRINGS, type StringKey } from '../strings'

export const ServicesContext = createContext<Services | null>(null)

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (!services) throw new Error('The screens need the services')
  return services
}

export interface Translation {
  readonly language: Language
  readonly t: (key: StringKey, values?: Readonly<Record<string, string | number>>) => string
}

export const LanguageContext = createContext<Translation>({ language: 'en', t: (key) => STRINGS.en[key] })

export const useTranslation = (): Translation => useContext(LanguageContext)

export function translation(language: Language): Translation {
  return { language, t: (key, values) => fill(STRINGS[language][key], values) }
}
