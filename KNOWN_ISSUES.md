# Known issues in 2.1

## SVG URL references

The asset resolver can insert double quotes into already double-quoted SVG attributes, turning valid `fill="url(#gradient)"` into invalid XML. This defect was reproduced after release. A temporary workaround is to use single quotes around URL-bearing attributes, for example `fill='url(#gradient)'`. The attached 2.1 source and build retain this defect; this repository upload does not claim to fix it.

## Export fidelity

Complex SVG motion paths, path morphing, filters and browser-specific effects need visual comparison between preview, PNG and MP4. Real-time WebM may miss frame deadlines. Canvas source resolution must match the intended capture resolution to avoid upscaling blur.

## JavaScript seeking

This version calls `window.motionforgeSeek(seconds)`. If an animation defines only `window.renderAtTime`, explicitly provide an adapter: `window.motionforgeSeek = window.renderAtTime`. Enable trusted JavaScript only for code you trust.

## Stock-video quality

A 4K output dimension alone does not establish visual quality. Inspect the original export for banding, aliasing, missing effects, abrupt loops and frozen frames. Simple graphics can produce very small variable-bitrate files; file size alone is not a quality assessment. Adjustable bitrate and ProRes exports are proposed improvements, not features of this build.

## Verification

See VERIFICATION.md for historical testing. Automated import tests do not establish complete browser rendering fidelity or Windows launcher compatibility.
