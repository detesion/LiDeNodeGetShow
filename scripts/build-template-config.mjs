import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))
const themeSource = resolve(root, 'public/nodeget-theme.json')
const themeOut = resolve(dist, 'nodeget-theme.json')
const configOut = resolve(dist, 'config.json')

if (!existsSync(dist)) mkdirSync(dist, { recursive: true })

const theme = JSON.parse(readFileSync(themeSource, 'utf-8'))
theme.version = pkg.version
writeFileSync(themeOut, JSON.stringify(theme, null, 2) + '\n')

const preferences = {}
for (const item of theme.user_preferences_form?.items ?? []) {
  if (!item.key) continue
  preferences[item.key] = item.default ?? ''
}

writeFileSync(
  configOut,
  JSON.stringify(
    {
      user_preferences: {
        site_name: preferences.site_name || 'NodeGet Status',
        site_logo: preferences.site_logo || '',
        footer: preferences.footer || 'Powered by NodeGet',
      },
      site_tokens: [],
    },
    null,
    2,
  ) + '\n',
)

console.log(`[build-template-config] wrote nodeget-theme.json v${pkg.version} and default config.json`)
