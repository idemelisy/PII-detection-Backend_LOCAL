# PII Extension Modules

This directory contains the modularized version of the PII Extension content script.

## Module Structure

The original `content.js` (6656 lines) has been split into the following modules:

1. **config.js** - Constants, configuration values, and model definitions
2. **models.js** - Model management, selection, and backend integration
3. **pageDetection.js** - Page type detection utilities
4. **textProcessing.js** - Text extraction, redaction, and faker library
5. **highlighting.js** - PII highlighting functions
6. **ui.js** - UI components (scan button, container, popups, draggable elements)
7. **chatIntegration.js** - ChatGPT/Gemini specific functions
8. **agent.js** - Agent mode functionality
9. **messageDetection.js** - Message send detection
10. **api.js** - Backend API calls
11. **content.js** - Main entry point (initialization)

## Loading Order

Modules must be loaded in this order (as specified in manifest.json):
1. config.js
2. models.js
3. pageDetection.js
4. textProcessing.js
5. highlighting.js
6. ui.js
7. chatIntegration.js
8. agent.js
9. messageDetection.js
10. api.js
11. content.js

## Global Namespace

All modules use `window.PIIExtension` as a shared namespace to avoid global variable pollution and enable inter-module communication.

## Migration Status

⚠️ **Work in Progress**: The modularization is partially complete. Some functions may still need to be moved from the original content.js to the appropriate modules.

