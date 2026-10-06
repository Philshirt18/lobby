import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { fetchActivityChunked, findSetup, syncFrom, type SetupInfo } from '../lib/indexer'
import { applyActivity, emptyState } from '../lib/state'
import { loadState, saveState } from '../lib/store'
import type { LobbyState } from '../lib/types'
import { pub } from './useChain'

export type Phase = 'loading' | 'needs-setup' | 'ready'

/**
 * The whole "backend" of the app: it reads the owner's activity straight from the chain, keeps a
 * local cache, and re-reads the latest blocks on every tick (see OVERLAP in the indexer).
 */
export function useLobby(owner: Address | undefined) {
  const [state, setState] = useState<LobbyState>(emptyState)
  const [phase, setPhase] = useState<Phase>('loading')
  const [head, setHead] = useState<number | null>(null)
  const [online, setOnline] = useState(true)
  const ref = useRef(state)
  const running = useRef(false)
  const searched = useRef(false)

  useEffect(() => {
    searched.current = false
    if (!owner) {
      ref.current = emptyState()
      setState(ref.current)
      setPhase('loading')
      return
    }
    const cached = loadState(owner)
    ref.current = cached
    setState(cached)
    setPhase(cached.setup ? 'ready' : 'loading')
  }, [owner])

  const commit = useCallback(
    (next: LobbyState) => {
      ref.current = next
      setState(next)
      if (owner) saveState(owner, next)
    },
    [owner],
  )

  const update = useCallback((fn: (s: LobbyState) => LobbyState) => commit(fn(ref.current)), [commit])

  const sync = useCallback(async () => {
    if (!owner || running.current) return
    running.current = true
    try {
      const tip = await pub.getBlockNumber()
      let st = ref.current
      if (!st.setup) {
        // A fresh device: walk back through the registry's events once, then only look at recent blocks.
        const found = await findSetup(pub, owner, tip, searched.current ? 2_000n : 2_000_000n)
        searched.current = true
        if (!found) {
          setPhase('needs-setup')
          setOnline(true)
          return
        }
        st = { ...st, setup: found, cursor: null }
      }
      const act = await fetchActivityChunked(pub, owner, syncFrom(st.cursor, st.setup!.block), tip)
      // The user may have acted while we waited for the network: merge onto the latest state, not the one we started with.
      commit(applyActivity({ ...ref.current, setup: st.setup, cursor: Number(tip) }, act, owner))
      setPhase('ready')
      setHead(Number(tip))
      setOnline(true)
    } catch {
      setOnline(false)
    } finally {
      running.current = false
    }
  }, [owner, commit])

  useEffect(() => {
    if (!owner) return
    void sync()
    const id = setInterval(() => {
      if (!document.hidden) void sync()
    }, 3000)
    // Polling pauses in background tabs; catch up the moment the user is back.
    const onVisible = () => {
      if (!document.hidden) void sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [owner, sync])

  const markSetup = useCallback(
    (info: SetupInfo) => {
      update((s) => ({ ...s, setup: info, cursor: null }))
      setPhase('ready')
    },
    [update],
  )

  return { state, phase, head, online, update, refresh: sync, markSetup }
}
