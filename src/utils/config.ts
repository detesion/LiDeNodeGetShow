import type { SiteConfig } from '../types'

type RawSiteToken = {
  name?: unknown
  backend_url?: unknown
  websocket?: unknown
  token?: unknown
}

type RawSiteConfig = Omit<Partial<SiteConfig>, 'site_tokens'> & {
  site_tokens?: RawSiteToken[]
}

const stringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function normalizeConfig(raw: RawSiteConfig): SiteConfig {
  const theme = raw.theme_config ?? {}
  const preferences = raw.user_preferences ?? {}
  const siteLogo =
    stringValue(preferences.site_logo) ||
    stringValue(preferences.site_log) ||
    stringValue(theme.site_logo) ||
    stringValue(theme.site_log) ||
    stringValue(raw.site_logo) ||
    stringValue(raw.site_log)
  const siteName =
    stringValue(preferences.site_name) ||
    stringValue(theme.site_name) ||
    stringValue(raw.site_name) ||
    stringValue(raw.theme_name)
  const footer = stringValue(preferences.footer) || stringValue(theme.footer)
  const repository = stringValue(raw.repository) || stringValue(raw.theme_repo)

  return {
    ...raw,
    name: stringValue(raw.name) || stringValue(raw.theme_name) || 'NodeGet Theme',
    description: stringValue(raw.description),
    repository: repository || undefined,
    user_preferences: {
      ...preferences,
      site_name: siteName,
      site_logo: siteLogo,
      footer,
    },
    theme_config: {
      ...theme,
      site_name: siteName,
      site_logo: siteLogo,
      footer,
    },
    site_tokens: (raw.site_tokens ?? [])
      .map((site, index) => {
        const backendUrl = stringValue(site.backend_url) || stringValue(site.websocket)
        return {
          name: stringValue(site.name) || `master-${index + 1}`,
          backend_url: backendUrl,
          websocket: backendUrl,
          token: stringValue(site.token),
        }
      })
      .filter(site => site.backend_url && site.token),
  }
}
