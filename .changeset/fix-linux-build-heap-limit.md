---
"@nuxflow/app": patch
---

Fix Linux build OOM crash by setting NODE_OPTIONS heap limit via cross-env

Nitro's cloudflare-module bundle step exhausts the default V8 heap (~2 GB) on Linux. Added `cross-env NODE_OPTIONS=--max-old-space-size=4096` to the build script so both Linux and Windows deployments use a 4 GB heap cap without requiring a manually set environment variable.

Also adds a Linux permission error note to the installation quickstart docs.
