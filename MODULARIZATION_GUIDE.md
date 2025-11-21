# Content.js Modularization Guide

## Current Status

The original `content.js` (6656 lines) has been partially modularized. A backup has been created as `content.js.backup`.

## What's Been Done

✅ **Created Modules:**
- `modules/config.js` - Constants, configuration, and model definitions
- `modules/models.js` - Model management and selection functions
- `modules/pageDetection.js` - Page type detection
- `modules/api.js` - Backend API communication
- `modules/README.md` - Module documentation

✅ **Updated Files:**
- `manifest.json` - Updated to load modules in correct order
- `content.js.backup` - Backup of original file

## What Still Needs to Be Done

The following functions from `content.js.backup` need to be moved to new modules:

### 1. `modules/ui.js` (UI Components)
Functions to move:
- `injectScanButton()`
- `makeContainerDraggable()`
- `makeMiniTriggerDraggable()`
- `initializeContainerCollapse()`
- `toggleContainerCollapse()`
- `collapseContainer()`
- `expandContainer()`
- `getOrCreateActionBar()`
- `ensureInfoButton()`
- `ensureInfoPopupElements()`
- `showInfoPopup()`
- `hideInfoPopup()`
- `maybeAutoShowInfoPopup()`
- `showAutoModelPopup()`
- `blockClickIfDragging()`
- `setupCollapseButtonInteraction()`
- `getMiniTrigger()`
- `applyMiniPosition()`
- `ensureMiniTrigger()`

### 2. `modules/highlighting.js` (PII Highlighting)
Functions to move:
- `highlightPiiInDocument()`
- `highlightPiiForChatGPT()`
- `createInlineHighlightsForTextarea()`
- `getTextLineSegments()`
- `createTextareaMirror()`
- `createHighlightOverlay()`
- `setupOverlayPositionUpdate()`
- `calculateTextPosition()`
- `highlightWithOverlay()`
- `createOverlayHighlight()`
- `showOverlaySuggestionPopup()`
- `acceptOverlaySuggestion()`
- `rejectOverlaySuggestion()`

### 3. `modules/textProcessing.js` (Text Processing & Faker)
Functions to move:
- `findContentArea()`
- `generateSuggestionId()`
- `getRedactionLabel()`
- `generatePIIMappingId()`
- `randomChoice()`
- `generateFakeForType()`
- `labelToType()`
- `isRedactedText()`
- `filterRedactedPII()`
- `extractSanitizedText()`
- `getSimpleTextNodesIn()`
- `clearHighlights()`
- `acceptAllPII()`
- `fillRedactions()`
- `revertLocationsAggressively()`
- `revertPIIsInDocumentBody()`
- `revertPIIsInResponse()`
- `redactPII_DescendingOrder()`
- `redactPII_AscendingOrder()`
- `removeOverlappingSpans()`
- `redactPIIWithOffsetTracking()`

### 4. `modules/chatIntegration.js` (ChatGPT/Gemini Integration)
Functions to move:
- `findChatGPTTextarea()`
- `setChatGPTInputValue()`
- `toggleChatGPTSendButton()`
- `getCurrentPromptText()`
- `getAssistantResponseSelectors()`
- `countAssistantMessages()`
- `findChatInterfaceSendButton()`
- `triggerChatInterfaceSend()`
- `waitForAssistantResponse()`

### 5. `modules/agent.js` (Agent Mode)
Functions to move:
- `isAgentSupportedPage()`
- `setExtensionMode()`
- `handleModeChange()`
- `updateModeUIState()`
- `setSendAnonymizedButtonState()`
- `showAgentToast()`
- `handleSendAnonymizedClick()`

### 6. `modules/messageDetection.js` (Message Send Detection)
Functions to move:
- `setupMessageSendDetection()`

## How to Complete the Modularization

### Step 1: Create the Remaining Module Files

Create empty module files:
```bash
touch modules/ui.js
touch modules/highlighting.js
touch modules/textProcessing.js
touch modules/chatIntegration.js
touch modules/agent.js
touch modules/messageDetection.js
```

### Step 2: Move Functions to Modules

For each module:
1. Open `content.js.backup`
2. Find the functions listed above for that module
3. Copy them to the appropriate module file
4. Update function calls to use the module namespace (e.g., `window.PIIExtension.ui.injectScanButton`)
5. Ensure dependencies on other modules are properly imported

### Step 3: Update Module Exports

Each module should export its functions to `window.PIIExtension`:
```javascript
window.PIIExtension.moduleName = {
    function1,
    function2,
    // ... etc
};
```

### Step 4: Update Function Calls

Throughout the codebase, update function calls to use the module namespace:
- `injectScanButton()` → `window.PIIExtension.ui.injectScanButton()`
- `detectPageType()` → `window.PIIExtension.pageDetection.detectPageType()`
- etc.

### Step 5: Update manifest.json

Add new modules to `manifest.json` in the correct order:
```json
"js": [
  "modules/config.js",
  "modules/models.js",
  "modules/pageDetection.js",
  "modules/textProcessing.js",
  "modules/highlighting.js",
  "modules/ui.js",
  "modules/chatIntegration.js",
  "modules/agent.js",
  "modules/messageDetection.js",
  "modules/api.js",
  "content.js"
]
```

### Step 6: Update content.js

Replace `content-modular.js` with the final `content.js` that uses all modules.

## Testing

After moving functions:
1. Test the extension in Chrome
2. Check browser console for errors
3. Verify all functionality still works
4. Fix any dependency issues

## Benefits of Modularization

- ✅ Easier to maintain and understand
- ✅ Better code organization
- ✅ Easier to test individual components
- ✅ Reduced file size (each module is manageable)
- ✅ Better collaboration (multiple developers can work on different modules)

## Notes

- The original `content.js.backup` is preserved for reference
- All modules use `window.PIIExtension` as a shared namespace
- Module dependencies are handled through the loading order in manifest.json
- Some functions may need to be refactored to remove circular dependencies

