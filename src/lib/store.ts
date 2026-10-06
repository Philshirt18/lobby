import type { Address } from 'viem'
import { chain, TOKEN } from './network'
import { emptyState } from './state'
import type { LobbyState } from './types'

const key = (owner: Address) => `lobby:v1:${chain.id}:${owner.toLowerCase()}`

/**
 * Cached state may come from an older version of the app (fields added since). Fill the gaps instead of
 * crashing, so a returning visitor never gets a blank page.
 */
export function normalize(raw: unknown): LobbyState {
  const fresh = emptyState()
  if (!raw || typeof raw !== 'object') return fresh
  const s = raw as Partial<LobbyState>
  if (s.version !== 1) return fresh
  const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : [])
  return {
    ...fresh,
    ...s,
    held: list(s.held).map((h) => ({ ...h, token: h.token ?? TOKEN })),
    credited: list(s.credited).map((c) => ({ ...c, ts: c.ts ?? 0 })),
    counterparties: list(s.counterparties),
    invoices: list(s.invoices),
    guests: list(s.guests),
  }
}

/** Forget this account's local cache (names, invoices, history). Everything on-chain is untouched. */
export function clearState(owner: Address) {
  try {
    localStorage.removeItem(key(owner))
  } catch {
    /* ignore */
  }
}

/** Local persistence. Everything that matters lives on-chain; this only caches and keeps names and invoices. */
export function loadState(owner: Address): LobbyState {
  try {
    const raw = localStorage.getItem(key(owner))
    if (!raw) return emptyState()
    return normalize(JSON.parse(raw))
  } catch {
    return emptyState()
  }
}

export function saveState(owner: Address, state: LobbyState) {
  try {
    localStorage.setItem(key(owner), JSON.stringify(state))
  } catch {
    /* storage full or blocked: the app keeps working from memory */
  }
}
