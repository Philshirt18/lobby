import { useEffect, useState } from 'react'

/** Re-render on an interval so relative times ("3 min ago") stay current without touching the DOM by hand. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}
