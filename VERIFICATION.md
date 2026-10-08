# Verification — MotionForge Studio 2.1

## Passed in the build environment

- Eight additional import regression groups: incomplete SVG rejection, Markdown/comment handling, namespace repair, SVG-vs-HTML classification, all five chart examples, meaningful image errors, JS/CSS project assets and preservation of the previous project on rejected import.
- Windows launcher source no longer invokes PowerShell; browser opening is triggered after the server starts.

- Production Vite build, with local FFmpeg core JS/WASM and worker included.
- JavaScript syntax checks for app, server and setup scripts.
- Nine project/template test groups: duration inference, final birthday date for all 12 months, safe preview policy, embedded asset substitution, invalid SVG rejection, aspect ratios, V2 restoration and legacy V1 restoration and SMIL/CSS pause/seek.
- Native server integration: rejection of invalid settings, missing authentication tokens, out-of-order frames and cross-origin requests.
- Native 1280x720 H.264 export: 24 frames, 24 FPS, one-second video, yuv420p, chosen-background alpha compositing, AAC audio and job cleanup. Actual video decoded to check the background pixels.
- Native 2160x3840 portrait H.264 export: two frames, 24 FPS, correct size, frame count, duration, background and cleanup.
- Capture cancellation deletes its job; cancellation during native encoding stops its process and removes the job.

## Important boundaries

The integration tests send synthetic PNG frames directly to the local server. They verify encoding, audio, timing and cleanup, not the browser capture of an entire SVG/HTML animation.

The available test browser blocked localhost. Browser UI, actual SMIL/CSS/canvas frame capture, browser FFmpeg.wasm, WebM recording, Windows launchers, native binary download, and extended 4K/60 FPS sessions therefore need a device check. No finished Windows EXE is included.

## First device check

1. Start the supplied app, open the bar-chart example and pause/scrub/restart.
2. Load the line, donut and CSS dashboard examples and scrub them. For the Canvas graph, enable trusted scripts and use Frame render mode.
3. Export a short 720p/24 FPS MP4 and inspect beginning, movement and final hold.
4. Save/reopen a project; close/reopen to check autosave recovery.
5. Check portrait framing, PNG transparency and WebM preview.
6. Enable native FFmpeg, export with a short audio file and test Cancel during capture and encoding.
7. Increase to 4K only after a short lower-resolution export looks correct.

Development tests: `node tests/project.test.cjs` needs jsdom. The native integration script needs Python, ffmpeg/ffprobe and a running local server. These dependencies are not needed for normal app use.
