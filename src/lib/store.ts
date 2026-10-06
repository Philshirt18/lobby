import type { Address } from 'viem'
import { chain } from './network'
import { emptyState } from './state'
import type { LobbyState } from './types'

const key = (owner: Address) => `lobby:v1:${chain.id}:${owner.toLowerCase()}`

/** Local persistence. Everything that matters lives on-chain; this only caches and keeps names and invoices. */
export function loadState(owner: Address): LobbyState {
  try {
    const raw = localStorage.getItem(key(owner))
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as LobbyState
    return parsed.version === 1 ? parsed : emptyState()
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
