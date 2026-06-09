import { useEffect } from 'react'

export function useExtensionCookies(
  onReceive: (psid: string, psidts: string) => void,
) {
  useEffect(() => {
    const handler = (event: CustomEvent<{ psid: string; psidts: string }>) => {
      onReceive(event.detail.psid, event.detail.psidts)
    }
    window.addEventListener('lumina:gemini-cookies', handler as EventListener)
    return () => {
      window.removeEventListener('lumina:gemini-cookies', handler as EventListener)
    }
  }, [onReceive])
}
