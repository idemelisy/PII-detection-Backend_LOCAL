// Background service worker for PII Detection Extension
// This handles backend API requests to avoid CORS issues

// Load backend URL from backend-url.txt file
let BACKEND_BASE_URL = ''; // Default fallback

// Load backend URL from file on startup
async function loadBackendUrl() {
  try {
    const url = chrome.runtime.getURL('backend-url.txt');
    const response = await fetch(url);
    if (response.ok) {
      const text = await response.text();
      const urlFromFile = text.trim();
      if (urlFromFile && urlFromFile.startsWith('http')) {
        BACKEND_BASE_URL = urlFromFile;
        console.log('[PII Extension] Loaded backend URL from file:', BACKEND_BASE_URL);
        // Store in chrome.storage for content scripts
        chrome.storage.local.set({ backendUrl: BACKEND_BASE_URL });
      }
    }
  } catch (error) {
    console.warn('[PII Extension] Could not load backend-url.txt, using default:', error);
    chrome.storage.local.set({ backendUrl: BACKEND_BASE_URL });
  }
}

// Load URL on startup
loadBackendUrl();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkHealth') {
    fetch(`${BACKEND_BASE_URL}/health`)
      .then(response => response.json())
      .then(data => {
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('[PII Extension] Health check error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'detectPII') {
    fetch(`${BACKEND_BASE_URL}/detect-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: request.text,
        language: request.language || 'en',
        model: request.model || 'presidio'
      })
    })
      .then(response => response.json())
      .then(data => {
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('[PII Extension] PII detection error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }
});

