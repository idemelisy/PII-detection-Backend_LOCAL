// ============================================================================
// PII DETECTOR CONTENT SCRIPT - MODULAR VERSION
// ============================================================================
// This is the main entry point that initializes the PII detector
// All core functionality has been moved to modules in the modules/ directory

console.log("PII Detector Content Script Loaded! (Modular Version)");

// Global error handler to prevent crashes
window.addEventListener("error", (e) => {
    console.error("[PII Extension] Global error caught:", e.message, e.error);
    console.error("[PII Extension] Error stack:", e.error?.stack);
});

// Global unhandled promise rejection handler
window.addEventListener("unhandledrejection", (e) => {
    console.error("[PII Extension] Unhandled promise rejection:", e.reason);
    e.preventDefault(); // Prevent the default browser behavior
});

// Ensure all required modules are loaded
if (!window.PIIExtension) {
    console.error("[PII Extension] Required modules not loaded. Check manifest.json script order.");
    throw new Error("PII Extension modules not initialized");
}

// Access modules directly from window.PIIExtension (no local const declarations to avoid conflicts)
const config = window.PIIExtension.config;
const models = window.PIIExtension.models;
const pageDetection = window.PIIExtension.pageDetection;
const api = window.PIIExtension.api;

// ============================================================================
// NOTE: The following functions are still in the original content.js.backup
// They need to be moved to appropriate modules:
// 
// - UI functions (injectScanButton, makeContainerDraggable, etc.) -> modules/ui.js
// - Highlighting functions (highlightPiiInDocument, etc.) -> modules/highlighting.js
// - Text processing (extractSanitizedText, fillRedactions, etc.) -> modules/textProcessing.js
// - Chat integration (findChatGPTTextarea, setChatGPTInputValue, etc.) -> modules/chatIntegration.js
// - Agent mode (handleSendAnonymizedClick, etc.) -> modules/agent.js
// - Message detection (setupMessageSendDetection) -> modules/messageDetection.js
//
// For now, these functions remain in content.js.backup and can be moved incrementally
// ============================================================================

// Temporary: Import remaining functions from backup (to be moved to modules)
// This allows the extension to work while we complete the modularization
// TODO: Move these to appropriate modules

// Initialize the PII detector with robust DOM loading handling
function initializePiiDetector() {
    const pageType = pageDetection.detectPageType();
    console.log(`Detected page type: ${pageType}`);
    
    // Ensure document.body is available
    if (document.body) {
        // Inject scan button using UI module
        if (window.PIIExtension.ui && window.PIIExtension.ui.injectScanButton) {
            window.PIIExtension.ui.injectScanButton();
        } else {
            console.warn('[PII Extension] UI module not ready yet, will retry...');
            setTimeout(() => {
                if (window.PIIExtension.ui && window.PIIExtension.ui.injectScanButton) {
                    window.PIIExtension.ui.injectScanButton();
                }
            }, 500);
        }
        
        // Setup message send detection using messageDetection module
        if (window.PIIExtension.messageDetection && window.PIIExtension.messageDetection.setupMessageSendDetection) {
            window.PIIExtension.messageDetection.setupMessageSendDetection();
        }
        
        // Refresh backend models
        models.refreshBackendModels();
    } else {
        // Wait for body to be available
        const observer = new MutationObserver((mutations, obs) => {
            if (document.body) {
                if (window.PIIExtension.ui && window.PIIExtension.ui.injectScanButton) {
                    window.PIIExtension.ui.injectScanButton();
                }
                if (window.PIIExtension.messageDetection && window.PIIExtension.messageDetection.setupMessageSendDetection) {
                    window.PIIExtension.messageDetection.setupMessageSendDetection();
                }
                models.refreshBackendModels();
                obs.disconnect();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
}

// Wait for the page to load and then initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePiiDetector);
} else {
    // Document is already loaded
    initializePiiDetector();
}

// Fallback: also try after a delay to handle dynamic Google Docs loading
setTimeout(initializePiiDetector, 2000);

