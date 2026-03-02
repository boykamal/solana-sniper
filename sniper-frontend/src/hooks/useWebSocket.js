import { useEffect, useRef, useState, useCallback } from 'react'

export function useWebSocket(url) {
  const [messages, setMessages] = useState([])
  const [last,     setLast]     = useState(null)
  const [status,   setStatus]   = useState('CONNECTING')
  const wsRef      = useRef(null)
  const retryTimer = useRef(null)
  const retryCount = useRef(0)

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('LIVE')
        retryCount.current = 0
        clearTimeout(retryTimer.current)
      }
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          setLast(data)
          setMessages(prev => [...prev.slice(-200), data])
        } catch {}
      }
      ws.onclose = () => {
        setStatus('RECONNECTING')
        const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30000)
        retryCount.current++
        retryTimer.current = setTimeout(connect, delay)
      }
      ws.onerror = () => ws.close()
    } catch {
      setStatus('ERROR')
      retryTimer.current = setTimeout(connect, 5000)
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(retryTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { last, messages, status }
}
