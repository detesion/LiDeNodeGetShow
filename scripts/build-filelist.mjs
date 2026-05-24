import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const out = resolve(dist, 'nodeget-theme-files.json')

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue
    if (name === '_headers') continue
    const path = resolve(dir, name)
    const rel = relative(dist, path).split(sep).join('/')
    if (rel.endsWith('.zip')) continue
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, files)
    else files.push(rel)
  }
  return files
}

const files = walk(dist).filter(file => file !== 'nodeget-theme-files.json').sort()
files.push('nodeget-theme-files.json')

writeFileSync(out, JSON.stringify(files, null, 2) + '\n')
console.log(`[build-filelist] wrote ${files.length} file(s) to nodeget-theme-files.json`)
