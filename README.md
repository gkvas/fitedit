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

## Byte-level export

Exports are produced by surgically patching the original file's bytes, not by
re-encoding the decoded model. This matters for two reasons, both learned the
hard way against real Garmin Edge files:

- **Garmin Connect rejects re-encoded files.** Files rebuilt with
  `@garmin/fitsdk`'s encoder are refused by Garmin Connect's importer, even
  though they pass Garmin's own published FIT SDK reference decoder (and
  every other FIT parser we tried). The original file, byte-identical,
  uploads fine.
- **Re-encoding silently loses data.** The SDK's decoder drops every message
  and field its profile doesn't know — over half the messages in a real
  Edge 840 file, including one proprietary message per track point.

So the download path (`src/fit/raw/`) indexes the raw record stream, patches
the `file_id` in place for device changes, and splices recomputed lap
messages into the device's own lap summary block for lap edits. Everything
untouched is emitted byte-for-byte as the device wrote it; a zero-edit export
is byte-identical to the input. Lap-referenced `time_in_zone` messages are
dropped when the lap layout changes, since their per-lap zone breakdown
describes boundaries that no longer exist.

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
  fit/            FIT decoding, editing operations, display helpers
    operations/   Pure model-transforming operations (laps, device identity)
    raw/          Byte-level export: record indexing, in-place patching, lap splicing
  components/     React UI (map, timeline chart, lap list, toolbar, forms)
  state/          Zustand store (original bytes + model, undo/redo history)
  lib/            Small browser utilities (file download)
server.js         Minimal Express static server for the built app
```

## Tech stack

React 19, TypeScript, Vite, Zustand for state, Chart.js for the timeline,
Leaflet/react-leaflet for the map, and [`@garmin/fitsdk`](https://www.npmjs.com/package/@garmin/fitsdk)
for FIT decoding (exports go through the byte-level path above).
