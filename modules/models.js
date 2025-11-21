// ============================================================================
// MODELS MODULE
// ============================================================================
// Model management, selection, and backend integration

(function() {
'use strict';

// Ensure config is loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before models module');
}

const config = window.PIIExtension.config;

function getModelIcon(modelKey) {
    return config.MODEL_ICON_MAP[modelKey] || '';
}

function getBackendModelByKey(modelKey) {
    const backendModels = window.PIIExtension.getBackendModels();
    if (!modelKey || !backendModels?.length) return null;
    return backendModels.find(model => model.key === modelKey) || null;
}

function getModelDisplayName(modelKey) {
    if (!modelKey) {
        return 'Unknown Model';
    }
    const backendModel = getBackendModelByKey(modelKey);
    const modelConfig = config.MODEL_CONFIGS[modelKey];
    const baseName = backendModel?.name || modelConfig?.name || modelKey;
    return baseName.trim();
}

function formatModelOptionLabel(modelKey, { includeCurrentSuffix = false } = {}) {
    const icon = getModelIcon(modelKey);
    const baseName = modelKey === config.MODEL_AUTO
        ? (config.MODEL_CONFIGS[config.MODEL_AUTO]?.name || 'Auto Select')
        : getModelDisplayName(modelKey);
    const text = icon ? `${icon} ${baseName}` : baseName;
    return includeCurrentSuffix ? `${text} (Current)` : text;
}

function getFallbackModelList() {
    return config.DEFAULT_MODEL_KEYS.map(key => ({
        key,
        name: config.MODEL_CONFIGS[key]?.name || key
    }));
}

function getRenderableModels() {
    const backendModels = window.PIIExtension.getBackendModels();
    if (backendModels && backendModels.length > 0) {
        return backendModels;
    }
    return getFallbackModelList();
}

function normalizeBackendModels(rawModels) {
    if (!Array.isArray(rawModels)) {
        return [];
    }

    const normalized = rawModels.map(model => {
        if (!model) {
            return null;
        }

        if (typeof model === 'string') {
            return {
                key: model,
                name: config.MODEL_CONFIGS[model]?.name || model,
                builtin: false
            };
        }

        const key = model.key || model.name || model.id;
        if (!key) {
            return null;
        }

        return {
            ...model,
            key,
            name: model.name || config.MODEL_CONFIGS[key]?.name || key
        };
    }).filter(Boolean);

    const unique = [];
    const seen = new Set();
    normalized.forEach(model => {
        if (!seen.has(model.key)) {
            seen.add(model.key);
            unique.push(model);
        }
    });
    return unique;
}

function populateModelSelectOptions(selectedValue, targetSelect, modelsOverride) {
    const modelSelect = targetSelect || document.getElementById(config.MODEL_SELECT_ID);
    if (!modelSelect) return;

    const models = modelsOverride && modelsOverride.length ? modelsOverride : getRenderableModels();
    const fragment = document.createDocumentFragment();

    const autoOption = document.createElement('option');
    autoOption.value = config.MODEL_AUTO;
    autoOption.textContent = formatModelOptionLabel(config.MODEL_AUTO);
    fragment.appendChild(autoOption);

    const seenKeys = new Set();
    models.forEach(model => {
        if (!model?.key || seenKeys.has(model.key)) {
            return;
        }
        seenKeys.add(model.key);
        const option = document.createElement('option');
        option.value = model.key;
        option.textContent = formatModelOptionLabel(model.key);
        fragment.appendChild(option);
    });

    modelSelect.innerHTML = '';
    modelSelect.appendChild(fragment);

    const currentModel = window.PIIExtension.getCurrentModel();
    if (selectedValue) {
        modelSelect.value = selectedValue;
    } else if (currentModel) {
        modelSelect.value = currentModel;
    }

    Array.from(modelSelect.options).forEach(option => {
        const isCurrent = option.value === modelSelect.value;
        if (option.value === config.MODEL_AUTO) {
            option.textContent = formatModelOptionLabel(option.value, { includeCurrentSuffix: isCurrent });
        } else {
            option.textContent = formatModelOptionLabel(option.value, { includeCurrentSuffix: isCurrent });
        }
    });
}

function updateModelStatusIndicator(modelKey) {
    const statusEl = document.getElementById(config.MODEL_STATUS_ID);
    if (!statusEl) return;

    if (!modelKey) {
        statusEl.textContent = 'Last run: pending...';
        return;
    }

    const label = getModelDisplayName(modelKey);
    statusEl.textContent = `Last run: ${label}`;
}

function getSelectedLanguage() {
    const languageSelect = document.getElementById('pii-language-select');
    const value = languageSelect?.value;
    return (value && value.trim()) || 'en';
}

function saveModelSelection(modelKey) {
    try {
        localStorage.setItem(config.MODEL_STORAGE_KEY, modelKey);
    } catch (error) {
        console.warn('[PII Extension] Unable to persist model selection to localStorage:', error);
    }

    if (chrome?.storage?.sync) {
        try {
            chrome.storage.sync.set({ [config.MODEL_STORAGE_KEY]: modelKey }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('[PII Extension] chrome.storage.sync set error:', chrome.runtime.lastError.message);
                }
            });
        } catch (error) {
            console.warn('[PII Extension] Unable to persist model selection to chrome.storage.sync:', error);
        }
    }
}

function loadModelSelectionFromLocal() {
    try {
        const value = localStorage.getItem(config.MODEL_STORAGE_KEY);
        return value || null;
    } catch (error) {
        console.warn('[PII Extension] Unable to read model selection from localStorage:', error);
        return null;
    }
}

function readModelSelectionFromChromeSync() {
    return new Promise(resolve => {
        if (!chrome?.storage?.sync) {
            resolve(null);
            return;
        }
        try {
            chrome.storage.sync.get([config.MODEL_STORAGE_KEY], result => {
                if (chrome.runtime.lastError) {
                    console.warn('[PII Extension] chrome.storage.sync get error:', chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                resolve(result?.[config.MODEL_STORAGE_KEY] || null);
            });
        } catch (error) {
            console.warn('[PII Extension] Unable to access chrome.storage.sync:', error);
            resolve(null);
        }
    });
}

async function getStoredModelSelection(defaultModelKey) {
    const syncValue = await readModelSelectionFromChromeSync();
    if (syncValue) {
        return syncValue;
    }
    const localValue = loadModelSelectionFromLocal();
    if (localValue) {
        return localValue;
    }
    return defaultModelKey;
}

async function refreshBackendModels() {
    try {
        console.log('[PII Extension] Refreshing backend models...');
        // Use getter function to get current backend URL (may have been updated from file)
        const healthUrl = window.PIIExtension.getBackendHealthUrl ? window.PIIExtension.getBackendHealthUrl() : config.BACKEND_HEALTH_URL;
        const response = await fetch(healthUrl, { method: 'GET' });
        if (!response.ok) {
            throw new Error(`Health endpoint responded with ${response.status}`);
        }
        const data = await response.json();
        const fetchedModels = normalizeBackendModels(data?.models);
        const models = fetchedModels.length ? fetchedModels : getFallbackModelList();
        window.PIIExtension.setBackendModels(models);

        const currentModel = window.PIIExtension.getCurrentModel();
        const defaultModel = data?.default_model || models[0]?.key || currentModel || 'presidio';
        console.log(`[PII Extension] Backend default_model: "${data?.default_model}", first model key: "${models[0]?.key}", currentModel: "${currentModel}"`);
        const storedSelection = await getStoredModelSelection(defaultModel);
        const selectedModel = storedSelection || defaultModel;
        console.log(`[PII Extension] Selected model after refresh: "${selectedModel}" (stored: "${storedSelection}", default: "${defaultModel}")`);
        window.PIIExtension.setCurrentModel(selectedModel);
        const lastResolved = selectedModel === config.MODEL_AUTO ? defaultModel : selectedModel;
        window.PIIExtension.setLastResolvedModel(lastResolved);

        populateModelSelectOptions(selectedModel, undefined, models);
        updateModelStatusIndicator(lastResolved || selectedModel);
        console.log('[PII Extension] Backend models loaded:', models.map(m => m.key));
    } catch (error) {
        console.warn('[PII Extension] Failed to load backend models, using fallback list:', error);
        const fallbackModels = getFallbackModelList();
        window.PIIExtension.setBackendModels(fallbackModels);
        const currentModel = window.PIIExtension.getCurrentModel();
        const storedSelection = await getStoredModelSelection(currentModel);
        if (storedSelection) {
            window.PIIExtension.setCurrentModel(storedSelection);
        }
        populateModelSelectOptions(storedSelection || currentModel, undefined, fallbackModels);
        const lastResolved = window.PIIExtension.getLastResolvedModel();
        updateModelStatusIndicator(lastResolved || currentModel);
    }
}

function analyzePromptForModel(promptText) {
    const text = (promptText || '').trim();
    if (!text) {
        return {
            model: 'presidio',
            reason: 'No prompt detected, falling back to Presidio.'
        };
    }

    const lower = text.toLowerCase();
    const digits = (text.match(/\d/g) || []).length;
    const letters = (text.match(/[a-zA-Z]/g) || []).length;
    const numericRatio = digits / Math.max(letters, 1);
    const hasTimePattern = /\b\d{1,2}:\d{2}\s?(am|pm)?\b/i.test(text) || /\b\d{1,2}(am|pm)\b/i.test(text);
    const hasDatePattern = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(text);
    const hasReferenceId = /\b[A-Z]{2,}\d{3,}\b/.test(text);

    const addressKeywords = ['street', 'st.', 'avenue', 'ave', 'road', 'rd', 'boulevard', 'blvd', 'drive', 'dr', 'lane', 'ln', 'suite', 'ste', 'apt', 'apartment', 'building', 'floor', 'zip', 'zipcode', 'postal', 'po box', 'mile', 'km', 'kilometer', 'highway'];
    const hasAddressKeyword = addressKeywords.some(keyword => lower.includes(keyword));
    const hasZipCode = /\b\d{5}(?:-\d{4})?\b/.test(text);
    const hasRelativeLocation = /\b(north|south|east|west|across from|next to|nearby|opposite)\b/i.test(text);

    const hyphenatedNames = /\b[A-Z][a-z]+-[A-Z][a-z]+\b/.test(text);
    const cityKeywords = ['city', 'town', 'village', 'province', 'county', 'district', 'borough', 'municipality'];
    const hasCityKeyword = cityKeywords.some(keyword => lower.includes(keyword));
    const hasListOfPlaces = (text.match(/\b[A-Z][a-z]{2,}\b/g) || []).length >= 6 && text.includes(',');

    const westernNameMatches = text.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || [];
    const hasManyWesternNames = westernNameMatches.length >= 3;
    const provinceSignals = /\bprovince|prefecture|county|state\b/i.test(lower);

    if (hasAddressKeyword || hasZipCode || hasRelativeLocation) {
        return {
            model: 'nemo',
            reason: 'Detected address-like keywords and locations suited for NeMo.'
        };
    }

    if (numericRatio > 0.25 || hasTimePattern || hasDatePattern || hasReferenceId) {
        return {
            model: 'ai4privacy',
            reason: 'Prompt is dominated by numeric or timestamp patterns, ideal for AI4Privacy.'
        };
    }

    if (hyphenatedNames || hasCityKeyword || hasListOfPlaces) {
        return {
            model: 'piranha',
            reason: 'Found city/town references or hyphenated surnames where Piranha excels.'
        };
    }

    if (hasManyWesternNames || provinceSignals) {
        return {
            model: 'bdmbz',
            reason: 'Multiple Western-style person/province patterns detected, matching BDMBZ strengths.'
        };
    }

    return {
        model: 'presidio',
        reason: 'Balanced prompt – defaulting to Presidio for reliable coverage.'
    };
}

function getLastModelName() {
    const lastResolved = window.PIIExtension.getLastResolvedModel();
    const currentModel = window.PIIExtension.getCurrentModel();
    return getModelDisplayName(lastResolved || currentModel);
}

function handleModelChange(event) {
    const selectedModel = event.target.value;
    const previousModel = window.PIIExtension.getCurrentModel();
    window.PIIExtension.setCurrentModel(selectedModel);
    saveModelSelection(selectedModel);
    
    console.log(`[PII Extension] Model changed from "${previousModel}" to "${selectedModel}"`);
    
    // Update the dropdown text to show current model
    const modelSelect = document.getElementById(config.MODEL_SELECT_ID);
    if (modelSelect) {
        Array.from(modelSelect.options).forEach(option => {
            const isCurrent = option.value === selectedModel;
            option.textContent = formatModelOptionLabel(option.value, { includeCurrentSuffix: isCurrent });
        });
    }
    
    const modelConfig = config.MODEL_CONFIGS[selectedModel];
    if (selectedModel === config.MODEL_AUTO) {
        // If switching to auto mode, analyze current prompt if available
        const pageType = window.PIIExtension.pageDetection.detectPageType();
        if (pageType === 'chatgpt' || pageType === 'gemini') {
            const chatIntegration = window.PIIExtension.chatIntegration;
            if (chatIntegration && chatIntegration.getCurrentPromptText) {
                const { text } = chatIntegration.getCurrentPromptText();
                if (text && text.trim()) {
                    const autoChoice = analyzePromptForModel(text);
                    const autoName = getModelDisplayName(autoChoice.model);
                    window.PIIExtension.setLastResolvedModel(autoChoice.model);
                    window.PIIExtension.setLastAutoReason(autoChoice.reason);
                    updateModelStatusIndicator(autoChoice.model);
                    console.log(`[PII Extension] Auto-selected "${autoChoice.model}" for current prompt: ${autoChoice.reason}`);
                }
            }
        }
    } else {
        // Not auto mode - use selected model directly
        window.PIIExtension.setLastResolvedModel(selectedModel);
        updateModelStatusIndicator(selectedModel);
    }
}

// Export to global namespace
window.PIIExtension.models = {
    getModelIcon,
    getBackendModelByKey,
    getModelDisplayName,
    formatModelOptionLabel,
    getFallbackModelList,
    getRenderableModels,
    normalizeBackendModels,
    populateModelSelectOptions,
    updateModelStatusIndicator,
    getSelectedLanguage,
    saveModelSelection,
    loadModelSelectionFromLocal,
    readModelSelectionFromChromeSync,
    getStoredModelSelection,
    refreshBackendModels,
    analyzePromptForModel,
    getLastModelName,
    handleModelChange
};

})(); // End IIFE
