import { useEffect, useState } from 'react'

export type Route = { page: 'desk' | 'pay'; params: URLSearchParams }

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  return { page: path.startsWith('/pay') ? 'pay' : 'desk', params: new URLSearchParams(query) }
}

/** Tiny hash router: "#/" is the front desk, "#/pay?to=0x…&amount=250&ref=INV-1" is the sender page. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
