# Third-party components

The built UI includes html-to-image and the FFmpeg.wasm JavaScript packages. Their versions and upstream metadata are recorded in package-lock.json.

- html-to-image: MIT, https://github.com/bubkoo/html-to-image (license text included).
- @ffmpeg/ffmpeg and @ffmpeg/util: MIT, https://github.com/ffmpegwasm/ffmpeg.wasm.
- @ffmpeg/core: GPL-2.0-or-later according to the package metadata. The bundled WebAssembly FFmpeg core includes codecs such as libx264; upstream build recipes and source references are at https://github.com/ffmpegwasm/ffmpeg.wasm and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core .
- Native FFmpeg is not redistributed in this ZIP. The optional setup downloads an upstream binary separately; its upstream licenses apply.

This package is provided for local use. Before redistributing bundled FFmpeg binaries/WASM, obtain the corresponding source and comply with the upstream licenses. The optional native engine is detected from your own installation.
