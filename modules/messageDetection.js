// ============================================================================
// MESSAGE DETECTION MODULE
// ============================================================================
// Detects when messages are sent and clears highlights from input fields

(function() {
'use strict';

// Ensure required modules are loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before messageDetection module');
}
if (!window.PIIExtension || !window.PIIExtension.pageDetection) {
    console.error('[PII Extension] PageDetection module must be loaded before messageDetection module');
}

const config = window.PIIExtension.config;
const pageDetection = window.PIIExtension.pageDetection;

/**
 * Detects when a message is sent and clears highlights from input field
 * Also ensures highlights don't appear in sent messages
 */
function setupMessageSendDetection() {
    const pageType = pageDetection.detectPageType();
    
    if (pageType !== 'chatgpt' && pageType !== 'gemini') {
        return; // Only needed for chat interfaces
    }
    
    console.log(`[PII Extension] Setting up message send detection for ${pageType}`);
    
    // Strategy 1: Listen for send button clicks
    const sendButtonSelectors = [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        '[data-testid="send-button"]',
        'button[type="submit"]',
        'button.send-button',
        'button[class*="send"]'
    ];
    
    // Function to clear highlights from input field
    const clearInputHighlights = () => {
        // Don't clear if agent mode is running - we need to keep mappings for revert
        const agentState = window.PIIExtension.getAgentPipelineState();
        if (agentState.running || agentState.awaitingResponse) {
            return;
        }
        
        console.log('[PII Extension] Clearing highlights from input field after message send');
        
        // Remove all textarea overlay highlights
        document.querySelectorAll('.pii-textarea-overlay').forEach(el => {
            if (el._updatePosition) {
                window.removeEventListener('scroll', el._updatePosition, true);
                window.removeEventListener('resize', el._updatePosition);
            }
            el.remove();
        });
        
        // Remove suggestion popups
        document.querySelectorAll('.pii-suggestion-popup').forEach(popup => {
            popup.remove();
        });
        
        // Clear stored data (but keep piiMapping for agent mode)
        delete window.chatGPTOriginalText;
        delete window.chatGPTFoundPII;
        delete window.chatGPTTextarea;
    };
    
    // Add click listeners to send buttons
    const addSendButtonListeners = () => {
        sendButtonSelectors.forEach(selector => {
            try {
                const buttons = document.querySelectorAll(selector);
                buttons.forEach(button => {
                    // Only add listener if not already added
                    if (!button.dataset.piiListenerAdded) {
                        button.addEventListener('click', () => {
                            console.log('[PII Extension] Send button clicked, clearing highlights');
                            // Small delay to ensure message is sent
                            setTimeout(clearInputHighlights, 100);
                        }, { once: false });
                        button.dataset.piiListenerAdded = 'true';
                    }
                });
            } catch (e) {
                // Ignore errors
            }
        });
    };
    
    // Initial setup
    addSendButtonListeners();
    
    // Re-setup when DOM changes (for dynamic send buttons)
    const sendButtonObserver = new MutationObserver(() => {
        addSendButtonListeners();
    });
    
    sendButtonObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Strategy 2: Monitor input field for clearing (when it becomes empty after send)
    const monitorInputField = () => {
        const textareaSelectors = [
            'textarea[aria-label*="prompt"]',
            'textarea[aria-label*="message"]',
            'textarea[placeholder*="prompt"]',
            'textarea[placeholder*="message"]',
            'textarea[contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            'textarea'
        ];
        
        let lastText = '';
        let lastTextLength = 0;
        
        const checkInputField = () => {
            let textarea = null;
            for (const selector of textareaSelectors) {
                textarea = document.querySelector(selector);
                if (textarea) break;
            }
            
            if (textarea) {
                const currentText = textarea.value || textarea.textContent || '';
                const currentLength = currentText.length;
                
                // If text was cleared (went from non-empty to empty), message was likely sent
                if (lastTextLength > 0 && currentLength === 0 && lastText !== currentText) {
                    console.log('[PII Extension] Input field cleared, message likely sent');
                    clearInputHighlights();
                }
                
                lastText = currentText;
                lastTextLength = currentLength;
            }
        };
    
        // Check periodically
        setInterval(checkInputField, 500);
    };
    
    monitorInputField();
    
    // Strategy 3: Monitor chat history to ensure no highlights appear in sent messages
    const monitorChatHistory = () => {
        const chatHistoryObserver = new MutationObserver((mutations) => {
            // Check for new message elements being added
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Remove any highlights from newly added messages
                        const highlights = node.querySelectorAll ? node.querySelectorAll('.pii-textarea-overlay, .pii-highlight, .pii-overlay-highlight') : [];
                        highlights.forEach(highlight => {
                            console.log('[PII Extension] Removing highlight from sent message');
                            highlight.remove();
                        });
                        
                        // Also check if the node itself is a highlight
                        if (node.classList && (
                            node.classList.contains('pii-textarea-overlay') ||
                            node.classList.contains('pii-highlight') ||
                            node.classList.contains('pii-overlay-highlight')
                        )) {
                            // Check if it's in a message bubble (sent message)
                            let parent = node.parentElement;
                            let isInMessage = false;
                            while (parent) {
                                if (parent.classList && (
                                    parent.classList.contains('message') ||
                                    parent.classList.contains('chat-message') ||
                                    parent.getAttribute('data-message-id') ||
                                    parent.getAttribute('data-testid')?.includes('message')
                                )) {
                                    isInMessage = true;
                                    break;
                                }
                                parent = parent.parentElement;
                            }
                            
                            if (isInMessage) {
                                console.log('[PII Extension] Removing highlight from sent message bubble');
                                node.remove();
                            }
                        }
                    }
                });
            });
        });
        
        // Observe the entire document for new message additions
        chatHistoryObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    };
    
    monitorChatHistory();
    
    console.log('[PII Extension] Message send detection setup complete');
}

// Export to global namespace
window.PIIExtension.messageDetection = {
    setupMessageSendDetection
};

// Add getter for agentPipelineState to config module
if (!window.PIIExtension.getAgentPipelineState) {
    window.PIIExtension.getAgentPipelineState = () => config.agentPipelineState;
}

})(); // End IIFE

