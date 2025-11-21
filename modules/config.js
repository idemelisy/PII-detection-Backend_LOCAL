// ============================================================================
// CONFIGURATION MODULE
// ============================================================================
// Contains all constants, configuration values, and model definitions

// Global namespace for sharing state between modules
window.PIIExtension = window.PIIExtension || {};

// Highlighting class (must synchronize with style.css)
const HIGHLIGHT_CLASS = 'pii-highlight'; 
const REDACT_BTN_CLASS = 'pii-redact-btn';
const SUGGESTION_POPUP_CLASS = 'pii-suggestion-popup';
const REJECTED_CLASS = 'pii-rejected';

// Track suggestion states
const suggestionStates = new Map(); // Store accept/reject decisions

// Current selected model for PII detection
let currentModel = 'presidio'; // Default model (now using real Presidio backend)

const MODEL_STORAGE_KEY = 'piiModelKey';
let backendModels = [];

// Backend API configuration
// Will be loaded from backend-url.txt file (see initialization below)
let BACKEND_ORIGIN = 'https://settled-tribes-gray-resume.trycloudflare.com'; // Default fallback
let BACKEND_API_URL = `${BACKEND_ORIGIN}/detect-pii`;
let BACKEND_HEALTH_URL = `${BACKEND_ORIGIN}/health`;

// Load backend URL from chrome.storage (populated by background.js)
async function loadBackendUrlFromStorage() {
  try {
    if (chrome.storage && chrome.storage.local) {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['backendUrl'], resolve);
      });
      if (result.backendUrl) {
        BACKEND_ORIGIN = result.backendUrl;
        BACKEND_API_URL = `${BACKEND_ORIGIN}/detect-pii`;
        BACKEND_HEALTH_URL = `${BACKEND_ORIGIN}/health`;
        // Update exported config object
        window.PIIExtension.config.BACKEND_ORIGIN = BACKEND_ORIGIN;
        window.PIIExtension.config.BACKEND_API_URL = BACKEND_API_URL;
        window.PIIExtension.config.BACKEND_HEALTH_URL = BACKEND_HEALTH_URL;
        console.log('[PII Extension] Loaded backend URL from storage:', BACKEND_ORIGIN);
      } else {
        // Try to load directly from file as fallback
        try {
          const url = chrome.runtime.getURL('backend-url.txt');
          const response = await fetch(url);
          if (response.ok) {
            const text = await response.text();
            const urlFromFile = text.trim();
            if (urlFromFile && urlFromFile.startsWith('http')) {
              BACKEND_ORIGIN = urlFromFile;
              BACKEND_API_URL = `${BACKEND_ORIGIN}/detect-pii`;
              BACKEND_HEALTH_URL = `${BACKEND_ORIGIN}/health`;
              // Update exported config object
              window.PIIExtension.config.BACKEND_ORIGIN = BACKEND_ORIGIN;
              window.PIIExtension.config.BACKEND_API_URL = BACKEND_API_URL;
              window.PIIExtension.config.BACKEND_HEALTH_URL = BACKEND_HEALTH_URL;
              console.log('[PII Extension] Loaded backend URL from file:', BACKEND_ORIGIN);
            }
          }
        } catch (fileError) {
          console.warn('[PII Extension] Could not load backend-url.txt, using default URL');
        }
      }
    }
  } catch (error) {
    console.warn('[PII Extension] Could not load backend URL from storage, using default:', error);
  }
}

// Load backend URL immediately (but don't block - it's async)
loadBackendUrlFromStorage();

// Model configurations with different mock data sets
const MODEL_AUTO = 'auto';

const DEFAULT_MODEL_KEYS = [
    'piranha',
    'presidio',
    'ai4privacy',
    'bdmbz',
    'dbmdz/bert-large-cased-finetuned-conll03-english',
    'nemo'
];

const MODEL_CONFIGS = {
    piranha: {
        name: "Piranha",
        description: "Fast and aggressive PII detection",
        accuracy: "High"
    },
    presidio: {
        name: "Presidio", 
        description: "Microsoft's PII detection engine",
        accuracy: "Very High"
    },
    ai4privacy: {
        name: "AI4Privacy",
        description: "Privacy-focused detection model",
        accuracy: "High"
    },
    bdmbz: {
        name: "BDMBZ",
        description: "Lightning-fast detection",
        accuracy: "Medium"
    },
    "dbmdz/bert-large-cased-finetuned-conll03-english": {
        name: "dbmdz/bert-large-cased-finetuned-conll03-english",
        description: "HuggingFace NER model",
        accuracy: "High"
    },
    nemo: {
        name: "NEMO",
        description: "Precision-targeted detection",
        accuracy: "Very High"
    },
    auto: {
        name: "Auto Select",
        description: "Adaptive selector",
        accuracy: "Dynamic"
    }
};

const MODEL_ICON_MAP = {
    [MODEL_AUTO]: '🤖',
    presidio: '🛡️',
    ai4privacy: '🔒',
    piranha: '🐟',
    bdmbz: '⚡',
    nemo: '🎯',
    "dbmdz/bert-large-cased-finetuned-conll03-english": '⚡'
};

const MODE_CONTROL = 'control';
const MODE_AGENT = 'agent';

const MODEL_SELECT_ID = 'pii-model-select';
const MODEL_STATUS_ID = 'pii-model-status';
let extensionMode = localStorage.getItem('pii-extension-mode') === MODE_AGENT ? MODE_AGENT : MODE_CONTROL;
let agentPipelineState = {
    running: false,
    awaitingResponse: false,
    justSent: false
};
let lastResolvedModel = currentModel;
let lastAutoReason = '';

const INFO_POPUP_STORAGE_KEY = 'pii-info-popup-hidden';
const INFO_POPUP_AUTO_FLAG = '__piiInfoPopupAutoShown';

// Helper function to get current backend URL (for dynamic access)
window.PIIExtension.getBackendOrigin = () => BACKEND_ORIGIN;
window.PIIExtension.getBackendApiUrl = () => BACKEND_API_URL;
window.PIIExtension.getBackendHealthUrl = () => BACKEND_HEALTH_URL;

// Export to global namespace
window.PIIExtension.config = {
    HIGHLIGHT_CLASS,
    REDACT_BTN_CLASS,
    SUGGESTION_POPUP_CLASS,
    REJECTED_CLASS,
    suggestionStates,
    currentModel,
    MODEL_STORAGE_KEY,
    backendModels,
    BACKEND_ORIGIN,
    BACKEND_API_URL,
    BACKEND_HEALTH_URL,
    MODEL_AUTO,
    DEFAULT_MODEL_KEYS,
    MODEL_CONFIGS,
    MODEL_ICON_MAP,
    MODE_CONTROL,
    MODE_AGENT,
    MODEL_SELECT_ID,
    MODEL_STATUS_ID,
    extensionMode,
    agentPipelineState,
    lastResolvedModel,
    lastAutoReason,
    INFO_POPUP_STORAGE_KEY,
    INFO_POPUP_AUTO_FLAG
};

// Export getters/setters for mutable values
window.PIIExtension.getCurrentModel = () => currentModel;
window.PIIExtension.setCurrentModel = (model) => { currentModel = model; };
window.PIIExtension.getBackendModels = () => backendModels;
window.PIIExtension.setBackendModels = (models) => { backendModels = models; };
window.PIIExtension.getExtensionMode = () => extensionMode;
window.PIIExtension.setExtensionMode = (mode) => { extensionMode = mode; };
window.PIIExtension.getAgentPipelineState = () => agentPipelineState;
window.PIIExtension.getLastResolvedModel = () => lastResolvedModel;
window.PIIExtension.setLastResolvedModel = (model) => { lastResolvedModel = model; };
window.PIIExtension.getLastAutoReason = () => lastAutoReason;
window.PIIExtension.setLastAutoReason = (reason) => { lastAutoReason = reason; };
window.PIIExtension.getSuggestionStates = () => suggestionStates;

