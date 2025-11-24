// ============================================================================
// CHAT INTEGRATION MODULE
// ============================================================================
// ChatGPT/Gemini specific integration functions

(function() {
'use strict';

// Ensure required modules are loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before chatIntegration module');
}
if (!window.PIIExtension || !window.PIIExtension.pageDetection) {
    console.error('[PII Extension] PageDetection module must be loaded before chatIntegration module');
}
if (!window.PIIExtension || !window.PIIExtension.textProcessing) {
    console.error('[PII Extension] TextProcessing module must be loaded before chatIntegration module');
}

const config = window.PIIExtension.config;
const pageDetection = window.PIIExtension.pageDetection;
const textProcessing = window.PIIExtension.textProcessing;

/**
 * Enhanced textarea finder for ChatGPT/Gemini
 * Tries multiple selectors and methods to find the input field
 * Returns { textarea, selector, text } or null if not found
 */
function findChatGPTTextarea() {
    const pageType = pageDetection.detectPageType();
    if (pageType !== 'chatgpt' && pageType !== 'gemini') {
        return null;
    }
    
    const isGemini = pageType === 'gemini';
    
    // Enhanced selectors for ChatGPT/Gemini - try more specific ones first
    const textareaSelectors = [
        // ChatGPT specific selectors
        'textarea#prompt-textarea',
        'textarea[data-id="root"]',
        'textarea[tabindex="0"]',
        'div[contenteditable="true"][data-id="root"]',
        'div[contenteditable="true"][tabindex="0"]',
        'textarea[aria-label*="prompt"]',
        'textarea[aria-label*="Message"]',
        'textarea[aria-label*="message"]',
        'textarea[placeholder*="prompt"]',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="message"]',
        'textarea[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        // More generic selectors
        'textarea',
        'div[role="textbox"]'
    ];
    
    let textarea = null;
    let foundSelector = null;
    
    for (const selector of textareaSelectors) {
        try {
            const elements = document.querySelectorAll(selector);
            // Try to find the one that's actually visible and is the input
            for (const el of elements) {
                const rect = el.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0;
                const isInput = el.tagName === 'TEXTAREA' || 
                              (el.contentEditable === 'true' && el.getAttribute('role') === 'textbox') ||
                              (el.contentEditable === 'true' && el.hasAttribute('data-id'));
                
                if (isVisible && isInput) {
                    textarea = el;
                    foundSelector = selector;
                    break;
                }
            }
            
            if (textarea) break;
            
            // Fallback: just use the first one if any found
            if (elements.length > 0) {
                textarea = elements[0];
                foundSelector = selector;
                break;
            }
        } catch (e) {
            console.warn(`[PII Extension] Error with selector ${selector}:`, e);
        }
    }
    
    if (!textarea) {
        console.warn(`[PII Extension] ${isGemini ? 'Gemini' : 'ChatGPT'} input field not found`);
        console.warn('[PII Extension] Available textareas on page:', document.querySelectorAll('textarea').length);
        console.warn('[PII Extension] Available contenteditable divs:', document.querySelectorAll('div[contenteditable="true"]').length);
        return null;
    }
    
    // Get text from input field (handle both textarea.value and contenteditable divs)
    let text = textarea.value || textarea.textContent || textarea.innerText || '';
    
    // For contenteditable divs, try to get text from child nodes
    if (!text && textarea.contentEditable === 'true') {
        const walker = document.createTreeWalker(
            textarea,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node.textContent);
        }
        text = textNodes.join('');
    }
    
    // Also try querySelector for nested divs
    if (!text && textarea.querySelector) {
        const nestedDiv = textarea.querySelector('div');
        if (nestedDiv) {
            text = nestedDiv.textContent || nestedDiv.innerText || '';
        }
    }
    
    return {
        textarea: textarea,
        selector: foundSelector,
        text: text
    };
}

// Safely set ChatGPT/Gemini input value and trigger React state update
function setChatGPTInputValue(newText, textareaElement = null) {
    try {
        // Use provided textarea or try to find it using the enhanced finder
        let textarea = textareaElement;
        if (!textarea) {
            const textareaResult = findChatGPTTextarea();
            if (textareaResult && textareaResult.textarea) {
                textarea = textareaResult.textarea;
            }
        }
        
        if (!textarea) {
            console.warn("[PII Extension] Input field not found");
            return false;
        }
        
        const pageType = pageDetection.detectPageType();
        console.log(`[PII Extension] Setting ${pageType === 'gemini' ? 'Gemini' : 'ChatGPT'} input value safely...`);
        
        // IMPORTANT: Only update the value, never replace DOM nodes
        // Handle both textarea.value and contenteditable divs
        if (textarea.tagName === 'TEXTAREA') {
            textarea.value = newText;
        } else {
            textarea.textContent = newText;
        }
        
        // Dispatch React-compatible events to maintain state sync
        const inputEvent = new Event("input", { bubbles: true });
        textarea.dispatchEvent(inputEvent);
        
        // Also dispatch change event for compatibility
        const changeEvent = new Event("change", { bubbles: true });
        textarea.dispatchEvent(changeEvent);
        
        // Focus to ensure proper React state
        textarea.focus();
        
        console.log(`[PII Extension] ${pageType === 'gemini' ? 'Gemini' : 'ChatGPT'} input updated successfully without DOM manipulation`);
        return true;
    } catch (error) {
        console.error("[PII Extension] Error updating input field:", error);
        return false;
    }
}

// Toggle ChatGPT send button state during processing
function toggleChatGPTSendButton(enabled) {
    try {
        // Try multiple possible selectors for the send button
        const sendButtonSelectors = [
            'button[data-testid="send-button"]',
            'button[aria-label*="Send"]',
            'button[aria-label*="send"]',
            '[data-testid="send-button"]',
            'form button[type="submit"]',
            'button:has(svg):last-of-type'
        ];
        
        let sendBtn = null;
        for (const selector of sendButtonSelectors) {
            try {
                sendBtn = document.querySelector(selector);
                if (sendBtn) {
                    console.log(`[PII Extension] Found send button with selector: ${selector}`);
                    break;
                }
            } catch (selectorError) {
                console.warn(`[PII Extension] Error with selector ${selector}:`, selectorError);
            }
        }
        
        if (sendBtn) {
            // IMPORTANT: Only modify properties, never replace the element
            sendBtn.disabled = !enabled;
            sendBtn.style.opacity = enabled ? '1' : '0.5';
            sendBtn.style.pointerEvents = enabled ? 'auto' : 'none';
            console.log(`[PII Extension] Send button ${enabled ? 'enabled' : 'disabled'} safely`);
            return true;
        } else {
            console.warn("[PII Extension] ChatGPT send button not found");
            return false;
        }
    } catch (error) {
        console.error("[PII Extension] Error toggling send button:", error);
        return false;
    }
}

function getCurrentPromptText(preDetectedPageType) {
    const pageType = preDetectedPageType || pageDetection.detectPageType();

    if (pageType === 'chatgpt' || pageType === 'gemini') {
        const textareaSelectors = [
            'textarea#prompt-textarea',
            'textarea[data-id="root"]',
            'textarea[tabindex="0"]',
            'div[contenteditable="true"][data-id="root"]',
            'div[contenteditable="true"][tabindex="0"]',
            'textarea[aria-label*="prompt"]',
            'textarea[aria-label*="Message"]',
            'textarea[aria-label*="message"]',
            'textarea[placeholder*="prompt"]',
            'textarea[placeholder*="Message"]',
            'textarea[placeholder*="message"]',
            'textarea[contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"]',
            'textarea',
            'div[role="textbox"]'
        ];

        let textarea = null;
        let rawText = '';

        for (const selector of textareaSelectors) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const rect = el.getBoundingClientRect();
                    const isVisible = rect.width > 0 && rect.height > 0;
                    const isInput = el.tagName === 'TEXTAREA' ||
                        (el.contentEditable === 'true' && el.getAttribute('role') === 'textbox') ||
                        (el.contentEditable === 'true' && el.hasAttribute('data-id'));

                    if (isVisible && isInput) {
                        textarea = el;
                        break;
                    }
                }

                if (!textarea && elements.length > 0) {
                    textarea = elements[0];
                }

                if (textarea) {
                    if (textarea.value) {
                        rawText = textarea.value;
                    } else if (textarea.textContent) {
                        rawText = textarea.textContent;
                    } else if (textarea.innerText) {
                        rawText = textarea.innerText;
                    }

                    if (!rawText && textarea.contentEditable === 'true') {
                        const walker = document.createTreeWalker(
                            textarea,
                            NodeFilter.SHOW_TEXT,
                            null,
                            false
                        );
                        const textNodes = [];
                        let node;
                        while (node = walker.nextNode()) {
                            textNodes.push(node.textContent);
                        }
                        rawText = textNodes.join('');
                    }

                    if (!rawText && textarea.querySelector) {
                        const nestedDiv = textarea.querySelector('div');
                        if (nestedDiv) {
                            rawText = nestedDiv.textContent || nestedDiv.innerText || '';
                        }
                    }
                    break;
                }
            } catch (err) {
                console.warn(`[PII Extension] Error evaluating selector ${selector}:`, err);
            }
        }

        const normalized = rawText ? rawText.normalize('NFC') : '';
        console.log(`[PII Extension] Extracted ${normalized.length} chars from chat input`);
        // Use textarea as editor for ChatGPT/Gemini
        return { text: normalized, editor: textarea, pageType };
    }

    // For other page types, try to use textProcessing module if available
    const textProcessingModule = window.PIIExtension?.textProcessing;
    let editor = null;
    
    if (textProcessingModule && textProcessingModule.findContentArea) {
        editor = textProcessingModule.findContentArea();
    }
    
    if (!editor) {
        // Fallback: use document.body
        editor = document.body;
    }
    
    const docText = editor.textContent || editor.innerText || '';
    const normalized = docText ? docText.normalize('NFC') : '';
    return { text: normalized, editor, pageType };
}

function getAssistantResponseSelectors(pageType = pageDetection.detectPageType()) {
    const genericSelectors = [
        'div[data-message-author-role="assistant"]',
        'div[data-testid*="conversation-turn"]',
        'div[data-testid*="assistant"]',
        'div[data-testid="message-bubble"]',
        'div[data-testid="response-message"]',
        'div[data-testid*="model-response"]',
        'div[class*="message"]',
        'div[class*="response"]',
        'div[class*="assistant"]',
        'main div:not([data-message-author-role]) div[data-testid="markdown"]'
    ];

    if (pageType === 'gemini') {
        return [
            'div[aria-label*="Gemini"]',
            'div[data-message-author-role="model"]',
            'div[aria-live="polite"] div',
            ...genericSelectors
        ];
    }

    return genericSelectors;
}

function countAssistantMessages(pageType = pageDetection.detectPageType()) {
    const selectors = getAssistantResponseSelectors(pageType);
    const uniqueElements = new Set();
    selectors.forEach(selector => {
        try {
            document.querySelectorAll(selector).forEach(node => uniqueElements.add(node));
        } catch (error) {
            // ignore selector errors
        }
    });
    return uniqueElements.size;
}

function findChatInterfaceSendButton(pageType = pageDetection.detectPageType()) {
    const sendButtonSelectors = [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        '[data-testid="send-button"]',
        'button[type="submit"]',
        'button.send-button',
        'button[class*="send"]',
        'button[aria-label*="Answer"]'
    ];

    for (const selector of sendButtonSelectors) {
        try {
            const button = document.querySelector(selector);
            if (button) {
                return button;
            }
        } catch (error) {
            // ignore
        }
    }
    return null;
}

function triggerChatInterfaceSend(pageType = pageDetection.detectPageType()) {
    const agentState = window.PIIExtension.getAgentPipelineState();
    if (agentState.justSent) {
        console.log('[PII Extension] Send already triggered, skipping duplicate');
        return true;
    }
    
    const sendButton = findChatInterfaceSendButton(pageType);
    if (sendButton) {
        try {
            if (sendButton.disabled) {
                sendButton.disabled = false;
            }
            sendButton.removeAttribute('disabled');
            sendButton.style.pointerEvents = 'auto';
            sendButton.style.opacity = '1';
            
            agentState.justSent = true;
            setTimeout(() => {
                agentState.justSent = false;
            }, 3000);
            
            sendButton.click();
            console.log('[PII Extension] Triggered native send button');
            return true;
        } catch (error) {
            agentState.justSent = false;
            console.warn('[PII Extension] Error triggering send button:', error);
        }
    }

    const textareaResult = findChatGPTTextarea();
    const textarea = textareaResult?.textarea;
    if (textarea) {
        const options = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
        textarea.dispatchEvent(new KeyboardEvent('keydown', options));
        textarea.dispatchEvent(new KeyboardEvent('keypress', options));
        textarea.dispatchEvent(new KeyboardEvent('keyup', options));
        console.log('[PII Extension] Fallback: dispatched Enter key events');
        return true;
    }

    console.warn('[PII Extension] Unable to trigger chat send action');
    return false;
}

function waitForAssistantResponse(pageType, baselineCount, timeout = 60000) {
    return new Promise((resolve, reject) => {
        const targetPage = pageType || pageDetection.detectPageType();
        let lastCount = baselineCount;
        let stableCount = 0;
        
        const checkCount = () => {
            const current = countAssistantMessages(targetPage);
            if (current > baselineCount) {
                const selectors = getAssistantResponseSelectors(targetPage);
                for (const selector of selectors) {
                    try {
                        const elements = document.querySelectorAll(selector);
                        for (const el of Array.from(elements).slice(-1)) {
                            const text = el.textContent || el.innerText || '';
                            if (text.trim().length > 20) {
                                return current;
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }
            return current;
        };

        const checkResponse = () => {
            const current = checkCount();
            if (current > baselineCount) {
                if (current === lastCount) {
                    stableCount++;
                    if (stableCount >= 3) {
                        cleanup();
                        resolve();
                        return;
                    }
                } else {
                    stableCount = 0;
                    lastCount = current;
                }
            }
        };

        checkResponse();

        const observer = new MutationObserver(() => {
            checkResponse();
        });

        const timer = setTimeout(() => {
            cleanup();
            if (checkCount() > baselineCount) {
                resolve();
            } else {
                reject(new Error('Timed out waiting for assistant response'));
            }
        }, timeout);

        const cleanup = () => {
            observer.disconnect();
            clearTimeout(timer);
        };

        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
}

// Export to global namespace
window.PIIExtension.chatIntegration = {
    findChatGPTTextarea,
    setChatGPTInputValue,
    toggleChatGPTSendButton,
    getCurrentPromptText,
    getAssistantResponseSelectors,
    countAssistantMessages,
    findChatInterfaceSendButton,
    triggerChatInterfaceSend,
    waitForAssistantResponse
};

})(); // End IIFE
