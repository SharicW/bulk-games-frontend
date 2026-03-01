import { useState, useEffect } from 'react'

export function useIsMobile(breakpoint = 768) {
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.matchMedia(`(max-width: ${breakpoint}px)`).matches
    })

    useEffect(() => {
        const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`)

        // Explicitly check current state to prevent initial render mismatch
        if (mediaQuery.matches !== isMobile) {
            setIsMobile(mediaQuery.matches)
        }

        const handler = (e: MediaQueryListEvent) => {
            setIsMobile(e.matches)
        }

        mediaQuery.addEventListener('change', handler)
        return () => mediaQuery.removeEventListener('change', handler)
    }, [breakpoint, isMobile])

    return isMobile
}
