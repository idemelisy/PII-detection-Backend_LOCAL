// ============================================================================
// HIGHLIGHTING MODULE
// ============================================================================
// PII highlighting, scanning, and suggestion popup functions

(function() {
'use strict';

// Ensure required modules are loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before highlighting module');
}
if (!window.PIIExtension || !window.PIIExtension.pageDetection) {
    console.error('[PII Extension] PageDetection module must be loaded before highlighting module');
}
if (!window.PIIExtension || !window.PIIExtension.textProcessing) {
    console.error('[PII Extension] TextProcessing module must be loaded before highlighting module');
}
if (!window.PIIExtension || !window.PIIExtension.chatIntegration) {
    console.error('[PII Extension] ChatIntegration module must be loaded before highlighting module');
}
if (!window.PIIExtension || !window.PIIExtension.api) {
    console.error('[PII Extension] API module must be loaded before highlighting module');
}
if (!window.PIIExtension || !window.PIIExtension.models) {
    console.error('[PII Extension] Models module must be loaded before highlighting module');
}
if (!window.PIIExtension || !window.PIIExtension.ui) {
    console.warn('[PII Extension] UI module not yet loaded - will retry when needed');
}

const config = window.PIIExtension.config;
const pageDetection = window.PIIExtension.pageDetection;
const textProcessing = window.PIIExtension.textProcessing;
const chatIntegration = window.PIIExtension.chatIntegration;
const api = window.PIIExtension.api;
const models = window.PIIExtension.models;
// Access ui lazily since it might not be ready yet
const getUI = () => window.PIIExtension.ui;

// Handles the Scan button click event
async function handleScanClick() {
  try {
    console.log("[PII Extension] Scan initiated...");
    
    const pageType = pageDetection.detectPageType();
    
    // Disable send button during scanning if on ChatGPT or Gemini
    if (pageType === 'chatgpt' || pageType === 'gemini') {
      if (pageType === 'chatgpt') {
        chatIntegration.toggleChatGPTSendButton(false);
      }
      // For Gemini, we don't modify the send button to avoid breaking the UI
    }
    
    // Clear previous highlights silently before starting new scan
    try {
      clearHighlights(false);
    } catch (clearError) {
      console.error("[PII Extension] Error clearing highlights:", clearError);
    }
    
    // CRITICAL: Clear PII mappings when starting a new scan to prevent reusing old fake data
    // This ensures each new prompt gets fresh mappings and doesn't inherit data from previous prompts
    if (window.piiMapping) {
      const oldSize = window.piiMapping.size;
      window.piiMapping.clear();
      console.log(`[PII Extension] Cleared ${oldSize} old PII mappings to start fresh scan`);
    }
    
    const promptContext = chatIntegration.getCurrentPromptText(pageType);
    const editor = promptContext.editor;
    if (!editor) {
      // Re-enable send button if scan fails
      if (pageType === 'chatgpt') {
        try {
          chatIntegration.toggleChatGPTSendButton(true);
        } catch (buttonError) {
          console.error("[PII Extension] Error re-enabling send button after scan failure:", buttonError);
        }
      }
      return;
    }
    
    const textToAnalyze = promptContext.text;
    
    if (!textToAnalyze.trim()) {
      if (pageType === 'chatgpt') {
        try {
          chatIntegration.toggleChatGPTSendButton(true);
        } catch (buttonError) {
          console.error("[PII Extension] Error re-enabling send button:", buttonError);
        }
      }
      return;
    }
    
    // Resolve model (auto mode inspects the prompt)
    const currentMode = window.PIIExtension.getExtensionMode();
    let currentModel = window.PIIExtension.getCurrentModel();
    console.log(`[PII Extension] Current model selection: "${currentModel}"`);
    let resolvedModel = currentModel;
    let lastAutoReason = '';
    if (currentModel === config.MODEL_AUTO) {
        const autoChoice = models.analyzePromptForModel(textToAnalyze);
        resolvedModel = autoChoice.model;
        lastAutoReason = autoChoice.reason;
        console.log(`[PII Extension] Auto-selected model: "${resolvedModel}" - Reason: ${lastAutoReason}`);
        const autoName = models.getModelDisplayName(resolvedModel);
        console.log(`[PII Extension] Auto-selected model "${resolvedModel}": ${lastAutoReason}`);
        if (getUI()) {
            getUI().showAutoModelPopup(autoName, lastAutoReason, 'Auto Model Selected');
        }
    }
    window.PIIExtension.setLastResolvedModel(resolvedModel);
    
    // Show loading indicator
    const scanButton = document.getElementById("pii-scan-button");
    const originalButtonText = scanButton ? scanButton.innerHTML : '';
    if (scanButton) {
      scanButton.innerHTML = `<span role="img" aria-label="Loading">⏳</span> Scanning...`;
      scanButton.disabled = true;
    }
    
    let piiResults;
    try {
      // Try to use backend API first
      const backendAvailable = await api.checkBackendHealth();
      
      if (backendAvailable) {
        console.log(`[PII Extension] Backend available, using model "${resolvedModel}" via API...`);
        piiResults = await api.detectPIIFromBackend(textToAnalyze, resolvedModel);
      } else {
        console.warn("[PII Extension] Backend unavailable - no fallback available");
        piiResults = {
          "has_pii": false,
          "detected_entities": [],
          "total_entities": 0,
          "model_used": resolvedModel,
          "model_key": resolvedModel,
          "confidence_threshold": 0.8
        };
      }
    } catch (error) {
      console.error("[PII Extension] Error detecting PII:", error);
      piiResults = {
        "has_pii": false,
        "detected_entities": [],
        "total_entities": 0,
        "model_used": resolvedModel,
        "model_key": resolvedModel,
        "confidence_threshold": 0.8
      };
    } finally {
      // Restore button
      if (scanButton) {
        scanButton.innerHTML = originalButtonText;
        scanButton.disabled = false;
      }
    }

    const backendModelKey = piiResults?.model_key || piiResults?.model_used || resolvedModel;
    if (backendModelKey) {
        window.PIIExtension.setLastResolvedModel(backendModelKey);
        console.log(`[PII Extension] Backend used model "${backendModelKey}" for this scan.`);
        models.updateModelStatusIndicator(backendModelKey);
    } else {
        window.PIIExtension.setLastResolvedModel(resolvedModel);
        models.updateModelStatusIndicator(resolvedModel);
    }
    
    // Process results and highlight
    if (piiResults && piiResults.detected_entities && piiResults.detected_entities.length > 0) {
        const modelName = models.getLastModelName();
        
        // Don't show alert here - let the highlighting function show the final count
        // This ensures consistency between detected and actually highlighted items
        try {
          highlightPiiInDocument(piiResults.detected_entities);
        } catch (highlightError) {
          console.error("[PII Extension] Error highlighting PII:", highlightError);
        }
        
        // Re-enable send button after highlighting is complete
        if (pageType === 'chatgpt') {
          setTimeout(() => {
            try {
              chatIntegration.toggleChatGPTSendButton(true);
            } catch (buttonError) {
              console.error("[PII Extension] Error re-enabling send button after highlighting:", buttonError);
            }
          }, 500);
        }
    } else {
        const modelName = models.getLastModelName();
        
        // Re-enable send button if no PII found
        if (pageType === 'chatgpt') {
          try {
            chatIntegration.toggleChatGPTSendButton(true);
          } catch (buttonError) {
            console.error("[PII Extension] Error re-enabling send button after no PII found:", buttonError);
          }
        }
    }
  } catch (error) {
    console.error("[PII Extension] Critical error in handleScanClick:", error);
    
    // Always try to re-enable send button in case of errors
    try {
      const pageType = pageDetection.detectPageType();
      if (pageType === 'chatgpt') {
        chatIntegration.toggleChatGPTSendButton(true);
      }
      // Restore button
      const scanButton = document.getElementById("pii-scan-button");
      if (scanButton) {
        scanButton.innerHTML = `<span role="img" aria-label="Shield">🛡️</span> Scan for PII`;
        scanButton.disabled = false;
      }
    } catch (buttonError) {
      console.error("[PII Extension] Error re-enabling send button after critical error:", buttonError);
    }
  }
}

// The core function to highlight PII using safe regex-based HTML replacement
function highlightPiiInDocument(entities) {
    const pageType = pageDetection.detectPageType();
    
    // CRITICAL: For ChatGPT and Gemini, use special approach that only highlights in input field
    if (pageType === 'chatgpt' || pageType === 'gemini') {
        console.log(`[PII Extension] Using ${pageType === 'gemini' ? 'Gemini' : 'ChatGPT'}-safe highlighting approach`);
        highlightPiiForChatGPT(entities);
        return;
    }
    
    // Original approach for other platforms
    const editor = textProcessing.findContentArea();
    if (!editor) {
        console.warn("Cannot highlight PII: Content area not found");
        return;
    }

    console.log("Starting regex-based PII highlighting process...");
    console.log("Editor element:", editor);

    let highlightCount = 0;

    // Check if editor HTML already contains highlights to avoid nested highlighting
    if (editor.innerHTML.includes(config.HIGHLIGHT_CLASS)) {
        console.log("Editor already contains highlights, clearing first...");
        clearHighlights(false);
    }

    // Get the current HTML content
    let currentHTML = editor.innerHTML;
    console.log("Original HTML length:", currentHTML.length);

    // Sort entities by length (longest first) to avoid partial matches
    const sortedEntities = entities.sort((a, b) => b.value.length - a.value.length);
    
    sortedEntities.forEach(entity => {
        console.log(`Processing PII: "${entity.value}" (${entity.type})`);
        
        // Escape special regex characters in the entity value
        const escapedValue = entity.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Create regex with word boundaries for exact matching
        // Use \b for word boundaries, but make it flexible for non-English characters
        const regex = new RegExp(`(?<!<[^>]*)(${escapedValue})(?![^<]*>)`, 'gi');
        
        // Create the highlight HTML structure with suggestion functionality
        const highlightHTML = `<span class="${config.HIGHLIGHT_CLASS}" data-pii-type="${entity.type}" data-pii-value="${entity.value}" data-suggestion-id="${textProcessing.generateSuggestionId()}">$1</span>`;
        
        // Count matches before replacement
        const matches = currentHTML.match(regex);
        const matchCount = matches ? matches.length : 0;
        
        if (matchCount > 0) {
            console.log(`Found ${matchCount} instances of "${entity.value}"`);
            
            // Perform the replacement
            currentHTML = currentHTML.replace(regex, highlightHTML);
            highlightCount += matchCount;
            
            console.log(`✅ Highlighted ${matchCount} instances of "${entity.value}"`);
        } else {
            console.log(`❌ No instances found for "${entity.value}"`);
        }
    });

    // Apply the modified HTML back to the editor
    if (highlightCount > 0) {
        try {
            editor.innerHTML = currentHTML;
            console.log(`Successfully applied highlights. Total: ${highlightCount} instances`);
            
            // Add click events to the newly created highlight spans
            addRedactEvents();
            
            // Show consistent message with model name
            const modelName = models.getLastModelName();
            const totalDetected = entities.length;
        } catch (error) {
            console.error("Error applying HTML changes:", error);
            
            // Fallback to overlay system if HTML modification fails
            console.log("HTML modification failed, falling back to overlay system...");
            highlightWithOverlay(entities);
        }
    } else {
        console.warn("No PII could be highlighted with regex method");
        
        // Check if PII exists in the text content at all
        const textContent = editor.textContent || editor.innerText || '';
        const foundInText = entities.some(entity => 
            textContent.toLowerCase().includes(entity.value.toLowerCase())
        );
        
        if (foundInText) {
            console.log("PII found in text but not highlighted, trying overlay system...");
            highlightWithOverlay(entities);
        }
    }
}

// Clear all highlights and redactions
function clearHighlights(showAlert = true) {
    try {
        const pageType = pageDetection.detectPageType();
        const isChatGPTOrGemini = pageType === 'chatgpt' || pageType === 'gemini';
        
        // For ChatGPT/Gemini, clear textarea overlays
        if (isChatGPTOrGemini) {
            // Remove all textarea overlay highlights
            document.querySelectorAll('.pii-textarea-overlay').forEach(el => {
                if (el._updatePosition) {
                    window.removeEventListener('scroll', el._updatePosition, true);
                    window.removeEventListener('resize', el._updatePosition);
                }
                el.remove();
            });
            
            // Remove any suggestion popups
            document.querySelectorAll('.pii-suggestion-popup').forEach(popup => {
                popup.remove();
            });
            
            // Clear stored data
            delete window.chatGPTOriginalText;
            delete window.chatGPTFoundPII;
            delete window.chatGPTTextarea;
            
            // Clear PII mappings to prevent reusing old fake data from previous prompts
            if (window.piiMapping) {
                const oldSize = window.piiMapping.size;
                window.piiMapping.clear();
                console.log(`[PII Extension] Cleared ${oldSize} PII mappings when clearing highlights`);
            }
            
            console.log("[PII Extension] Cleared ChatGPT/Gemini highlights");
            return;
        }
        
        // Clear regular highlights by replacing HTML
        const editor = textProcessing.findContentArea();
        let highlightedElements = [];
        let redactedElements = [];
        let textHighlightCount = 0;
        
        if (editor) {
            try {
                // Find highlighted spans
                highlightedElements = editor.querySelectorAll(`.${config.HIGHLIGHT_CLASS}`);
                textHighlightCount = highlightedElements.length;
                
                // Find redacted spans
                redactedElements = editor.querySelectorAll('.pii-redacted');
                
                // Replace highlights with original text safely
                if (textHighlightCount > 0) {
                    highlightedElements.forEach((el, index) => {
                        try {
                            if (el.parentNode && el.parentNode.nodeType === Node.ELEMENT_NODE) {
                                const textNode = document.createTextNode(el.textContent);
                                el.parentNode.replaceChild(textNode, el);
                            }
                        } catch (error) {
                            console.error(`[PII Extension] Error clearing highlight ${index}:`, error);
                        }
                    });
                }
                
                // Replace redacted items with original text safely
                if (redactedElements.length > 0) {
                    redactedElements.forEach((el, index) => {
                        try {
                            if (el.parentNode && el.parentNode.nodeType === Node.ELEMENT_NODE) {
                                const originalValue = el.getAttribute('data-original-value') || el.textContent;
                                const textNode = document.createTextNode(originalValue);
                                el.parentNode.replaceChild(textNode, el);
                            }
                        } catch (error) {
                            console.error(`[PII Extension] Error clearing redacted element ${index}:`, error);
                        }
                    });
                }
            } catch (error) {
                console.error("[PII Extension] Error processing editor elements:", error);
            }
        }
        
        // Clear overlay highlights safely
        try {
            const overlayElements = document.querySelectorAll('.pii-overlay-highlight');
            overlayElements.forEach((el, index) => {
                try {
                    if (el.parentNode) {
                        el.remove();
                    }
                } catch (error) {
                    console.error(`[PII Extension] Error removing overlay ${index}:`, error);
                }
            });
        } catch (error) {
            console.error("[PII Extension] Error clearing overlays:", error);
        }
        
        // Clear textarea overlay highlights (for Gemini/ChatGPT)
        try {
            const textareaOverlays = document.querySelectorAll('.pii-textarea-overlay');
            textareaOverlays.forEach((el, index) => {
                try {
                    if (el._updatePosition) {
                        window.removeEventListener('scroll', el._updatePosition, true);
                    }
                    if (el.parentNode) {
                        el.remove();
                    }
                } catch (error) {
                    console.error(`[PII Extension] Error removing textarea overlay ${index}:`, error);
                }
            });
        } catch (error) {
            console.error("[PII Extension] Error clearing textarea overlays:", error);
        }
        
        // Clear any open suggestion popups safely
        try {
            document.querySelectorAll(`.${config.SUGGESTION_POPUP_CLASS}`).forEach((popup, index) => {
                try {
                    if (popup.parentNode) {
                        popup.remove();
                    }
                } catch (error) {
                    console.error(`[PII Extension] Error removing popup ${index}:`, error);
                }
            });
        } catch (error) {
            console.error("[PII Extension] Error clearing popups:", error);
        }
        
        // Reset suggestion states
        const suggestionStates = window.PIIExtension.getSuggestionStates();
        if (suggestionStates) {
            suggestionStates.clear();
        }
        
        const totalCleared = textHighlightCount + redactedElements.length;
        
        console.log(`[PII Extension] Cleared ${totalCleared} elements successfully`);
    } catch (error) {
        console.error("[PII Extension] Critical error in clearHighlights:", error);
    }
}

// Accept all detected PII suggestions automatically
function acceptAllPII() {
    try {
        console.log("[PII Extension] Accept All PII initiated...");
        
        const pageType = pageDetection.detectPageType();
        
        // CRITICAL: For ChatGPT/Gemini, use special non-DOM approach
        if (pageType === 'chatgpt' || pageType === 'gemini') {
            acceptAllPIIForChatGPT();
            return;
        }
        
        // Disable send button during processing if on ChatGPT
        if (pageType === 'chatgpt') {
            chatIntegration.toggleChatGPTSendButton(false);
        }
        
        // Get all highlighted PII elements that haven't been processed yet
        const piiHighlights = document.querySelectorAll('.pii-highlight');
        const overlayElements = document.querySelectorAll('[data-pii-overlay]');
        
        let acceptedCount = 0;
        
        // Process regular text highlights safely
        piiHighlights.forEach((highlight, index) => {
            try {
                const piiType = highlight.getAttribute('data-pii-type');
                const piiValue = highlight.getAttribute('data-pii-value');
                
                if (piiType && piiValue) {
                    // Replace with redaction label directly
                    const redactionLabel = textProcessing.getRedactionLabel(piiType);
                    const redactedSpan = document.createElement('span');
                    redactedSpan.textContent = redactionLabel;
                    redactedSpan.style.cssText = `
                        background-color: #22D3EE;
                        color: black;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-weight: bold;
                        font-size: 12px;
                    `;
                    redactedSpan.setAttribute('data-original-value', piiValue);
                    redactedSpan.setAttribute('data-pii-type', piiType);
                    redactedSpan.classList.add('pii-redacted');
                    
                    // IMPORTANT: Only replace if parent exists and is safe to modify
                    if (highlight.parentNode && highlight.parentNode.nodeType === Node.ELEMENT_NODE) {
                        highlight.parentNode.replaceChild(redactedSpan, highlight);
                        acceptedCount++;
                    } else {
                        console.warn(`[PII Extension] Cannot safely replace highlight ${index}`);
                    }
                }
            } catch (error) {
                console.error(`[PII Extension] Error processing highlight ${index}:`, error);
            }
        });
        
        // Process overlay elements safely
        overlayElements.forEach((overlay, index) => {
            try {
                const piiType = overlay.getAttribute('data-pii-type');
                const piiValue = overlay.getAttribute('data-pii-value');
                
                if (piiType && piiValue) {
                    // Change overlay to show it's redacted
                    const redactionLabel = textProcessing.getRedactionLabel(piiType);
                    overlay.style.backgroundColor = 'rgba(34, 211, 238, 0.9)';
                    overlay.style.border = '2px solid #22D3EE';
                    overlay.innerHTML = `<span style="color: black; font-weight: bold; font-size: 12px; padding: 2px; display: flex; align-items: center; justify-content: center; height: 100%;">${redactionLabel}</span>`;
                    overlay.onclick = null; // Remove click handler
                    overlay.style.cursor = 'default';
                    overlay.title = `Redacted ${piiType}: ${piiValue}`;
                    acceptedCount++;
                }
            } catch (error) {
                console.error(`[PII Extension] Error processing overlay ${index}:`, error);
            }
        });
        
        // Clear any open suggestion popups safely
        try {
            const existingPopup = document.getElementById('pii-suggestion-popup');
            if (existingPopup && existingPopup.parentNode) {
                existingPopup.remove();
            }
        } catch (error) {
            console.error("[PII Extension] Error removing popup:", error);
        }
        
        console.log(`[PII Extension] Accept All completed. ${acceptedCount} PII elements processed.`);
    } catch (error) {
        console.error("[PII Extension] Critical error in acceptAllPII:", error);
    }
}

// ChatGPT/Gemini-specific highlighting that shows inline highlights in the input field
function highlightPiiForChatGPT(entities) {
    try {
        const pageType = pageDetection.detectPageType();
        const isGemini = pageType === 'gemini';
        
        // Use the enhanced textarea finder
        const textareaResult = chatIntegration.findChatGPTTextarea();
        
        if (!textareaResult || !textareaResult.textarea) {
            return;
        }
        
        const textarea = textareaResult.textarea;
        // CRITICAL: Always extract text the same way and normalize it consistently
        let originalText = textareaResult.text;
        
        // Normalize text immediately to ensure consistent encoding
        if (originalText) {
            originalText = originalText.normalize('NFC');
        }
        
        // If textareaResult.text is empty, try direct extraction with normalization
        if (!originalText || !originalText.trim()) {
            const directText = textarea.value || textarea.textContent || textarea.innerText || '';
            originalText = directText.normalize('NFC');
        }
        
        console.log(`[PII Extension] Found input field with selector: ${textareaResult.selector}`);
        
        if (!originalText || !originalText.trim()) {
            console.warn(`[PII Extension] No text found in ${isGemini ? 'Gemini' : 'ChatGPT'} input field`);
            return;
        }
        
        console.log(`[PII Extension] Analyzing ${isGemini ? 'Gemini' : 'ChatGPT'} input field text for PII (${originalText.length} characters, normalized)...`);
        
        // First, filter out any PII that overlaps with already-redacted text
        const filteredEntities = textProcessing.filterRedactedPII(entities, originalText);
        console.log(`[PII Extension] Filtered ${entities.length - filteredEntities.length} PII entities that overlap with redacted text`);
        
        // Find PII in the text by searching for each entity value in the current text
        const foundPII = [];
        filteredEntities.forEach(entity => {
            // Get entity value - try 'value' first, then 'text', then extract from text
            let entityValue = entity.value || entity.text;
            if (!entityValue && entity.start !== undefined && entity.end !== undefined) {
                entityValue = originalText.substring(entity.start, entity.end);
            }
            
            // Skip if we still don't have a value
            if (!entityValue || typeof entityValue !== 'string') {
                console.warn("[PII Extension] Skipping entity without valid value:", entity);
                return;
            }
            
            const entityType = entity.type;
            
            // Normalize both text and entity value for better matching
            const normalizedText = originalText.normalize('NFC');
            const normalizedEntityValue = entityValue.normalize('NFC');
            
            // Use multiple search strategies for robustness
            let occurrences = [];
            
            // Strategy 1: Exact case-insensitive search
            const lowerText = normalizedText.toLowerCase();
            const lowerEntityValue = normalizedEntityValue.toLowerCase();
            let searchIndex = 0;
            
            while (true) {
                const foundIndex = lowerText.indexOf(lowerEntityValue, searchIndex);
                if (foundIndex === -1) break;
                
                // Get the actual text at this position
                const actualText = normalizedText.substring(foundIndex, foundIndex + normalizedEntityValue.length);
                
                // Verify it matches (case-insensitive, normalized)
                if (actualText.toLowerCase() === lowerEntityValue) {
                    // Check if this position is already redacted
                    if (!textProcessing.isRedactedText(normalizedText, foundIndex, foundIndex + normalizedEntityValue.length)) {
                        // Check if we already have this occurrence (avoid duplicates)
                        const isDuplicate = occurrences.some(occ => 
                            occ.start === foundIndex && occ.end === foundIndex + normalizedEntityValue.length
                        );
                        
                        if (!isDuplicate) {
                            occurrences.push({
                                start: foundIndex,
                                end: foundIndex + normalizedEntityValue.length,
                                value: actualText
                            });
                        }
                    }
                }
                
                searchIndex = foundIndex + 1;
            }
            
            // Strategy 2: If not found, try regex search (more flexible)
            if (occurrences.length === 0) {
                try {
                    // Escape special regex characters
                    const escapedEntity = normalizedEntityValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(escapedEntity, 'gi');
                    const matches = [...normalizedText.matchAll(regex)];
                    
                    matches.forEach(match => {
                        const foundIndex = match.index;
                        const actualText = match[0];
                        
                        // Check if this position is already redacted
                        if (!textProcessing.isRedactedText(normalizedText, foundIndex, foundIndex + actualText.length)) {
                            occurrences.push({
                                start: foundIndex,
                                end: foundIndex + actualText.length,
                                value: actualText
                            });
                        }
                    });
                } catch (e) {
                    console.warn(`[PII Extension] Regex search failed for "${entityValue}":`, e);
                }
            }
            
            // Strategy 3: If still not found, try using backend's original offsets as fallback
            if (occurrences.length === 0 && entity.start !== undefined && entity.end !== undefined) {
                const backendStart = entity.start;
                const backendEnd = entity.end;
                
                if (backendStart >= 0 && backendEnd <= normalizedText.length && backendEnd > backendStart) {
                    const textAtBackendOffset = normalizedText.substring(backendStart, backendEnd);
                    
                    // Check if the text at backend offset matches (case-insensitive)
                    if (textAtBackendOffset.toLowerCase() === lowerEntityValue) {
                        // Backend offset is still valid
                        if (!textProcessing.isRedactedText(normalizedText, backendStart, backendEnd)) {
                            occurrences.push({
                                start: backendStart,
                                end: backendEnd,
                                value: textAtBackendOffset
                            });
                            console.log(`[PII Extension] Found PII "${entityValue}" using backend offset ${backendStart}-${backendEnd}`);
                        }
                    }
                }
            }
            
            // Add all found occurrences as separate PII entities
            occurrences.forEach(occurrence => {
                foundPII.push({
                    type: entityType,
                    start: occurrence.start,
                    end: occurrence.end,
                    value: occurrence.value,
                    confidence: entity.confidence || 0.9
                });
                console.log(`[PII Extension] Found PII "${occurrence.value}" at ${occurrence.start}-${occurrence.end}`);
            });
        });
        
        if (foundPII.length === 0) {
            return;
        }
        
        // Store the original text and PII info for later use
        window.chatGPTOriginalText = originalText;
        window.chatGPTFoundPII = foundPII;
        window.chatGPTTextarea = textarea;
        
        // Create inline overlay highlights for each PII item
        createInlineHighlightsForTextarea(textarea, foundPII, originalText);
        
        // Show consistent info message with model name
        const modelName = models.getLastModelName() || 'Presidio';
        const totalDetected = entities.length;
        const totalHighlighted = foundPII.length;
        
    } catch (error) {
        console.error("[PII Extension] Error in chat interface PII analysis:", error);
    }
}

// ChatGPT/Gemini-specific accept all function
function acceptAllPIIForChatGPT() {
    try {
        const pageType = pageDetection.detectPageType();
        const isGemini = pageType === 'gemini';
        
        // Use stored textarea reference if available, otherwise try to find it
        let textarea = window.chatGPTTextarea;
        if (!textarea) {
            const textareaSelectors = [
                'textarea[aria-label*="prompt"]',
                'textarea[aria-label*="message"]',
                'textarea[placeholder*="prompt"]',
                'textarea[placeholder*="message"]',
                'textarea[contenteditable="true"]',
                'div[contenteditable="true"][role="textbox"]',
                'textarea'
            ];
            
            for (const selector of textareaSelectors) {
                textarea = document.querySelector(selector);
                if (textarea) break;
            }
        }
        
        if (!textarea || !window.chatGPTOriginalText || !window.chatGPTFoundPII) {
            console.warn(`[PII Extension] ${isGemini ? 'Gemini' : 'ChatGPT'} data not available for redaction`);
            return;
        }
        
        // CRITICAL: Extract text the same way as during scanning to ensure consistency
        let currentText = '';
        
        // Try to get text the same way findChatGPTTextarea does
        if (textarea.value) {
            currentText = textarea.value;
        } else if (textarea.textContent) {
            currentText = textarea.textContent;
        } else if (textarea.innerText) {
            currentText = textarea.innerText;
        } else if (window.chatGPTOriginalText) {
            currentText = window.chatGPTOriginalText;
        }
        
        // Normalize text immediately to ensure consistent encoding
        const normalizedCurrentText = currentText.normalize('NFC');
        const normalizedOriginalText = (window.chatGPTOriginalText || '').normalize('NFC');
        
        console.log(`[PII Extension] Text extraction for accept: value=${textarea.value?.length || 0}, textContent=${textarea.textContent?.length || 0}, using length=${normalizedCurrentText.length}`);
        console.log(`[PII Extension] Stored original text length: ${normalizedOriginalText.length}`);
        
        // Check if text has changed (compare normalized versions)
        const textUnchanged = normalizedCurrentText === normalizedOriginalText;
        
        // Find actual positions of PII in current text
        const spans = [];
        const lowerText = normalizedCurrentText.toLowerCase();
        const addedSpans = new Set(); // Track added spans to avoid duplicates
        
        window.chatGPTFoundPII.forEach(pii => {
            const piiValue = pii.value;
            // Normalize PII value for matching
            const normalizedPiiValue = piiValue.normalize('NFC');
            const lowerPiiValue = normalizedPiiValue.toLowerCase();
            let foundOccurrences = [];
            
            // Strategy 1: If text hasn't changed, use stored positions directly
            if (textUnchanged && pii.start !== undefined && pii.end !== undefined) {
                const storedStart = pii.start;
                const storedEnd = pii.end;
                
                // Verify the stored position is still valid
                if (storedStart >= 0 && storedEnd <= normalizedCurrentText.length) {
                    const textAtStoredPos = normalizedCurrentText.substring(storedStart, storedEnd);
                    if (textAtStoredPos.toLowerCase() === lowerPiiValue && 
                        !textProcessing.isRedactedText(normalizedCurrentText, storedStart, storedEnd)) {
                        foundOccurrences.push({
                            start: storedStart,
                            end: storedEnd,
                            value: textAtStoredPos
                        });
                    }
                }
            }
            
            // Strategy 2: If not found or text changed, search for all occurrences with normalization
            if (foundOccurrences.length === 0) {
                let searchIndex = 0;
                while (true) {
                    const foundIndex = lowerText.indexOf(lowerPiiValue, searchIndex);
                    if (foundIndex === -1) break;
                    
                    // Get the actual text at this position (from normalized text)
                    const actualText = normalizedCurrentText.substring(foundIndex, foundIndex + normalizedPiiValue.length);
                    
                    // Verify it matches (case-insensitive, normalized) and is not already redacted
                    if (actualText.toLowerCase() === lowerPiiValue) {
                        if (!textProcessing.isRedactedText(normalizedCurrentText, foundIndex, foundIndex + normalizedPiiValue.length)) {
                            foundOccurrences.push({
                                start: foundIndex,
                                end: foundIndex + normalizedPiiValue.length,
                                value: actualText
                            });
                        }
                    }
                    
                    searchIndex = foundIndex + 1;
                }
            }
            
            // Strategy 3: If still not found, try regex search (more flexible for special characters)
            if (foundOccurrences.length === 0) {
                try {
                    // Escape special regex characters
                    const escapedEntity = normalizedPiiValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(escapedEntity, 'gi');
                    const matches = [...normalizedCurrentText.matchAll(regex)];
                    
                    matches.forEach(match => {
                        const foundIndex = match.index;
                        const actualText = match[0];
                        
                        if (!textProcessing.isRedactedText(normalizedCurrentText, foundIndex, foundIndex + actualText.length)) {
                            foundOccurrences.push({
                                start: foundIndex,
                                end: foundIndex + actualText.length,
                                value: actualText
                            });
                        }
                    });
                } catch (e) {
                    console.warn(`[PII Extension] Regex search failed for "${piiValue}":`, e);
                }
            }
            
            // Strategy 4: If still not found, try using stored position as hint (text might have shifted slightly)
            if (foundOccurrences.length === 0 && pii.start !== undefined && pii.end !== undefined) {
                const storedStart = pii.start;
                const storedEnd = pii.end;
                
                // Search in a window around the stored position (±50 chars)
                const searchWindow = 50;
                const searchStart = Math.max(0, storedStart - searchWindow);
                const searchEnd = Math.min(normalizedCurrentText.length, storedEnd + searchWindow);
                const windowText = normalizedCurrentText.substring(searchStart, searchEnd);
                const lowerWindowText = windowText.toLowerCase();
                
                const foundIndex = lowerWindowText.indexOf(lowerPiiValue);
                if (foundIndex !== -1) {
                    const actualStart = searchStart + foundIndex;
                    const actualEnd = actualStart + normalizedPiiValue.length;
                    const actualText = normalizedCurrentText.substring(actualStart, actualEnd);
                    
                    if (actualText.toLowerCase() === lowerPiiValue && 
                        !textProcessing.isRedactedText(normalizedCurrentText, actualStart, actualEnd)) {
                        foundOccurrences.push({
                            start: actualStart,
                            end: actualEnd,
                            value: actualText
                        });
                    }
                }
            }
            
            // Add all found occurrences to spans
            foundOccurrences.forEach(occurrence => {
                const spanKey = `${occurrence.start}-${occurrence.end}`;
                if (!addedSpans.has(spanKey)) {
                    spans.push({
                        start: occurrence.start,
                        end: occurrence.end,
                        entity: {
                            type: pii.type,
                            value: occurrence.value
                        }
                    });
                    addedSpans.add(spanKey);
                    console.log(`[PII Extension] Adding PII "${occurrence.value}" (${pii.type}) at ${occurrence.start}-${occurrence.end}`);
                }
            });
        });
        
        if (spans.length === 0) {
            return;
        }
        
        // Remove overlapping spans to prevent offset calculation errors
        const nonOverlappingSpans = textProcessing.removeOverlappingSpans(spans);
        
        if (nonOverlappingSpans.length === 0) {
            return;
        }
        
        // Sort spans by start position (required for offset tracking)
        nonOverlappingSpans.sort((a, b) => a.start - b.start);
        
        // Create mask function
        const maskFor = (entity) => {
            return textProcessing.getRedactionLabel(entity.type);
        };
        
        // Use the new offset tracking system to redact all PII
        const result = textProcessing.redactPIIWithOffsetTracking(normalizedCurrentText, nonOverlappingSpans, maskFor);
        
        console.log(`[PII Extension] Redacted ${nonOverlappingSpans.length} PII items using offset tracking system`);
        
        // Store mappings for original PII -> masked version (for future fake data filling)
        if (!window.piiMapping) {
            window.piiMapping = new Map();
        }
        nonOverlappingSpans.forEach((span, index) => {
            const mappingId = textProcessing.generatePIIMappingId();
            const maskedLabel = textProcessing.getRedactionLabel(span.entity.type);
            const mapping = {
                id: mappingId,
                original: span.entity.value,
                masked: maskedLabel,
                fake: null,
                type: span.entity.type,
                position: span.start,
                timestamp: Date.now()
            };
            
            window.piiMapping.set(mappingId, mapping);
            console.log(`[PII Extension] Pre-stored mapping for future fill: ${mapping.original} -> ${mapping.masked}`);
        });
        
        // Update input field safely (works for both ChatGPT and Gemini)
        const success = chatIntegration.setChatGPTInputValue(result.text, textarea);
        if (success) {
            // Remove all overlays
            document.querySelectorAll('.pii-textarea-overlay').forEach(el => {
                if (el._updatePosition) {
                    window.removeEventListener('scroll', el._updatePosition, true);
                    window.removeEventListener('resize', el._updatePosition);
                }
                el.remove();
            });
        }
        
    } catch (error) {
        console.error("[PII Extension] Error in chat interface accept all:", error);
    }
}

// Adds click listeners to the highlighted PII spans for suggestions
function addRedactEvents() {
    document.querySelectorAll(`.${config.HIGHLIGHT_CLASS}`).forEach(el => {
        // Skip if already processed or rejected
        if (el.classList.contains(config.REJECTED_CLASS)) return;
        
        el.onclick = (event) => {
            event.stopPropagation(); // Prevents interference with page editor
            showSuggestionPopup(el);
        };
        
        // Add hover effect
        el.style.cursor = 'pointer';
        el.title = 'Click to review PII suggestion';
    });
}

// Create inline highlights for textarea (ChatGPT/Gemini)
function createInlineHighlightsForTextarea(textarea, entities, text) {
    // Remove any existing highlights first
    document.querySelectorAll('.pii-textarea-overlay').forEach(el => {
        if (el._updatePosition) {
            window.removeEventListener('scroll', el._updatePosition, true);
            window.removeEventListener('resize', el._updatePosition);
        }
        el.remove();
    });
    
    const textareaRect = textarea.getBoundingClientRect();
    const textareaStyle = window.getComputedStyle(textarea);
    
    // Sort entities by position
    const sortedEntities = entities.sort((a, b) => a.start - b.start);
    
    sortedEntities.forEach((entity, index) => {
        try {
            // Use new robust positioning method
            const lineSegments = getTextLineSegments(textarea, text, entity.start, entity.end, textareaRect, textareaStyle);
            
            if (lineSegments.length === 0) {
                console.warn(`[PII Extension] Could not find line segments for "${entity.value}"`);
                return;
            }
            
            // Create a highlight overlay for each line segment
            lineSegments.forEach((segment, segIndex) => {
                const overlay = createHighlightOverlay(segment, entity, textareaRect, textareaStyle, segIndex === 0);
                
                // Store reference to entity for click handling
                overlay._entity = entity;
                overlay._allSegments = lineSegments;
                overlay._segmentIndex = segIndex;
                
                document.body.appendChild(overlay);
                
                // Setup position update handler
                setupOverlayPositionUpdate(overlay, textarea, entity, text, textareaRect, textareaStyle);
            });
            
            console.log(`[PII Extension] Created ${lineSegments.length} overlay(s) for "${entity.value}"`);
        } catch (error) {
            console.error(`[PII Extension] Error creating overlay for entity ${index}:`, error);
        }
    });
    
    console.log(`[PII Extension] Created highlights for ${sortedEntities.length} entities`);
}

// Get line segments for text that may wrap across multiple lines
function getTextLineSegments(textarea, fullText, start, end, textareaRect, textareaStyle) {
    const segments = [];
    
    // Validate indices
    if (start < 0 || end < start || end > fullText.length) {
        console.warn(`[PII Extension] Invalid indices: start=${start}, end=${end}, textLength=${fullText.length}`);
        return segments;
    }
    
    // Create a perfect mirror of the textarea
    const mirror = createTextareaMirror(textarea, textareaRect, textareaStyle);
    document.body.appendChild(mirror);
    
    try {
        const textBefore = fullText.substring(0, start);
        const entityText = fullText.substring(start, end);
        const textAfter = fullText.substring(end);
        
        // Build mirror content with text nodes
        mirror.innerHTML = '';
        const beforeNode = textBefore ? document.createTextNode(textBefore) : null;
        const entityNode = document.createTextNode(entityText);
        const afterNode = textAfter ? document.createTextNode(textAfter) : null;
        
        if (beforeNode) mirror.appendChild(beforeNode);
        mirror.appendChild(entityNode);
        if (afterNode) mirror.appendChild(afterNode);
        
        // Force layout calculation
        void mirror.offsetHeight;
        
        // Use Range API to get precise positions
        const range = document.createRange();
        const fontSize = parseFloat(textareaStyle.fontSize) || 14;
        const lineHeightValue = parseFloat(textareaStyle.lineHeight) || fontSize * 1.2;
        
        try {
            // Set range to exactly cover the entity text
            range.setStart(entityNode, 0);
            range.setEnd(entityNode, entityText.length);
            
            // Get all client rects (one per line for wrapped text)
            const rangeRects = range.getClientRects();
            
            if (rangeRects.length === 0) {
                // Fallback: use bounding rect
                const boundingRect = range.getBoundingClientRect();
                if (boundingRect.width > 0 && boundingRect.height > 0) {
                    segments.push({
                        left: boundingRect.left,
                        top: boundingRect.top,
                        width: boundingRect.width,
                        height: boundingRect.height
                    });
                }
            } else {
                // Process each rect (each represents a line segment)
                for (let i = 0; i < rangeRects.length; i++) {
                    const rect = rangeRects[i];
                    
                    // Only add valid rects
                    if (rect.width > 0 && rect.height > 0) {
                        segments.push({
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                            height: rect.height
                        });
                    }
                }
                
                // If we got multiple rects but they're on the same line, merge them
                if (segments.length > 1) {
                    const merged = [];
                    let current = null;
                    
                    segments.forEach(seg => {
                        if (!current || Math.abs(seg.top - current.top) > lineHeightValue * 0.3) {
                            // New line
                            if (current) merged.push(current);
                            current = { ...seg };
                        } else {
                            // Same line - extend width
                            current.width = seg.left + seg.width - current.left;
                            current.height = Math.max(current.height, seg.height);
                        }
                    });
                    
                    if (current) merged.push(current);
                    return merged;
                }
            }
        } catch (e) {
            console.warn('[PII Extension] Range API error, using fallback:', e);
            // Fallback: use entity node's bounding rect
            const entityRect = entityNode.parentElement ? 
                entityNode.parentElement.getBoundingClientRect() : 
                mirror.getBoundingClientRect();
            
            if (entityRect.width > 0) {
                segments.push({
                    left: entityRect.left,
                    top: entityRect.top,
                    width: entityRect.width,
                    height: entityRect.height || lineHeightValue
                });
            }
        }
        
    } finally {
        // Clean up mirror
        try {
            document.body.removeChild(mirror);
        } catch (e) {
            console.warn('[PII Extension] Error removing mirror:', e);
        }
    }
    
    return segments;
}

// Create a perfect mirror of the textarea for measurement
function createTextareaMirror(textarea, textareaRect, textareaStyle) {
    const mirror = document.createElement('div');
    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.wordBreak = textareaStyle.wordBreak || 'normal';
    mirror.style.fontSize = textareaStyle.fontSize;
    mirror.style.fontFamily = textareaStyle.fontFamily;
    mirror.style.fontWeight = textareaStyle.fontWeight;
    mirror.style.fontStyle = textareaStyle.fontStyle;
    mirror.style.letterSpacing = textareaStyle.letterSpacing;
    mirror.style.lineHeight = textareaStyle.lineHeight;
    mirror.style.width = textareaRect.width + 'px';
    mirror.style.padding = textareaStyle.padding;
    mirror.style.border = textareaStyle.border;
    mirror.style.boxSizing = 'border-box';
    mirror.style.overflow = 'visible';
    mirror.style.left = textareaRect.left + 'px';
    mirror.style.top = textareaRect.top + 'px';
    mirror.style.zIndex = '-9999';
    return mirror;
}

// Create a single highlight overlay element
function createHighlightOverlay(segment, entity, textareaRect, textareaStyle, isFirstSegment) {
    const overlay = document.createElement('div');
    overlay.className = 'pii-textarea-overlay';
    overlay.setAttribute('data-pii-type', entity.type);
    overlay.setAttribute('data-pii-value', entity.value);
    overlay.setAttribute('data-pii-start', entity.start);
    overlay.setAttribute('data-pii-end', entity.end);
    overlay.setAttribute('data-suggestion-id', textProcessing.generateSuggestionId());
    
    // Ensure segment is within textarea bounds
    let left = Math.max(segment.left, textareaRect.left);
    let top = Math.max(segment.top, textareaRect.top);
    let width = Math.min(segment.width, textareaRect.right - left);
    let height = Math.max(segment.height, 16);
    
    // Ensure minimum dimensions
    width = Math.max(width, 20);
    
    overlay.style.position = 'fixed';
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    overlay.style.width = width + 'px';
    overlay.style.height = height + 'px';
    overlay.style.backgroundColor = 'rgba(251, 191, 36, 0.6)';
    overlay.style.border = '2px solid #F59E0B';
    overlay.style.borderRadius = '3px';
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'pointer';
    overlay.style.zIndex = '999999';
    overlay.style.boxSizing = 'border-box';
    overlay.style.transition = 'all 0.2s ease';
    overlay.style.overflow = 'hidden';
    
    // Hover effects
    overlay.onmouseenter = () => {
        overlay.style.backgroundColor = 'rgba(251, 191, 36, 0.9)';
    };
    overlay.onmouseleave = () => {
        overlay.style.backgroundColor = 'rgba(251, 191, 36, 0.6)';
    };
    
    // Click handler - use the first segment's entity for the popup
    overlay.onclick = (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (isFirstSegment && overlay._entity) {
            showTextareaSuggestionPopup(overlay, overlay._entity);
        }
    };
    
    overlay.title = `Click to review ${entity.type}: "${entity.value}"`;
    
    return overlay;
}

// Setup position update handler for overlay
function setupOverlayPositionUpdate(overlay, textarea, entity, originalText, textareaRect, textareaStyle) {
    const updatePosition = () => {
        try {
            const currentText = textarea.value || textarea.textContent || originalText;
            const newRect = textarea.getBoundingClientRect();
            
            // Recalculate segments if text hasn't changed much
            if (Math.abs(currentText.length - originalText.length) < 10) {
                const segments = getTextLineSegments(textarea, currentText, entity.start, entity.end, newRect, textareaStyle);
                
                if (segments.length > 0 && overlay._segmentIndex < segments.length) {
                    const segment = segments[overlay._segmentIndex];
                    
                    let left = Math.max(segment.left, newRect.left);
                    let top = Math.max(segment.top, newRect.top);
                    let width = Math.min(segment.width, newRect.right - left);
                    let height = Math.max(segment.height, 16);
                    
                    width = Math.max(width, 20);
                    
                    overlay.style.left = left + 'px';
                    overlay.style.top = top + 'px';
                    overlay.style.width = width + 'px';
                    overlay.style.height = height + 'px';
                }
            }
        } catch (e) {
            console.warn('[PII Extension] Error updating overlay position:', e);
        }
    };
    
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    overlay._updatePosition = updatePosition;
}

// Overlay highlighting system for protected content areas
function highlightWithOverlay(entities) {
    console.log("Starting overlay highlighting system...");
    
    // Remove any existing overlays
    document.querySelectorAll('.pii-overlay-highlight').forEach(el => el.remove());
    
    let highlightCount = 0;
    
    // Sort entities by length (longest first)
    const sortedEntities = entities.sort((a, b) => b.value.length - a.value.length);
    
    sortedEntities.forEach(entity => {
        console.log(`Looking for "${entity.value}" to overlay highlight...`);
        
        // Find all text nodes in the document
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent;
            const lowerText = text.toLowerCase();
            const lowerEntity = entity.value.toLowerCase();
            
            let index = lowerText.indexOf(lowerEntity);
            
            // Try normalized search if exact fails
            if (index === -1) {
                const normalizedText = lowerText.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const normalizedEntity = lowerEntity.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                index = normalizedText.indexOf(normalizedEntity);
            }
            
            if (index !== -1) {
                const parent = node.parentElement;
                if (parent && isElementVisible(parent)) {
                    const rect = getTextPosition(parent, text, index, entity.value.length);
                    if (rect) {
                        createOverlayHighlight(rect, entity);
                        highlightCount++;
                        console.log(`✅ Created overlay for "${entity.value}"`);
                        break; // Only highlight first occurrence
                    }
                }
            }
        }
    });
    
    if (highlightCount > 0) {
        console.log(`Successfully created ${highlightCount} overlay highlights`);
    }
}

// Check if an element is visible on screen
function isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && 
           rect.top >= 0 && rect.left >= 0 && 
           rect.bottom <= window.innerHeight && 
           rect.right <= window.innerWidth;
}

// Get position of text within an element
function getTextPosition(element, fullText, startIndex, length) {
    try {
        const rect = element.getBoundingClientRect();
        
        // Simple approximation - use element's position
        // This is a fallback when Range API doesn't work
        return {
            left: rect.left + window.scrollX,
            top: rect.top + window.scrollY,
            width: Math.max(100, length * 8), // Approximate width
            height: rect.height || 20
        };
    } catch (error) {
        console.error('Error getting text position:', error);
        return null;
    }
}

// Create an overlay highlight element with suggestion support
function createOverlayHighlight(rect, entity) {
    const overlay = document.createElement('div');
    overlay.className = 'pii-overlay-highlight';
    overlay.setAttribute('data-pii-type', entity.type);
    overlay.setAttribute('data-pii-value', entity.value);
    overlay.setAttribute('data-suggestion-id', textProcessing.generateSuggestionId());
    
    overlay.style.position = 'absolute';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.backgroundColor = 'rgba(251, 191, 36, 0.7)';
    overlay.style.border = '2px solid #F59E0B';
    overlay.style.borderRadius = '3px';
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'pointer';
    overlay.style.zIndex = '999999';
    overlay.style.boxSizing = 'border-box';
    
    // Add click handler for suggestions
    overlay.onclick = (event) => {
        event.stopPropagation();
        showOverlaySuggestionPopup(overlay);
    };
    
    // Add tooltip
    overlay.title = `Click to review ${entity.type}: ${entity.value}`;
    
    document.body.appendChild(overlay);
}

// Show suggestion popup for highlighted elements
function showSuggestionPopup(highlightElement) {
    // Remove any existing popups
    document.querySelectorAll(`.${config.SUGGESTION_POPUP_CLASS}`).forEach(popup => popup.remove());
    
    const piiValue = highlightElement.getAttribute('data-pii-value');
    const piiType = highlightElement.getAttribute('data-pii-type');
    const suggestionId = highlightElement.getAttribute('data-suggestion-id');
    
    // Create popup container
    const popup = document.createElement('div');
    popup.className = config.SUGGESTION_POPUP_CLASS;
    
    // Position popup near the highlighted element
    const rect = highlightElement.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 440) + 'px';
    popup.style.top = (rect.bottom + 10) + 'px';
    
    // Create popup content
    popup.innerHTML = `
        <div style="margin-bottom: 12px;">
            <strong>PII Detected</strong>
        </div>
        <div style="margin-bottom: 8px;">
            <strong>Type:</strong> ${piiType}
        </div>
        <div style="margin-bottom: 8px;">
            <strong>Value:</strong> "<span class="pii-value-highlight">${piiValue}</span>"
        </div>
        <div style="margin-bottom: 16px;">
            <strong>Will become:</strong> "<span class="pii-redaction-preview">${textProcessing.getRedactionLabel(piiType)}</span>"
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="reject-btn">✕ Reject</button>
            <button id="accept-btn">✓ Accept</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // Add event listeners
    popup.querySelector('#accept-btn').onclick = () => acceptSuggestion(highlightElement, suggestionId, popup);
    popup.querySelector('#reject-btn').onclick = () => rejectSuggestion(highlightElement, suggestionId, popup);
    
    // Close popup when clicking outside
    const closePopup = (event) => {
        if (!popup.contains(event.target) && !highlightElement.contains(event.target)) {
            popup.remove();
            document.removeEventListener('click', closePopup);
        }
    };
    
    // Add slight delay to prevent immediate closure
    setTimeout(() => {
        document.addEventListener('click', closePopup);
    }, 100);
}

// Accept PII suggestion and redact
function acceptSuggestion(highlightElement, suggestionId, popup) {
    try {
        const piiValue = highlightElement.getAttribute('data-pii-value');
        const piiType = highlightElement.getAttribute('data-pii-type');
        const pageType = pageDetection.detectPageType();
        
        // Store decision
        const suggestionStates = window.PIIExtension.getSuggestionStates();
        if (suggestionStates) {
            suggestionStates.set(suggestionId, 'accepted');
        }
        
        // Replace with redaction label
        const redactionLabel = textProcessing.getRedactionLabel(piiType);
        const redactedSpan = document.createElement('span');
        redactedSpan.textContent = redactionLabel;
        redactedSpan.style.cssText = `
            background-color: #22D3EE;
            color: black;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 12px;
        `;
        redactedSpan.setAttribute('data-original-value', piiValue);
        redactedSpan.setAttribute('data-pii-type', piiType);
        redactedSpan.classList.add('pii-redacted');
        
        // IMPORTANT: Only replace if parent exists and is safe to modify
        if (highlightElement.parentNode && highlightElement.parentNode.nodeType === Node.ELEMENT_NODE) {
            highlightElement.parentNode.replaceChild(redactedSpan, highlightElement);
        } else {
            console.warn("[PII Extension] Cannot safely replace highlight element");
        }
        
        // If on ChatGPT, update the input field with sanitized content
        if (pageType === 'chatgpt') {
            setTimeout(() => {
                try {
                    const sanitizedText = textProcessing.extractSanitizedText();
                    if (sanitizedText) {
                        chatIntegration.setChatGPTInputValue(sanitizedText);
                    }
                } catch (updateError) {
                    console.error("[PII Extension] Error updating ChatGPT input after individual acceptance:", updateError);
                }
            }, 100);
        }
        
        // Remove popup safely
        try {
            if (popup && popup.parentNode) {
                popup.remove();
            }
        } catch (popupError) {
            console.error("[PII Extension] Error removing popup:", popupError);
        }
        
        console.log(`[PII Extension] Accepted suggestion: ${piiType} "${piiValue}" -> "${redactionLabel}"`);
    } catch (error) {
        console.error("[PII Extension] Error in acceptSuggestion:", error);
        
        // Try to remove popup even if other operations failed
        try {
            if (popup && popup.parentNode) {
                popup.remove();
            }
        } catch (popupError) {
            console.error("[PII Extension] Error removing popup after error:", popupError);
        }
    }
}

// Reject PII suggestion and keep original
function rejectSuggestion(highlightElement, suggestionId, popup) {
    const piiValue = highlightElement.getAttribute('data-pii-value');
    const piiType = highlightElement.getAttribute('data-pii-type');
    
    // Store decision
    const suggestionStates = window.PIIExtension.getSuggestionStates();
    if (suggestionStates) {
        suggestionStates.set(suggestionId, 'rejected');
    }
    
    // Remove highlighting but keep original text
    const textNode = document.createTextNode(highlightElement.textContent);
    highlightElement.parentNode.replaceChild(textNode, highlightElement);
    
    // Remove popup
    popup.remove();
    
    console.log(`Rejected suggestion: ${piiType} "${piiValue}"`);
}

// Show suggestion popup for textarea overlays
function showTextareaSuggestionPopup(overlayElement, entity) {
    // Remove any existing popups
    document.querySelectorAll(`.${config.SUGGESTION_POPUP_CLASS}`).forEach(popup => popup.remove());
    
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const suggestionId = overlayElement.getAttribute('data-suggestion-id');
    
    // Create popup
    const popup = document.createElement('div');
    popup.className = config.SUGGESTION_POPUP_CLASS;
    
    // Position popup near the overlay
    const rect = overlayElement.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 440) + 'px';
    popup.style.top = (rect.bottom + 10) + 'px';
    
    // Create popup content
    popup.innerHTML = `
        <div style="margin-bottom: 12px;">
            <strong>PII Detected</strong>
        </div>
        <div style="margin-bottom: 8px;">
            <strong>Type:</strong> ${piiType}
        </div>
        <div style="margin-bottom: 8px;">
            <strong>Value:</strong> "<span class="pii-value-highlight">${piiValue}</span>"
        </div>
        <div style="margin-bottom: 16px;">
            <strong>Will become:</strong> "<span class="pii-redaction-preview">${textProcessing.getRedactionLabel(piiType)}</span>"
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="reject-textarea-btn">✕ Reject</button>
            <button id="accept-textarea-btn">✓ Accept</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // Add event listeners
    popup.querySelector('#accept-textarea-btn').onclick = () => acceptTextareaSuggestion(overlayElement, entity, suggestionId, popup);
    popup.querySelector('#reject-textarea-btn').onclick = () => rejectTextareaSuggestion(overlayElement, suggestionId, popup);
    
    // Close popup when clicking outside
    const closePopup = (event) => {
        if (!popup.contains(event.target) && !overlayElement.contains(event.target)) {
            popup.remove();
            document.removeEventListener('click', closePopup);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closePopup);
    }, 100);
}

// Accept individual PII suggestion in textarea
function acceptTextareaSuggestion(overlayElement, entity, suggestionId, popup) {
    const textarea = window.chatGPTTextarea;
    if (!textarea) {
        popup.remove();
        return;
    }
    
    // Get current text from textarea (may have been modified)
    const currentText = textarea.value || textarea.textContent || '';
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const redactionLabel = textProcessing.getRedactionLabel(piiType);
    
    // Get the stored start/end positions
    const start = parseInt(overlayElement.getAttribute('data-pii-start'));
    const end = parseInt(overlayElement.getAttribute('data-pii-end'));
    
    // Verify the text at this position matches what we expect
    const textAtPosition = currentText.substring(start, end);
    console.log(`[PII Extension] Verifying redaction: expected "${piiValue}" at ${start}-${end}, found "${textAtPosition}"`);
    
    // Replace using offsets - but verify first
    let newText;
    const actualTextAtOffset = currentText.substring(start, end);
    
    // Check if the text at the offset matches what we expect
    if (actualTextAtOffset === piiValue || actualTextAtOffset.toLowerCase() === piiValue.toLowerCase()) {
        // Offsets are correct, use them directly
        newText = currentText.substring(0, start) + redactionLabel + currentText.substring(end);
        console.log(`[PII Extension] Redacting using verified offsets: ${start}-${end}`);
    } else {
        // Offsets don't match - the text may have been modified
        console.warn(`[PII Extension] Offset mismatch. Searching for "${piiValue}" in text...`);
        
        // Escape special regex characters
        const escapedPii = piiValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedPii, 'gi');
        const matches = [...currentText.matchAll(regex)];
        
        if (matches.length > 0) {
            // Find the match closest to the expected position
            let bestMatch = matches[0];
            let minDistance = Math.abs(matches[0].index - start);
            
            for (const match of matches) {
                const distance = Math.abs(match.index - start);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = match;
                }
            }
            
            const foundIndex = bestMatch.index;
            const foundLength = bestMatch[0].length;
            console.log(`[PII Extension] Found PII at adjusted position: ${foundIndex} (expected ${start}), length: ${foundLength}`);
            
            newText = currentText.substring(0, foundIndex) + redactionLabel + currentText.substring(foundIndex + foundLength);
            
            // Update the stored offsets for this redaction
            const adjustedStart = foundIndex;
            const adjustedEnd = foundIndex + foundLength;
            
            // Update the overlay's stored offsets for recalculation
            overlayElement.setAttribute('data-pii-start', adjustedStart);
            overlayElement.setAttribute('data-pii-end', adjustedEnd);
        } else {
            console.error(`[PII Extension] Could not find PII "${piiValue}" in current text`);
            popup.remove();
            return;
        }
    }
    
    // Update the stored original text
    window.chatGPTOriginalText = newText;
    
    // Update the textarea
    if (textarea.tagName === 'TEXTAREA') {
        textarea.value = newText;
    } else {
        textarea.textContent = newText;
    }
    
    // Trigger events
    const inputEvent = new Event("input", { bubbles: true });
    textarea.dispatchEvent(inputEvent);
    const changeEvent = new Event("change", { bubbles: true });
    textarea.dispatchEvent(changeEvent);
    
    // Remove this overlay and all overlays
    document.querySelectorAll('.pii-textarea-overlay').forEach(el => {
        if (el._updatePosition) {
            window.removeEventListener('scroll', el._updatePosition, true);
            window.removeEventListener('resize', el._updatePosition);
        }
        el.remove();
    });
    
    // Get the actual redaction position (may have been adjusted)
    const actualStart = parseInt(overlayElement.getAttribute('data-pii-start'));
    const actualEnd = parseInt(overlayElement.getAttribute('data-pii-end'));
    
    // Remove this PII from the list
    window.chatGPTFoundPII = window.chatGPTFoundPII.filter(p => 
        !(p.start === start && p.end === end && p.value === piiValue)
    );
    
    // Recalculate offsets for all remaining PII entities based on new text
    const redactionLengthDiff = redactionLabel.length - (actualEnd - actualStart);
    
    const updatedPII = [];
    window.chatGPTFoundPII.forEach(pii => {
        let newStart = pii.start;
        let newEnd = pii.end;
        
        // If this PII comes after the redaction point, adjust its offsets
        if (pii.start >= actualEnd) {
            newStart = pii.start + redactionLengthDiff;
            newEnd = pii.end + redactionLengthDiff;
        } else if (pii.end > actualStart && pii.start < actualEnd) {
            // This PII overlaps with the redacted one - skip it
            console.warn(`[PII Extension] Skipping overlapping PII: ${pii.value}`);
            return;
        }
        
        // Verify the PII still exists at the new position
        const textAtNewPosition = newText.substring(newStart, newEnd);
        if (textAtNewPosition === pii.value || textAtNewPosition.toLowerCase() === pii.value.toLowerCase()) {
            updatedPII.push({
                ...pii,
                start: newStart,
                end: newEnd
            });
        } else {
            // Try to find it by value
            const lowerNewText = newText.toLowerCase();
            const lowerPiiValue = pii.value.toLowerCase();
            const foundIndex = lowerNewText.indexOf(lowerPiiValue, Math.max(0, newStart - 10));
            
            if (foundIndex !== -1) {
                updatedPII.push({
                    ...pii,
                    start: foundIndex,
                    end: foundIndex + pii.value.length
                });
                console.log(`[PII Extension] Recalculated PII "${pii.value}" to position ${foundIndex}`);
            } else {
                console.warn(`[PII Extension] Could not find remaining PII "${pii.value}" after redaction`);
            }
        }
    });
    
    window.chatGPTFoundPII = updatedPII;
    
    // Recreate highlights for remaining PII with updated offsets
    if (window.chatGPTFoundPII.length > 0) {
        createInlineHighlightsForTextarea(textarea, window.chatGPTFoundPII, newText);
    }
    
    popup.remove();
    console.log(`[PII Extension] Accepted and redacted: ${piiType} "${piiValue}" -> "${redactionLabel}"`);
}

// Reject individual PII suggestion in textarea
function rejectTextareaSuggestion(overlayElement, suggestionId, popup) {
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const start = parseInt(overlayElement.getAttribute('data-pii-start'));
    const end = parseInt(overlayElement.getAttribute('data-pii-end'));
    
    // Remove this overlay and all related overlays for this PII (in case of multi-line)
    document.querySelectorAll('.pii-textarea-overlay').forEach(overlay => {
        const overlayValue = overlay.getAttribute('data-pii-value');
        const overlayStart = parseInt(overlay.getAttribute('data-pii-start'));
        const overlayEnd = parseInt(overlay.getAttribute('data-pii-end'));
        
        // Check if this overlay matches the rejected PII
        if (overlayValue === piiValue && overlayStart === start && overlayEnd === end) {
            if (overlay._updatePosition) {
                window.removeEventListener('scroll', overlay._updatePosition, true);
                window.removeEventListener('resize', overlay._updatePosition);
            }
            overlay.remove();
        }
    });
    
    // Remove this PII from the list
    window.chatGPTFoundPII = window.chatGPTFoundPII.filter(p => 
        !(p.start === start && p.end === end && p.value === piiValue)
    );
    
    // Remove the popup
    popup.remove();
    
    console.log(`[PII Extension] Rejected: ${piiType} "${piiValue}" - highlights removed`);
}

// Show suggestion popup for overlay highlights
function showOverlaySuggestionPopup(overlayElement) {
    // Remove any existing popups
    document.querySelectorAll(`.${config.SUGGESTION_POPUP_CLASS}`).forEach(popup => popup.remove());
    
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const suggestionId = overlayElement.getAttribute('data-suggestion-id');
    
    // Create popup similar to regular suggestion popup
    const popup = document.createElement('div');
    popup.className = config.SUGGESTION_POPUP_CLASS;
    
    // Position popup near the overlay
    const rect = overlayElement.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 440) + 'px';
    popup.style.top = (rect.bottom + 10) + 'px';
    
    // Create popup content
    popup.innerHTML = `
        <div style="margin-bottom: 12px;">
            <strong>PII Detected (Overlay Mode)</strong>
        </div>
        <div style="margin-bottom: 8px;">
            <strong>Type:</strong> ${piiType}
        </div>
        <div style="margin-bottom: 8px;">
            <strong>Value:</strong> "<span class="pii-value-highlight">${piiValue}</span>"
        </div>
        <div style="margin-bottom: 16px;">
            <strong>Will become:</strong> "<span class="pii-redaction-preview">${textProcessing.getRedactionLabel(piiType)}</span>"
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="reject-overlay-btn">✕ Reject</button>
            <button id="accept-overlay-btn">✓ Accept</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // Add event listeners
    popup.querySelector('#accept-overlay-btn').onclick = () => acceptOverlaySuggestion(overlayElement, suggestionId, popup);
    popup.querySelector('#reject-overlay-btn').onclick = () => rejectOverlaySuggestion(overlayElement, suggestionId, popup);
    
    // Close popup when clicking outside
    const closePopup = (event) => {
        if (!popup.contains(event.target) && !overlayElement.contains(event.target)) {
            popup.remove();
            document.removeEventListener('click', closePopup);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closePopup);
    }, 100);
}

// Accept overlay PII suggestion
function acceptOverlaySuggestion(overlayElement, suggestionId, popup) {
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const pageType = pageDetection.detectPageType();
    
    // Store decision
    const suggestionStates = window.PIIExtension.getSuggestionStates();
    if (suggestionStates) {
        suggestionStates.set(suggestionId, 'accepted');
    }
    
    // Change overlay to show it's redacted
    const redactionLabel = textProcessing.getRedactionLabel(piiType);
    overlayElement.style.backgroundColor = 'rgba(34, 211, 238, 0.9)';
    overlayElement.style.border = '2px solid #22D3EE';
    overlayElement.innerHTML = `<span style="color: black; font-weight: bold; font-size: 12px; padding: 2px; display: flex; align-items: center; justify-content: center; height: 100%;">${redactionLabel}</span>`;
    overlayElement.onclick = null; // Remove click handler
    overlayElement.style.cursor = 'default';
    overlayElement.title = `Redacted ${piiType}: ${piiValue}`;
    
    // If on ChatGPT, update the input field with sanitized content
    if (pageType === 'chatgpt') {
        setTimeout(() => {
            const sanitizedText = textProcessing.extractSanitizedText();
            if (sanitizedText) {
                chatIntegration.setChatGPTInputValue(sanitizedText);
            }
        }, 100);
    }
    
    // Remove popup
    popup.remove();
    
    console.log(`Accepted overlay suggestion: ${piiType} "${piiValue}" -> "${redactionLabel}"`);
}

// Reject overlay PII suggestion
function rejectOverlaySuggestion(overlayElement, suggestionId, popup) {
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    
    // Store decision
    const suggestionStates = window.PIIExtension.getSuggestionStates();
    if (suggestionStates) {
        suggestionStates.set(suggestionId, 'rejected');
    }
    
    // Remove the overlay entirely
    overlayElement.remove();
    
    // Remove popup
    popup.remove();
    
    console.log(`Rejected overlay suggestion: ${piiType} "${piiValue}"`);
}

// Export to global namespace
window.PIIExtension.highlighting = {
    handleScanClick,
    highlightPiiInDocument,
    highlightPiiForChatGPT,
    createInlineHighlightsForTextarea,
    getTextLineSegments,
    createTextareaMirror,
    createHighlightOverlay,
    setupOverlayPositionUpdate,
    highlightWithOverlay,
    createOverlayHighlight,
    showOverlaySuggestionPopup,
    acceptOverlaySuggestion,
    rejectOverlaySuggestion,
    showSuggestionPopup,
    acceptSuggestion,
    rejectSuggestion,
    addRedactEvents,
    showTextareaSuggestionPopup,
    acceptTextareaSuggestion,
    rejectTextareaSuggestion,
    clearHighlights,
    acceptAllPII,
    acceptAllPIIForChatGPT,
    isElementVisible,
    getTextPosition
};

})(); // End IIFE
