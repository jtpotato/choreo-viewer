# Choreo Viewer

A static, browser-only choreography video viewer built with Next.js, React, and TypeScript. The production export is served from `/choreo-viewer/` so it can be deployed independently under a larger site.

## Run locally

```sh
bun install
bun run dev
```

Open `http://localhost:3000/choreo-viewer/`.

## Build and deploy

```sh
bun run build
```

Next.js writes the static site to `out/`. Deploy the contents of that directory at the `/choreo-viewer/` path. The `basePath` in `next.config.ts` controls both the route and generated asset URLs.

## Local media and settings

Video files are read through the browser's file picker and played from a temporary object URL. There is no upload or server-side media processing. Practice settings are saved in `localStorage` under a key derived from the file's name, size, modification time, and SHA-256 digest of small samples from the beginning and end of the file. The full video is never read into memory for the fingerprint. The Songs menu stores file handles in IndexedDB on browsers that support persistent file access; it stores the song list, not video bytes. On iOS Safari, choose a listed video again after a page reload. Private browsing or cleared site data may remove saved settings and library entries.

Tempo detection analyzes a silent copy of the selected video. Playback always uses the visible video's native audio and video stream. It estimates one tempo and phase, then stores the resulting beat and bar times with that video's local settings. If no pulse is found, enter the BPM manually. Pinch zoom is left to the browser's native page behavior.

## Stack

- Next.js App Router with static export
- React and strict TypeScript
- Bun package management
- No backend, API routes, analytics, or media uploads
