// Background service worker for PII Detection Extension
// This handles backend API requests to avoid CORS issues

const BACKEND_BASE_URL = 'https://naples-collect-industries-can.trycloudflare.com';

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

