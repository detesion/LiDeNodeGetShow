import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distConfigPath = resolve(root, 'dist/config.json')
const publicConfigPath = resolve(root, 'public/config.json')
const configPath = existsSync(resolve(root, 'dist')) ? distConfigPath : publicConfigPath

function parseSite(raw) {
  const out = {}
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,]*))(?:\s*,\s*|\s*$)/g
  let m
  while ((m = re.exec(raw))) {
    const key = m[1]
    const val = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : (m[3] ?? '').trim()
    out[key] = val
  }
  return out
}

function readJson(path, fallback = {}) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return fallback
  }
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSiteToken(site, index) {
  const backendUrl = stringValue(site?.backend_url) || stringValue(site?.websocket) || stringValue(site?.url)
  return {
    name: stringValue(site?.name) || `master-${index + 1}`,
    backend_url: backendUrl,
    token: stringValue(site?.token),
  }
}

function normalizeConfig(input, fallback = {}) {
  const preferences = input.user_preferences || input.theme_config || {}
  const siteName = stringValue(preferences.site_name) || stringValue(input.site_name) || stringValue(input.theme_name)
  const siteLogo =
    stringValue(preferences.site_logo) ||
    stringValue(preferences.site_log) ||
    stringValue(input.site_logo) ||
    stringValue(input.site_log)
  const footer = stringValue(preferences.footer) || stringValue(input.footer)

  return {
    user_preferences: {
      site_name: siteName || fallback.user_preferences?.site_name || 'NodeGet Status',
      site_logo: siteLogo || fallback.user_preferences?.site_logo || '',
      footer: footer || fallback.user_preferences?.footer || 'Powered by NodeGet',
    },
    site_tokens: (input.site_tokens || [])
      .map(normalizeSiteToken)
      .filter(site => site.backend_url && site.token),
  }
}

function configFromNodegetEnv() {
  const raw = process.env.NODEGET_CONFIG
  if (!raw) return null

  try {
    return normalizeConfig(JSON.parse(raw))
  } catch (error) {
    throw new Error(`NODEGET_CONFIG is not valid JSON: ${error.message}`)
  }
}

function configFromLegacySiteEnv() {
  const tokens = []
  for (let i = 1; ; i++) {
    const raw = process.env[`SITE_${i}`]
    if (!raw) break
    tokens.push(normalizeSiteToken(parseSite(raw), i - 1))
  }
  const validTokens = tokens.filter(site => site.backend_url && site.token)
  if (!validTokens.length) return null

  return {
    user_preferences: {
      site_name: process.env.SITE_NAME || 'NodeGet Status',
      site_logo: process.env.SITE_LOGO || '',
      footer: process.env.SITE_FOOTER || 'Powered by NodeGet',
    },
    site_tokens: validTokens,
  }
}

const current = readJson(configPath, {})
const next = configFromNodegetEnv() || configFromLegacySiteEnv() || normalizeConfig(current, current)

writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n')
console.log(`[build-config] wrote config.json with ${next.site_tokens.length} site token(s)`)
