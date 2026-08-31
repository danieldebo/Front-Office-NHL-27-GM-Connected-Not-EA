---
name: Front-office test environment
description: The environment split between front-office browser tests and the workflow Vite config.
---

Front-office browser tests use a standalone Vitest configuration rather than importing the app's Vite configuration.

**Why:** The app Vite config intentionally requires `PORT` and `BASE_PATH`, which are injected by managed workflows and are not present during ordinary test runs.

**How to apply:** Keep test-only configuration independent of workflow startup settings; run the app build with managed workflow variables or through the artifact workflow.