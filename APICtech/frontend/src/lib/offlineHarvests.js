import { useCallback, useEffect, useState } from 'react'

import { apiRequest } from './api'
import { refreshSummary } from './store'

// Harvests recorded with no signal: kept on this device only, in the browser's own storage, until a
// connection comes back. Each one gets a client-made id the moment it is confirmed, so a retried upload can
// never create the same batch twice, and the device's own clock at that moment (offlineRecordedAt) — the
// server keeps that as the true time of the entry even though it only reaches the ledger later. Once queued
// here nothing about the entry can be changed or removed from this screen: that is what makes it immutable.
const QUEUE_KEY = 'apictech_offline_harvests'

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [] } catch { return [] }
}

function writeQueue(queue) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)) } catch { /* storage full or blocked: the entry stays in memory only for this tab */ }
}

export function useOfflineHarvests(onSynced) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queue, setQueue] = useState(readQueue)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncMessage, setLastSyncMessage] = useState('')

  const queueEntry = useCallback((entry) => {
    const withId = { ...entry, clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, offlineRecordedAt: new Date().toISOString() }
    setQueue((current) => { const next = [...current, withId]; writeQueue(next); return next })
  }, [])

  const sync = useCallback(async () => {
    const pending = readQueue()
    if (!navigator.onLine || pending.length === 0 || syncing) return
    setSyncing(true)
    let uploaded = 0

    for (const entry of pending) {
      try {
        await apiRequest('/company/harvests', {
          method: 'POST',
          body: JSON.stringify({ ...entry, offline: true, quantityKg: entry.quantityKg }),
        })
        uploaded += 1
        const remaining = readQueue().filter((item) => item.clientId !== entry.clientId)
        writeQueue(remaining)
        setQueue(remaining)
      } catch {
        // Still offline, or the API is briefly unreachable: leave it queued and try again on the next signal.
        break
      }
    }

    setSyncing(false)
    if (uploaded > 0) {
      setLastSyncMessage(`${uploaded} offline harvest${uploaded === 1 ? '' : 's'} uploaded to the KVIC chain.`)
      await Promise.all([onSynced?.(), refreshSummary()])
      window.setTimeout(() => setLastSyncMessage(''), 8000)
    }
  }, [onSynced, syncing])

  useEffect(() => {
    const goOnline = () => { setIsOnline(true); sync() }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    if (navigator.onLine) sync()
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { isOnline, pending: queue, syncing, lastSyncMessage, queue: queueEntry }
}
