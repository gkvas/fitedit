import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { FileDrop } from './components/FileDrop'
import { MapView } from './components/MapView'
import { TimelineChart } from './components/TimelineChart'
import { LapList } from './components/LapList'
import { Toolbar } from './components/Toolbar'
import { useEditorStore } from './state/editorStore'
import { trackPointsOf, lapBoundariesOf } from './fit/display'
import { moveLapBoundary, addLapBoundary, deleteLap } from './fit/operations/laps'

function App() {
  const model = useEditorStore((s) => s.model)
  const fileName = useEditorStore((s) => s.fileName)
  const clear = useEditorStore((s) => s.clear)
  const setModel = useEditorStore((s) => s.setModel)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const hasUnsavedEdits = useEditorStore((s) => s.past.length > 0)

  const points = useMemo(() => (model ? trackPointsOf(model) : []), [model])
  const laps = useMemo(() => (model ? lapBoundariesOf(model) : []), [model])
  const [hoverTime, setHoverTime] = useState<Date | null>(null)
  const [selectedRange, setSelectedRange] = useState<{ start: Date; end: Date } | null>(null)
  // Bumped on every "Reset zoom" click so the map re-fits to the whole route
  // even when there's no selectedRange change to react to — e.g. the user
  // zoomed/panned the map directly rather than via a chart selection.
  const [mapResetSignal, setMapResetSignal] = useState(0)
  const handleResetZoom = useCallback(() => setMapResetSignal((n) => n + 1), [])

  const activeLapIndex = useMemo(() => {
    if (!hoverTime) return null
    const hit = laps.find(
      (lap) => lap.startTime && lap.endTime && hoverTime >= lap.startTime && hoverTime <= lap.endTime,
    )
    return hit?.index ?? null
  }, [hoverTime, laps])

  // Stable across hover-only re-renders (they don't touch `model`), so
  // TimelineChart's memoized chart options/data — and the zoom plugin's
  // internal state — aren't invalidated every time the mouse moves.
  const handleMoveLapBoundary = useCallback(
    (boundaryIndex: number, newTime: Date) => {
      if (!model) return
      setModel(moveLapBoundary(model, boundaryIndex, newTime))
    },
    [model, setModel],
  )

  const handleAddLapBoundary = useCallback(
    (time: Date) => {
      if (!model) return
      setModel(addLapBoundary(model, time))
    },
    [model, setModel],
  )

  const handleDeleteLap = useCallback(
    (lapIndex: number) => {
      if (!model) return
      setModel(deleteLap(model, lapIndex))
    },
    [model, setModel],
  )

  const handleDeleteLapBoundary = useCallback(
    (boundaryIndex: number) => {
      if (!model) return
      setModel(deleteLap(model, boundaryIndex))
    },
    [model, setModel],
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const isEditable =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if (isEditable) return

      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault()
        redo()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  // Warn before losing edits that haven't been downloaded yet, whether the
  // user closes/reloads the tab or clicks "Load a different file".
  useEffect(() => {
    if (!hasUnsavedEdits) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedEdits])

  function handleLoadDifferentFile() {
    if (hasUnsavedEdits && !window.confirm("You have unsaved edits that haven't been downloaded. Discard them?")) {
      return
    }
    clear()
  }

  if (!model) {
    return (
      <div className="app-shell app-shell--empty">
        <h1>FIT Editor</h1>
        <FileDrop />
      </div>
    )
  }

  return (
    <div className="app-shell app-shell--loaded">
      <header className="app-header">
        <h1>FIT Editor</h1>
        <span className="app-header-file">{fileName}</span>
        <Toolbar />
        <button type="button" onClick={handleLoadDifferentFile}>
          Load a different file
        </button>
      </header>
      <MapView
        points={points}
        laps={laps}
        externalHoverTime={hoverTime}
        selectedRange={selectedRange}
        resetSignal={mapResetSignal}
        onMoveLapBoundary={handleMoveLapBoundary}
        onAddLapBoundary={handleAddLapBoundary}
        onDeleteLapBoundary={handleDeleteLapBoundary}
      />
      <TimelineChart
        points={points}
        laps={laps}
        onAddLapBoundary={handleAddLapBoundary}
        onHoverChange={setHoverTime}
        onRangeChange={setSelectedRange}
        onResetZoom={handleResetZoom}
      />
      <LapList laps={laps} activeLapIndex={activeLapIndex} onDeleteLap={handleDeleteLap} />
    </div>
  )
}

export default App
