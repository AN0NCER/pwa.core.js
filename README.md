# PWA Core

The module is actively used and tested in production within the [Tunime](https://an0ncer.github.io/) project — a PWA anime streaming platform with offline capabilities.

A lightweight, reusable module for managing Service Workers, app updates, and version metadata in Progressive Web Applications (PWA). Designed for use in multiple projects as a drop-in standard.

## Features

- ✅ Service Worker registration and unregistration
- 🔄 App update detection and version handling
- 💾 Local metadata management (version, hash, date)
- 🔌 Event system for custom triggers
- 🧩 Messaging bridge between page and Service Worker

## Files

- `pwa.core.js` — Main controller for versioning, SW management, and messaging
- `worker.js` — Base Service Worker file for caching and activation

## Installation

Just copy `pwa.core.js` and `worker.js` into your project and import the core module:

```html
<script src="pwa.core.js" type="module"></script>
```
