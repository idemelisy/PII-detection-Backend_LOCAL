// ============================================================================
// AGENT MODULE
// ============================================================================
// Agent mode functionality for automated PII workflow

(function() {
'use strict';

// Ensure required modules are loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before agent module');
}
if (!window.PIIExtension || !window.PIIExtension.pageDetection) {
    console.error('[PII Extension] PageDetection module must be loaded before agent module');
}
if (!window.PIIExtension || !window.PIIExtension.chatIntegration) {
    console.error('[PII Extension] ChatIntegration module must be loaded before agent module');
}

const config = window.PIIExtension.config;
const pageDetection = window.PIIExtension.pageDetection;
const chatIntegration = window.PIIExtension.chatIntegration;

function isAgentSupportedPage(pageType = pageDetection.detectPageType()) {
    return pageType === 'chatgpt' || pageType === 'gemini';
}

function setExtensionMode(mode) {
    if (mode !== config.MODE_CONTROL && mode !== config.MODE_AGENT) return;
    window.PIIExtension.setExtensionMode(mode);
    localStorage.setItem('pii-extension-mode', mode);
    updateModeUIState();
    const label = mode === config.MODE_AGENT
        ? 'Agent mode enabled. Send Anonymized will run the full workflow automatically.'
        : 'Control mode enabled. Manual workflow restored.';
    showAgentToast(label, 'info');
}

function handleModeChange(event) {
    const selectedMode = event?.target?.value;
    const currentMode = window.PIIExtension.getExtensionMode();
    if (selectedMode && selectedMode !== currentMode) {
        setExtensionMode(selectedMode);
    }
}

function updateModeUIState() {
    const modeSelect = document.getElementById('pii-mode-select');
    const currentMode = window.PIIExtension.getExtensionMode();
    if (modeSelect && modeSelect.value !== currentMode) {
        modeSelect.value = currentMode;
    }

    const sendButton = document.getElementById('pii-send-anonymized-button');
    const pageType = pageDetection.detectPageType();
    const canAutomate = currentMode === config.MODE_AGENT && isAgentSupportedPage(pageType);
    const agentState = window.PIIExtension.getAgentPipelineState();
    if (sendButton) {
        sendButton.style.display = canAutomate ? 'block' : 'none';
        sendButton.disabled = !canAutomate || agentState.running;
        if (!agentState.running) {
            sendButton.innerHTML = `<span role="img" aria-label="Agent">🤖</span> Send Anonymized`;
        }
    }
}

function setSendAnonymizedButtonState(busy, label) {
    const button = document.getElementById('pii-send-anonymized-button');
    if (!button) return;
    if (busy) {
        button.disabled = true;
        button.classList.add('pii-busy');
        button.innerHTML = label || `<span role="img" aria-label="Processing">⏳</span> Working...`;
    } else {
        button.disabled = false;
        button.classList.remove('pii-busy');
        button.innerHTML = `<span role="img" aria-label="Agent">🤖</span> Send Anonymized`;
    }
}

function showAgentToast(message, variant = 'info') {
    try {
        const toast = document.createElement('div');
        toast.className = 'pii-agent-toast';
        toast.dataset.variant = variant;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 250);
        }, 4000);
    } catch (error) {
        console.log(`[PII Extension] ${message}`);
    }
}

async function handleSendAnonymizedClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const currentMode = window.PIIExtension.getExtensionMode();
    if (currentMode !== config.MODE_AGENT) {
        setExtensionMode(config.MODE_AGENT);
    }

    const pageType = pageDetection.detectPageType();
    if (!isAgentSupportedPage(pageType)) {
        showAgentToast('Agent automations only run on ChatGPT or Gemini.', 'error');
        return;
    }

    const agentState = window.PIIExtension.getAgentPipelineState();
    if (agentState.running) {
        showAgentToast('Agent workflow already in progress. Please wait.', 'info');
        return;
    }

    agentState.running = true;
    setSendAnonymizedButtonState(true, `<span role="img" aria-label="Processing">⏳</span> Automating...`);

    try {
        // Ensure textarea is ready and has content
        const textareaResult = chatIntegration.findChatGPTTextarea();
        const textarea = textareaResult?.textarea;
        if (!textarea) {
            throw new Error('Textarea not found. Please type your message first.');
        }
        
        // Ensure textarea is enabled and ready
        if (textarea.disabled) {
            textarea.disabled = false;
            console.log('[PII Extension] Re-enabled textarea');
        }
        if (textarea.readOnly) {
            textarea.readOnly = false;
            console.log('[PII Extension] Made textarea editable');
        }
        
        const textareaValue = textarea.value || textarea.textContent || '';
        if (!textareaValue.trim()) {
            throw new Error('Textarea is empty. Please type your message before clicking "Send Anonymized".');
        }
        
        console.log(`[PII Extension] Starting agent workflow with textarea content (${textareaValue.length} chars)`);
        
        const baselineResponses = chatIntegration.countAssistantMessages(pageType);
        
        // Use module reference
        if (window.PIIExtension.highlighting && window.PIIExtension.highlighting.handleScanClick) {
            await window.PIIExtension.highlighting.handleScanClick();
        }
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Verify scan found PII
        if (!window.piiMapping || window.piiMapping.size === 0) {
            console.warn('[PII Extension] No PII detected in scan, but continuing workflow');
        } else {
            console.log(`[PII Extension] Scan found ${window.piiMapping.size} PII items`);
        }
        
        // Use module reference
        if (window.PIIExtension.highlighting && window.PIIExtension.highlighting.acceptAllPII) {
            window.PIIExtension.highlighting.acceptAllPII();
        }
        await new Promise(resolve => setTimeout(resolve, 120));
        
        // Use module reference
        if (window.PIIExtension.textProcessing && window.PIIExtension.textProcessing.fillRedactions) {
            window.PIIExtension.textProcessing.fillRedactions();
        }
        await new Promise(resolve => setTimeout(resolve, 120));

        if (pageType === 'chatgpt') {
            try {
                chatIntegration.toggleChatGPTSendButton(true);
            } catch (error) {
                console.warn('[PII Extension] Unable to re-enable ChatGPT send button before auto-send:', error);
            }
        }

        const sent = chatIntegration.triggerChatInterfaceSend(pageType);
        if (!sent) {
            throw new Error('Unable to trigger send action on this page.');
        }

        agentState.awaitingResponse = true;
        showAgentToast('Prompt sent with anonymized data. Awaiting response...', 'info');

        await chatIntegration.waitForAssistantResponse(pageType, baselineResponses);
        
        // Wait for response to stabilize (stop changing)
        let lastResponseText = '';
        let stableCount = 0;
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 300));
            const selectors = chatIntegration.getAssistantResponseSelectors(pageType);
            let currentText = '';
            for (const selector of selectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        const lastEl = Array.from(elements).slice(-1)[0];
                        currentText = (lastEl.textContent || lastEl.innerText || '').trim();
                        if (currentText.length > 20) break;
                    }
                } catch (e) {
                    // ignore
                }
            }
            
            if (currentText === lastResponseText && currentText.length > 20) {
                stableCount++;
                if (stableCount >= 3) {
                    console.log('[PII Extension] Response stabilized, ready for revert');
                    break;
                }
            } else {
                stableCount = 0;
                lastResponseText = currentText;
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('[PII Extension] Starting automatic revert process...');
        const filledMappings = [];
        if (window.piiMapping) {
            for (const [id, mapping] of window.piiMapping.entries()) {
                if (mapping.fake && mapping.original) {
                    filledMappings.push(mapping);
                    console.log(`[PII Extension] Mapping to revert: "${mapping.fake}" -> "${mapping.original}"`);
                }
            }
        }
        
        if (filledMappings.length === 0) {
            console.warn('[PII Extension] No mappings found for revert');
            // Use module reference
            if (window.PIIExtension.highlighting && window.PIIExtension.highlighting.clearHighlights) {
                window.PIIExtension.highlighting.clearHighlights(false);
            }
            showAgentToast('No PII mappings found to revert.', 'info');
            return;
        }

        // Separate location mappings for specialized handling
        const locationMappings = filledMappings.filter(m => m.type === 'LOCATION');
        const otherMappings = filledMappings.filter(m => m.type !== 'LOCATION');
        
        console.log(`[PII Extension] Reverting ${locationMappings.length} locations and ${otherMappings.length} other PII items`);
        
        let revertAttempts = 0;
        const maxRevertAttempts = 5;
        let lastRevertCount = 0;
        
        while (revertAttempts < maxRevertAttempts) {
            console.log(`[PII Extension] Revert attempt ${revertAttempts + 1}/${maxRevertAttempts}`);
            
            // First, try standard revert for all mappings
            // Use module reference
            if (window.PIIExtension.textProcessing && window.PIIExtension.textProcessing.revertPIIsInResponse) {
                window.PIIExtension.textProcessing.revertPIIsInResponse();
            }
            await new Promise(resolve => setTimeout(resolve, 400));
            
            // Then, do an aggressive location-specific revert
            if (locationMappings.length > 0) {
                console.log('[PII Extension] Performing location-specific revert...');
                // Use module reference
                if (window.PIIExtension.textProcessing && window.PIIExtension.textProcessing.revertLocationsAggressively) {
                    window.PIIExtension.textProcessing.revertLocationsAggressively(locationMappings);
                }
                await new Promise(resolve => setTimeout(resolve, 400));
            }
            
            revertAttempts++;
            
            const responseText = document.body.textContent || '';
            
            // Check for remaining fake values - for locations, check components too
            const stillHasFake = filledMappings.some(m => {
                if (m.type === 'LOCATION') {
                    // For locations, check if any component of fake is still present
                    const fakeParts = m.fake.split(/[,\s\/]+/).filter(p => p.length > 3);
                    const hasComponent = fakeParts.some(part => {
                        const found = responseText.toLowerCase().includes(part.toLowerCase());
                        if (found) {
                            console.log(`[PII Extension] Still found location component: "${part}" from "${m.fake}"`);
                        }
                        return found;
                    });
                    return hasComponent;
                } else {
                    const found = responseText.includes(m.fake);
                    if (found) {
                        console.log(`[PII Extension] Still found fake value: "${m.fake}"`);
                    }
                    return found;
                }
            });
            
            if (!stillHasFake) {
                console.log('[PII Extension] All fake values successfully reverted');
                break;
            }
            
            if (revertAttempts >= 2) {
                const currentRevertCount = filledMappings.filter(m => {
                    if (m.type === 'LOCATION') {
                        const fakeParts = m.fake.split(/[,\s\/]+/).filter(p => p.length > 3);
                        return !fakeParts.some(part => responseText.toLowerCase().includes(part.toLowerCase()));
                    }
                    return !responseText.includes(m.fake);
                }).length;
                
                if (currentRevertCount === lastRevertCount && currentRevertCount < filledMappings.length) {
                    console.warn('[PII Extension] Revert stalled, trying document-wide approach');
                    // Use module reference
                    if (window.PIIExtension.textProcessing && window.PIIExtension.textProcessing.revertPIIsInDocumentBody) {
                        window.PIIExtension.textProcessing.revertPIIsInDocumentBody(filledMappings);
                    }
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                lastRevertCount = currentRevertCount;
            }
        }
        
        const finalCheck = document.body.textContent || '';
        const finalFakeCount = filledMappings.filter(m => {
            if (m.type === 'LOCATION') {
                // For locations, check if any component is still present
                const fakeParts = m.fake.split(/[,\s\/]+/).filter(p => p.length > 3);
                return fakeParts.some(part => finalCheck.toLowerCase().includes(part.toLowerCase()));
            }
            return finalCheck.includes(m.fake);
        }).length;
        const finalRevertedCount = filledMappings.length - finalFakeCount;
        
        // Don't clear highlights/mappings here - let them persist for potential manual revert
        // Only clear the visual overlays, not the mappings
        document.querySelectorAll('.pii-textarea-overlay').forEach(el => {
            if (el._updatePosition) {
                window.removeEventListener('scroll', el._updatePosition, true);
                window.removeEventListener('resize', el._updatePosition);
            }
            el.remove();
        });
        document.querySelectorAll('.pii-suggestion-popup').forEach(popup => {
            popup.remove();
        });
        
        if (finalFakeCount > 0) {
            console.warn(`[PII Extension] Warning: ${finalFakeCount} fake values still present after revert attempts`);
            showAgentToast(`Reverted ${finalRevertedCount}/${filledMappings.length} PII values. Some may need manual review.`, 'info');
        } else {
            showAgentToast(`Response restored: ${finalRevertedCount} PII values reverted.`, 'success');
        }
        
        // Force a visual update by triggering a scroll event
        window.dispatchEvent(new Event('scroll'));
        document.body.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Clear mappings AFTER a delay to allow for manual review, but before next use
        // This ensures the next "Send Anonymized" will start fresh
        setTimeout(() => {
            if (window.piiMapping) {
                const oldSize = window.piiMapping.size;
                window.piiMapping.clear();
                console.log(`[PII Extension] Cleared ${oldSize} PII mappings after workflow completion`);
            }
        }, 2000);
    } catch (error) {
        console.error('[PII Extension] Agent workflow failed:', error);
        showAgentToast(error?.message || 'Agent workflow failed. See console for details.', 'error');
        
        // On error, clear mappings to allow fresh start
        if (window.piiMapping) {
            window.piiMapping.clear();
            console.log('[PII Extension] Cleared mappings due to error');
        }
    } finally {
        // Always reset state, even on error
        const agentState = window.PIIExtension.getAgentPipelineState();
        agentState.running = false;
        agentState.awaitingResponse = false;
        agentState.justSent = false;
        
        // Ensure textarea is ready for next use
        try {
            const textareaResult = chatIntegration.findChatGPTTextarea();
            const textarea = textareaResult?.textarea;
            if (textarea && textarea.disabled) {
                textarea.disabled = false;
            }
            if (textarea && textarea.readOnly) {
                textarea.readOnly = false;
            }
        } catch (e) {
            console.warn('[PII Extension] Could not reset textarea state:', e);
        }
        
        updateModeUIState();
        setSendAnonymizedButtonState(false);
        console.log('[PII Extension] Agent workflow state reset, ready for next use');
    }
}

// Export to global namespace
window.PIIExtension.agent = {
    isAgentSupportedPage,
    setExtensionMode,
    handleModeChange,
    updateModeUIState,
    setSendAnonymizedButtonState,
    showAgentToast,
    handleSendAnonymizedClick
};

})(); // End IIFE
