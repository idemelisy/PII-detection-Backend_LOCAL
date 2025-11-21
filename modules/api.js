// ============================================================================
// API MODULE
// ============================================================================
// Backend API communication functions

(function() {
'use strict';

// Ensure required modules are loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before api module');
}
if (!window.PIIExtension || !window.PIIExtension.models) {
    console.error('[PII Extension] Models module must be loaded before api module');
}

const config = window.PIIExtension.config;
const models = window.PIIExtension.models;

// Check if backend is available using background script (avoids CORS issues)
async function checkBackendHealth() {
    try {
        console.log("[PII Extension] Checking backend health via background script...");
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.warn("[PII Extension] Health check timed out");
                resolve(false);
            }, 5000);
            
            chrome.runtime.sendMessage(
                { action: 'checkHealth' },
                (response) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError) {
                        console.warn("[PII Extension] Background script error:", chrome.runtime.lastError.message);
                        resolve(false);
                        return;
                    }
                    
                    if (response && response.success) {
                        const data = response.data;
                        console.log("[PII Extension] Health check response:", data);
                        const hasModels = Array.isArray(data?.models) && data.models.length > 0;
                        if (hasModels) {
                            const normalized = models.normalizeBackendModels(data.models);
                            window.PIIExtension.setBackendModels(normalized);
                            const currentModel = window.PIIExtension.getCurrentModel();
                            models.populateModelSelectOptions(currentModel, undefined, normalized);
                        }
                        const isHealthy = data.status === 'healthy' && (hasModels || data.default_model);
                        if (!hasModels && data.default_model && window.PIIExtension.getBackendModels().length === 0) {
                            const fallbackModels = [data.default_model].map(key => ({
                                key,
                                name: config.MODEL_CONFIGS[key]?.name || key
                            }));
                            window.PIIExtension.setBackendModels(fallbackModels);
                            const currentModel = window.PIIExtension.getCurrentModel();
                            models.populateModelSelectOptions(currentModel, undefined, fallbackModels);
                        }
                        console.log("[PII Extension] Backend is healthy:", isHealthy);
                        resolve(isHealthy);
                    } else {
                        console.warn("[PII Extension] Health check failed:", response?.error);
                        resolve(false);
                    }
                }
            );
        });
    } catch (error) {
        console.warn("[PII Extension] Backend health check failed:", error.message || error);
        return false;
    }
}

// Call backend API to detect PII using background script (avoids CORS issues)
async function detectPIIFromBackend(text, model = 'presidio') {
    try {
        console.log(`[PII Extension] Calling backend API for PII detection via background script (model: ${model})...`);
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Request timed out. The text might be too long or the server is slow."));
            }, 30000);
            
            const selectedLanguage = models.getSelectedLanguage();
            const payload = {
                text,
                language: selectedLanguage,
                ...(model && model !== config.MODEL_AUTO ? { model } : {})
            };
            
            chrome.runtime.sendMessage(
                {
                    action: 'detectPII',
                    ...payload
                },
                (response) => {
                    clearTimeout(timeout);
                    
                    if (chrome.runtime.lastError) {
                        console.error("[PII Extension] Background script error:", chrome.runtime.lastError.message);
                        reject(new Error("Cannot connect to backend server. Please ensure the server is running."));
                        return;
                    }
                    
                    if (response && response.success) {
                        const data = response.data;
                        console.log(`[PII Extension] Backend detected ${data.total_entities} PII entities`);
                        if (data?.model_key || data?.model_used) {
                            console.log('Backend model used:', data.model_key || data.model_used);
                        }
                        resolve(data);
                    } else {
                        const errorMsg = response?.error || "Unknown error";
                        console.error("[PII Extension] Backend API error:", errorMsg);
                        reject(new Error(errorMsg));
                    }
                }
            );
        });
    } catch (error) {
        console.error("[PII Extension] Error calling backend API:", error.message || error);
        throw error;
    }
}

// Export to global namespace
window.PIIExtension.api = {
    checkBackendHealth,
    detectPIIFromBackend
};

})(); // End IIFE

