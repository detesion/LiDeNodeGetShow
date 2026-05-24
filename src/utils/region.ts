import type { Node } from '../types'

export function backendRegionCode(node: Node) {
  const explicit = node.meta?.region?.trim().toUpperCase()
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit
  return null
}
