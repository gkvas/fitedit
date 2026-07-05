# FIT Editor

A browser-based editor for Garmin `.fit` activity files. Drop in a file, edit
it on an interactive map and timeline, and download the result — all
client-side, nothing is uploaded anywhere.

## Features

- **Drag-and-drop loading** of `.fit` files, decoded entirely in the browser.
- **Interactive map** (Leaflet) showing the recorded route, with lap
  boundaries overlaid.
- **Timeline chart** (Chart.js) of the ride/run with zoom, pan, and range
  selection, synced with the map.
- **Lap editing**: move a lap boundary, split a lap in two, or delete a lap —
  each op recomputes the affected laps' stats (distance, avg/max heart rate,
  cadence, power, speed, ascent/descent, start/end position) from the
  underlying records.
- **Change recording device**: rewrite the file's manufacturer/product
  identity (e.g. relabel as a different Garmin Edge, or another
  manufacturer entirely).
- **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) across all edits.
- **Export** the edited file back to `.fit` for re-upload to Garmin Connect,
  Strava, etc.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL and drop a `.fit` file onto the page.

## Scripts

| Command           | Purpose                                              |
| ------------------ | ----------------------------------------------------- |
| `npm run dev`      | Start the Vite dev server with HMR.                   |
| `npm run build`    | Type-check and build a production bundle to `dist/`.  |
| `npm run preview`  | Preview the production build locally.                 |
| `npm start`        | Serve `dist/` with a small Express server (`server.js`), for production-like hosting. |
| `npm test`         | Run the test suite (Vitest).                          |
| `npm run lint`     | Lint with Oxlint.                                     |

## Project structure

```
src/
  fit/            FIT decode/encode, editing operations, display helpers
    operations/   Pure model-transforming operations (laps, device identity)
  components/     React UI (map, timeline chart, lap list, toolbar, forms)
  state/          Zustand store (current model, undo/redo history)
  lib/            Small browser utilities (file download)
server.js         Minimal Express static server for the built app
```

## Tech stack

React 19, TypeScript, Vite, Zustand for state, Chart.js for the timeline,
Leaflet/react-leaflet for the map, and [`@garmin/fitsdk`](https://www.npmjs.com/package/@garmin/fitsdk)
for FIT decoding/encoding.
