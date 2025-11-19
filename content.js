// --- PII Detector with Backend API ---
// This script connects to the Presidio backend for real PII detection.
console.log("PII Detector Content Script Loaded! (Backend API Mode)");

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

// Highlighting class (must synchronize with style.css)
const HIGHLIGHT_CLASS = 'pii-highlight'; 
const REDACT_BTN_CLASS = 'pii-redact-btn';
const SUGGESTION_POPUP_CLASS = 'pii-suggestion-popup';
const REJECTED_CLASS = 'pii-rejected';

// Track suggestion states
const suggestionStates = new Map(); // Store accept/reject decisions

// Current selected model for PII detection
let currentModel = 'presidio'; // Default model (now using real Presidio backend)

// Backend API configuration
const BACKEND_API_URL = 'https://lucky-coffee-somerset-collectible.trycloudflare.com/detect-pii';
const BACKEND_HEALTH_URL = 'https://lucky-coffee-somerset-collectible.trycloudflare.com//health';
// Model configurations with different mock data sets
const MODEL_CONFIGS = {
    piranha: {
        name: " Piranha",
        description: "Fast and aggressive PII detection",
        accuracy: "High"
    },
    presidio: {
        name: " Presidio", 
        description: "Microsoft's PII detection engine",
        accuracy: "Very High"
    },
    ai4privacy: {
        name: " AI4Privacy",
        description: "Privacy-focused detection model",
        accuracy: "High"
    },
    bdmbz: {
        name: " BDMBZ",
        description: "Lightning-fast detection",
        accuracy: "Medium"
    },
    nemo: {
        name: " NEMO",
        description: "Precision-targeted detection",
        accuracy: "Very High"
    },
    auto: {
        name: " Auto Select",
        description: "Adaptive selector",
        accuracy: "Dynamic"
    }
};

const MODE_CONTROL = 'control';
const MODE_AGENT = 'agent';
const MODEL_AUTO = 'auto';
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

function getModelDisplayName(modelKey) {
    const config = MODEL_CONFIGS[modelKey];
    return (config?.name || modelKey).trim();
}

function getLastModelName() {
    return getModelDisplayName(lastResolvedModel || currentModel);
}

function getCurrentPromptText(preDetectedPageType) {
    const pageType = preDetectedPageType || detectPageType();
    const editor = findContentArea();
    if (!editor) {
        console.warn('[PII Extension] Editor not found while fetching prompt text');
        return { text: '', editor: null, pageType };
    }

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
        return { text: normalized, editor, pageType };
    }

    const docText = editor.textContent || editor.innerText || '';
    const normalized = docText ? docText.normalize('NFC') : '';
    return { text: normalized, editor, pageType };
}

function showAutoModelPopup(modelName, reason, title = 'Model Selected') {
    const container = document.getElementById('pii-scan-container');
    const popup = document.createElement('div');
    popup.className = 'pii-auto-model-popup';
    popup.setAttribute('role', 'status');
    popup.setAttribute('aria-live', 'polite');
    popup.innerHTML = `
        <div class="pii-auto-model-title">${title}</div>
        <div class="pii-auto-model-body">
            <span class="pii-auto-model-name">${modelName}</span>
            <span class="pii-auto-model-reason">${reason}</span>
        </div>
    `;

    if (container) {
        container.appendChild(popup);
    } else {
        document.body.appendChild(popup);
    }

    requestAnimationFrame(() => popup.classList.add('visible'));

    setTimeout(() => {
        popup.classList.remove('visible');
        setTimeout(() => popup.remove(), 250);
    }, 4000);
}

function getOrCreateActionBar(container) {
    if (!container) return null;
    let actionBar = container.querySelector('.pii-action-bar');
    if (actionBar) {
        return actionBar;
    }
    actionBar = document.createElement('div');
    actionBar.className = 'pii-action-bar';
    actionBar.setAttribute('data-pii-drag-handle', 'true');
    const referenceNode = container.firstChild;
    if (referenceNode) {
        container.insertBefore(actionBar, referenceNode);
    } else {
        container.appendChild(actionBar);
    }

    const existingInfo = container.querySelector('#pii-info-button');
    if (existingInfo) {
        actionBar.appendChild(existingInfo);
    }
    const existingCollapse = container.querySelector('#pii-collapse-button');
    if (existingCollapse) {
        actionBar.appendChild(existingCollapse);
    }
    return actionBar;
}

function ensureInfoButton(container) {
    if (!container) {
        return null;
    }
    const actionBar = getOrCreateActionBar(container);
    let infoButton = actionBar?.querySelector('#pii-info-button') || container.querySelector('#pii-info-button');
    if (infoButton) {
        if (actionBar && infoButton.parentElement !== actionBar) {
            actionBar.insertBefore(infoButton, actionBar.firstChild);
        }
        return infoButton;
    }
    infoButton = document.createElement('button');
    infoButton.id = 'pii-info-button';
    infoButton.type = 'button';
    infoButton.title = 'What is the PII detector?';
    infoButton.setAttribute('aria-label', 'Show PII detector information');
    infoButton.setAttribute('aria-haspopup', 'dialog');
    infoButton.textContent = '?';
    infoButton.classList.add('pii-action-button');
    infoButton.addEventListener('click', (event) => {
        if (blockClickIfDragging(event, container)) {
            return;
        }
        event.stopPropagation();
        showInfoPopup();
    });
    if (actionBar) {
        actionBar.insertBefore(infoButton, actionBar.firstChild);
    } else {
        container.appendChild(infoButton);
    }
    return infoButton;
}

function ensureInfoPopupElements() {
    let overlay = document.getElementById('pii-info-overlay');
    if (overlay) {
        return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'pii-info-overlay';
    overlay.className = 'pii-info-overlay';
    overlay.dataset.visible = 'false';
    overlay.setAttribute('aria-hidden', 'true');

    const popup = document.createElement('div');
    popup.id = 'pii-info-popup';
    popup.className = 'pii-info-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('tabindex', '-1');
    popup.innerHTML = `
        <button type="button" class="pii-info-close" aria-label="Close info panel">&times;</button>
        <div class="pii-info-header">
            <h2>Welcome to PII detector</h2>
            <p>This extension aims to protect your personally identifiable information in your LLM chats while preserving an easy, natural chat experience.</p>
        </div>
        <div class="pii-info-section">
            <h3>Control mode</h3>
            <ul>
                <li><strong>Detect PII</strong> - Uses your selected model to highlight PIIs so you can accept or reject each suggestion.</li>
                <li><strong>Accept all</strong> - Apply every suggestion in one click.</li>
                <li><strong>Mask</strong> - Replaces each PII with class tags such as [NAME].</li>
                <li><strong>Fill</strong> - Populates the masked tags with realistic random information.</li>
                <li><strong>Revert</strong> - Restores your LLM response with the original PIIs when you are ready.</li>
            </ul>
        </div>
        <div class="pii-info-section">
            <h3>Agentic mode</h3>
            <p>The pipeline from control mode is executed automatically so you can stay hands-free.</p>
        </div>
        <div class="pii-info-section">
            <h3>Sample chat</h3>
            <pre class="pii-info-sample">User: Doctor, please schedule a follow up for John Doe at 555-0199.
Detect PII -> highlights "John Doe" and "555-0199"
Mask -> [NAME], [PHONE_NUMBER]
Fill -> Inserts synthetic but realistic values
Revert -> Restores your original PIIs when you need them back.</pre>
        </div>
        <div class="pii-info-section">
            <h3>Model selection</h3>
            <ul class="pii-info-models">
                <li><strong>Presidio</strong> - Highest overall ECHR F1; excels on Western names, dates, and US/CA/DE provinces. Ideal default for Western-style data, but combine with a multilingual model for broader city coverage.</li>
                <li><strong>Piranha</strong> - Lowest hallucination rate with best precision on city/town mentions and mixed-script surnames. Pair it with another model if you truly need full address strings, provinces, or postal codes.</li>
                <li><strong>AI4Privacy</strong> - Top performer on time expressions and general numeric patterns. Best when the text is timestamp or number heavy; weaker on names and cities.</li>
                <li><strong>HuggingFace (BDMBZ)</strong> - High recall on Western structured entities (given name + surname, multi-surname, provinces, general city lists). Treat it as the broad Western coverage option rather than a multilingual specialist.</li>
                <li><strong>NeMo</strong> - Captures long narrative addresses, informal/relative locations, and ZIP codes better than the rest. Expect weaker coverage on provinces/countries and some foreign names.</li>
                <li><strong>Auto</strong> - Automatically picks and combines models for balanced precision and recall based on your detected text type.</li>
            </ul>
        </div>
        <label class="pii-info-checkbox">
            <input type="checkbox" id="pii-info-hide-checkbox">
            Do not show it again
        </label>
        <button type="button" class="pii-info-dismiss" id="pii-info-dismiss-button">Got it</button>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            hideInfoPopup();
        }
    });

    const closeButton = popup.querySelector('.pii-info-close');
    if (closeButton) {
        closeButton.addEventListener('click', hideInfoPopup);
    }

    const footerDismiss = popup.querySelector('#pii-info-dismiss-button');
    if (footerDismiss) {
        footerDismiss.addEventListener('click', hideInfoPopup);
    }

    const checkbox = popup.querySelector('#pii-info-hide-checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', (event) => {
            if (event.target.checked) {
                localStorage.setItem(INFO_POPUP_STORAGE_KEY, 'true');
            } else {
                localStorage.removeItem(INFO_POPUP_STORAGE_KEY);
            }
        });
    }

    return overlay;
}

function showInfoPopup() {
    const overlay = ensureInfoPopupElements();
    const checkbox = overlay.querySelector('#pii-info-hide-checkbox');
    if (checkbox) {
        checkbox.checked = localStorage.getItem(INFO_POPUP_STORAGE_KEY) === 'true';
    }
    overlay.dataset.visible = 'true';
    overlay.setAttribute('aria-hidden', 'false');
    const popup = overlay.querySelector('#pii-info-popup');
    popup?.focus?.({ preventScroll: true });
}

function hideInfoPopup() {
    const overlay = document.getElementById('pii-info-overlay');
    if (!overlay) return;
    overlay.dataset.visible = 'false';
    overlay.setAttribute('aria-hidden', 'true');
}

function maybeAutoShowInfoPopup() {
    try {
        if (localStorage.getItem(INFO_POPUP_STORAGE_KEY) === 'true') {
            return;
        }
        if (window[INFO_POPUP_AUTO_FLAG]) {
            return;
        }
        window[INFO_POPUP_AUTO_FLAG] = true;
        showInfoPopup();
    } catch (error) {
        console.warn('[PII Extension] Unable to show info popup automatically:', error);
    }
}

function blockClickIfDragging(event, container) {
    if (container?.dataset?.piiSuppressNextClick === 'true') {
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    return false;
}

function setupCollapseButtonInteraction(button, container) {
    if (!button) return;
    button.setAttribute('data-pii-drag-handle', 'true');
    button.onclick = (event) => {
        if (blockClickIfDragging(event, container)) {
            return;
        }
        event.stopPropagation();
        toggleContainerCollapse(container);
    };
}

function isAgentSupportedPage(pageType = detectPageType()) {
	return pageType === 'chatgpt' || pageType === 'gemini';
}

function setExtensionMode(mode) {
	if (mode !== MODE_CONTROL && mode !== MODE_AGENT) return;
	extensionMode = mode;
	localStorage.setItem('pii-extension-mode', mode);
	updateModeUIState();
	const label = mode === MODE_AGENT
		? 'Agent mode enabled. Send Anonymized will run the full workflow automatically.'
		: 'Control mode enabled. Manual workflow restored.';
	showAgentToast(label, 'info');
}

function handleModeChange(event) {
	const selectedMode = event?.target?.value;
	if (selectedMode && selectedMode !== extensionMode) {
		setExtensionMode(selectedMode);
	}
}

function updateModeUIState() {
	const modeSelect = document.getElementById('pii-mode-select');
	if (modeSelect && modeSelect.value !== extensionMode) {
		modeSelect.value = extensionMode;
	}

	const sendButton = document.getElementById('pii-send-anonymized-button');
	const pageType = detectPageType();
	const canAutomate = extensionMode === MODE_AGENT && isAgentSupportedPage(pageType);
	if (sendButton) {
		sendButton.style.display = canAutomate ? 'block' : 'none';
		sendButton.disabled = !canAutomate || agentPipelineState.running;
		if (!agentPipelineState.running) {
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

function getAssistantResponseSelectors(pageType = detectPageType()) {
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

function countAssistantMessages(pageType = detectPageType()) {
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

function findChatInterfaceSendButton(pageType = detectPageType()) {
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

function triggerChatInterfaceSend(pageType = detectPageType()) {
	if (agentPipelineState.justSent) {
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
			
			agentPipelineState.justSent = true;
			setTimeout(() => {
				agentPipelineState.justSent = false;
			}, 3000);
			
			sendButton.click();
			console.log('[PII Extension] Triggered native send button');
			return true;
		} catch (error) {
			agentPipelineState.justSent = false;
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
		const targetPage = pageType || detectPageType();
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

	if (extensionMode !== MODE_AGENT) {
		setExtensionMode(MODE_AGENT);
	}

	const pageType = detectPageType();
	if (!isAgentSupportedPage(pageType)) {
		showAgentToast('Agent automations only run on ChatGPT or Gemini.', 'error');
		return;
	}

	if (agentPipelineState.running) {
		showAgentToast('Agent workflow already in progress. Please wait.', 'info');
		return;
	}

	agentPipelineState.running = true;
	setSendAnonymizedButtonState(true, `<span role="img" aria-label="Processing">⏳</span> Automating...`);

	try {
		// Ensure textarea is ready and has content
		const textareaResult = findChatGPTTextarea();
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
		
		const baselineResponses = countAssistantMessages(pageType);
		await handleScanClick();
		await new Promise(resolve => setTimeout(resolve, 150));
		
		// Verify scan found PII
		if (!window.piiMapping || window.piiMapping.size === 0) {
			console.warn('[PII Extension] No PII detected in scan, but continuing workflow');
		} else {
			console.log(`[PII Extension] Scan found ${window.piiMapping.size} PII items`);
		}
		
		acceptAllPII();
		await new Promise(resolve => setTimeout(resolve, 120));
		fillRedactions();
		await new Promise(resolve => setTimeout(resolve, 120));

	if (pageType === 'chatgpt') {
		try {
			toggleChatGPTSendButton(true);
		} catch (error) {
			console.warn('[PII Extension] Unable to re-enable ChatGPT send button before auto-send:', error);
		}
	}

		const sent = triggerChatInterfaceSend(pageType);
		if (!sent) {
			throw new Error('Unable to trigger send action on this page.');
		}

		agentPipelineState.awaitingResponse = true;
		showAgentToast('Prompt sent with anonymized data. Awaiting response...', 'info');

		await waitForAssistantResponse(pageType, baselineResponses);
		
		// Wait for response to stabilize (stop changing)
		let lastResponseText = '';
		let stableCount = 0;
		for (let i = 0; i < 10; i++) {
			await new Promise(resolve => setTimeout(resolve, 300));
			const selectors = getAssistantResponseSelectors(pageType);
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
			clearHighlights(false);
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
			revertPIIsInResponse();
			await new Promise(resolve => setTimeout(resolve, 400));
			
			// Then, do an aggressive location-specific revert
			if (locationMappings.length > 0) {
				console.log('[PII Extension] Performing location-specific revert...');
				revertLocationsAggressively(locationMappings);
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
					revertPIIsInDocumentBody(filledMappings);
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
		agentPipelineState.running = false;
		agentPipelineState.awaitingResponse = false;
		agentPipelineState.justSent = false;
		
		// Ensure textarea is ready for next use
		try {
			const textareaResult = findChatGPTTextarea();
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

function getMiniTrigger() {
    return document.getElementById('pii-mini-trigger');
}

function applyMiniPosition(miniTrigger, position) {
    if (!miniTrigger || !position) return;
    const width = miniTrigger.offsetWidth || 56;
    const height = miniTrigger.offsetHeight || 56;
    const top = Math.max(0, Math.min(position.top ?? 15, window.innerHeight - height));
    const left = Math.max(0, Math.min(position.left ?? (window.innerWidth - width - 15), window.innerWidth - width));
    miniTrigger.style.top = top + 'px';
    miniTrigger.style.left = left + 'px';
    miniTrigger.style.right = 'auto';
    miniTrigger.style.bottom = 'auto';
}

function ensureMiniTrigger(container) {
    let miniTrigger = getMiniTrigger();
    if (!miniTrigger) {
        miniTrigger = document.createElement('button');
        miniTrigger.id = 'pii-mini-trigger';
        miniTrigger.type = 'button';
        miniTrigger.setAttribute('aria-label', 'Open PII control panel');
        miniTrigger.setAttribute('data-pii-mini', 'true');
        miniTrigger.setAttribute('data-pii-drag-handle', 'true');
        miniTrigger.textContent = '🛡️';
        miniTrigger.style.display = 'none';
        document.body.appendChild(miniTrigger);
        makeMiniTriggerDraggable(miniTrigger);
        miniTrigger.addEventListener('click', (event) => {
            if (blockClickIfDragging(event, miniTrigger)) {
                return;
            }
            const panel = document.getElementById('pii-scan-container');
            if (panel) {
                expandContainer(panel);
            }
        });
    }
    if (container && !miniTrigger.dataset.piiTarget) {
        miniTrigger.dataset.piiTarget = container.id;
    }
    miniTrigger.dataset.active = 'true';
    miniTrigger.style.display = 'flex';
    miniTrigger.style.pointerEvents = 'auto';
    miniTrigger.style.opacity = '1';
    return miniTrigger;
}

function makeMiniTriggerDraggable(miniTrigger) {
    if (!miniTrigger || miniTrigger.hasAttribute('data-mini-draggable')) return;
    miniTrigger.setAttribute('data-mini-draggable', 'true');
    miniTrigger.style.position = 'fixed';
    miniTrigger.style.zIndex = '999999';
    miniTrigger.style.width = miniTrigger.style.width || '56px';
    miniTrigger.style.height = miniTrigger.style.height || '56px';
    miniTrigger.style.borderRadius = '50%';
    miniTrigger.style.border = 'none';
    miniTrigger.style.cursor = 'grab';
    miniTrigger.style.touchAction = 'none';
    miniTrigger.style.fontSize = '28px';
    miniTrigger.style.alignItems = 'center';
    miniTrigger.style.justifyContent = 'center';
    miniTrigger.style.display = miniTrigger.style.display || 'none';
    const savedPosition = localStorage.getItem('pii-container-collapsed-position');
    if (savedPosition) {
        try {
            const parsed = JSON.parse(savedPosition);
            applyMiniPosition(miniTrigger, parsed);
        } catch (err) {
            console.warn('[PII Extension] Unable to restore mini trigger position:', err);
        }
    }

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    let dragMoved = false;
    let startClientX = 0;
    let startClientY = 0;
    let activePointerId = null;

    const startDrag = (clientX, clientY) => {
        const rect = miniTrigger.getBoundingClientRect();
        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;
        startClientX = clientX;
        startClientY = clientY;
        dragMoved = false;
        isDragging = true;
        miniTrigger.style.cursor = 'grabbing';
        miniTrigger.style.transition = 'none';
    };

    const updatePosition = (clientX, clientY) => {
        const width = miniTrigger.offsetWidth || 56;
        const height = miniTrigger.offsetHeight || 56;
        const newLeft = Math.max(0, Math.min(clientX - offsetX, window.innerWidth - width));
        const newTop = Math.max(0, Math.min(clientY - offsetY, window.innerHeight - height));
        if (!dragMoved && (Math.abs(clientX - startClientX) > 3 || Math.abs(clientY - startClientY) > 3)) {
            dragMoved = true;
        }
        miniTrigger.style.left = newLeft + 'px';
        miniTrigger.style.top = newTop + 'px';
        miniTrigger.style.right = 'auto';
        miniTrigger.style.bottom = 'auto';
    };

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        activePointerId = null;
        miniTrigger.style.cursor = 'grab';
        miniTrigger.style.transition = '';
        const rect = miniTrigger.getBoundingClientRect();
        const position = { top: rect.top, left: rect.left };
        localStorage.setItem('pii-container-collapsed-position', JSON.stringify(position));
        if (dragMoved) {
            miniTrigger.dataset.piiSuppressNextClick = 'true';
            setTimeout(() => {
                if (miniTrigger?.dataset) {
                    delete miniTrigger.dataset.piiSuppressNextClick;
                }
            }, 0);
        }
    };

    const usePointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;

    if (usePointerEvents) {
        miniTrigger.addEventListener('pointerdown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            activePointerId = event.pointerId;
            event.preventDefault();
            startDrag(event.clientX, event.clientY);
        }, { passive: false });

        document.addEventListener('pointermove', (event) => {
            if (!isDragging) return;
            if (activePointerId !== null && event.pointerId !== activePointerId) return;
            event.preventDefault();
            updatePosition(event.clientX, event.clientY);
        }, { passive: false });

        document.addEventListener('pointerup', (event) => {
            if (activePointerId !== null && event.pointerId !== activePointerId) return;
            endDrag();
        });

        document.addEventListener('pointercancel', (event) => {
            if (activePointerId !== null && event.pointerId !== activePointerId) return;
            endDrag();
        });
    } else {
        miniTrigger.addEventListener('mousedown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            startDrag(event.clientX, event.clientY);
        });

        document.addEventListener('mousemove', (event) => {
            if (!isDragging) return;
            event.preventDefault();
            updatePosition(event.clientX, event.clientY);
        });

        document.addEventListener('mouseup', endDrag);

        miniTrigger.addEventListener('touchstart', (event) => {
            if (event.touches.length > 1) return;
            event.preventDefault();
            const touch = event.touches[0];
            startDrag(touch.clientX, touch.clientY);
        }, { passive: false });

        document.addEventListener('touchmove', (event) => {
            if (!isDragging) return;
            const touch = event.touches[0];
            if (!touch) return;
            event.preventDefault();
            updatePosition(touch.clientX, touch.clientY);
        }, { passive: false });

        document.addEventListener('touchend', endDrag);
        document.addEventListener('touchcancel', endDrag);
    }
}

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
                        // Check for status and either presidio_initialized or presidio field
                        const isHealthy = data.status === 'healthy' && 
                            (data.presidio_initialized === true || data.presidio === true);
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
            
            chrome.runtime.sendMessage(
                {
                    action: 'detectPII',
                    text: text,
                    language: 'en',
                    model: model
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

// Fallback to mock data if backend is unavailable (for development/testing)
// COMMENTED OUT: Mock data backup code disabled
/*
function getMockPIIData(model = 'presidio') {
    console.warn("[PII Extension] Using fallback mock data - backend unavailable");
    const baseEntities = [
        { "type": "PERSON", "start": 5, "end": 8, "value": "İde" },
        { "type": "PERSON", "start": 42, "end": 54, "value": "Neris Yılmaz" },
        { "type": "EMAIL", "start": 286, "end": 313, "value": "yücel.saygin@sabanciuniv.edu" },
        { "type": "EMAIL", "start": 316, "end": 337, "value": "emregursoy@gmail.com" },
        { "type": "PHONE", "start": 180, "end": 193, "value": "545 333 66 78" }
    ];

    return {
        "has_pii": baseEntities.length > 0,
        "detected_entities": baseEntities,
        "total_entities": baseEntities.length,
        "model_used": model,
        "confidence_threshold": 0.8
    };
}
*/

// Inject the Scan button into the Google Docs interface
function injectScanButton() {
  let container = document.getElementById("pii-scan-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "pii-scan-container";
    container.style.maxWidth = '220px';

    const scanButton = document.createElement("button");
    scanButton.id = "pii-scan-button";
    scanButton.innerHTML = `<span role="img" aria-label="Shield">🛡️</span> Scan for PII`;
    scanButton.setAttribute('data-pii-drag-handle', 'true');
    scanButton.addEventListener('click', (event) => {
      if (blockClickIfDragging(event, container)) {
        return;
      }
      handleScanClick(event);
    });

    const clearButton = document.createElement("button");
    clearButton.id = "pii-clear-button";
    clearButton.innerHTML = `<span role="img" aria-label="Clear">❌</span> Clear Highlights`;
    clearButton.onclick = clearHighlights;

    const acceptAllButton = document.createElement("button");
    acceptAllButton.id = "pii-accept-all-button";
    acceptAllButton.innerHTML = `<span role="img" aria-label="Accept All">✅</span> Accept All`;
    acceptAllButton.onclick = acceptAllPII;

    const fillButton = document.createElement("button");
    fillButton.id = "pii-fill-button";
    fillButton.innerHTML = `<span role="img" aria-label="Fill">🪄</span> Fill (faker)`;
    fillButton.onclick = () => {
        try {
            fillRedactions();
        } catch (e) {
            console.error('[PII Extension] Error in Fill button:', e);
        }
    };

    const revertButton = document.createElement("button");
    revertButton.id = "pii-revert-button";
    revertButton.innerHTML = `<span role="img" aria-label="Revert">↩️</span> Revert PIIs`;
    revertButton.onclick = () => {
        try {
            revertPIIsInResponse();
        } catch (e) {
            console.error('[PII Extension] Error in Revert button:', e);
        }
    };

    const modelSelectContainer = document.createElement("div");
    modelSelectContainer.id = "pii-model-container";

    const modelLabel = document.createElement("label");
    modelLabel.htmlFor = "pii-model-select";
    modelLabel.textContent = "Model:";
    modelLabel.style.fontSize = "12px";
    modelLabel.style.color = "#048BA8";
    modelLabel.style.fontWeight = "600";
    modelLabel.style.marginBottom = "4px";
    modelLabel.style.display = "block";

    const modelSelect = document.createElement("select");
    modelSelect.id = "pii-model-select";
    modelSelect.innerHTML = `
        <option value="auto">🤖 Auto Select</option>
        <option value="piranha">🐟 Piranha</option>
        <option value="presidio">🛡️ Presidio</option>
        <option value="ai4privacy">🔒 AI4Privacy</option>
        <option value="bdmbz">⚡ BDMBZ</option>
        <option value="nemo">🎯 NEMO</option>
    `;
    modelSelect.value = currentModel;
    modelSelect.onchange = handleModelChange;

    modelSelectContainer.appendChild(modelLabel);
    modelSelectContainer.appendChild(modelSelect);

	const modeContainer = document.createElement('div');
	modeContainer.id = 'pii-mode-toggle';

	const modeLabel = document.createElement('label');
	modeLabel.htmlFor = 'pii-mode-select';
	modeLabel.textContent = 'Workflow Mode';
	modeLabel.style.fontSize = '12px';
	modeLabel.style.marginBottom = '4px';
	modeLabel.style.display = 'block';
	modeContainer.appendChild(modeLabel);

	const modeSelect = document.createElement('select');
	modeSelect.id = 'pii-mode-select';
	modeSelect.innerHTML = `
		<option value="${MODE_CONTROL}">Control Mode (Manual)</option>
		<option value="${MODE_AGENT}">Agent Mode (Auto)</option>
	`;
	modeSelect.value = extensionMode;
	modeSelect.onchange = handleModeChange;
	modeContainer.appendChild(modeSelect);

	modeContainer.style.maxWidth = '200px';
	modeSelect.style.width = '100%';

	const sendAnonymizedButton = document.createElement('button');
	sendAnonymizedButton.id = 'pii-send-anonymized-button';
	sendAnonymizedButton.innerHTML = `<span role="img" aria-label="Agent">🤖</span> Send Anonymized`;
	sendAnonymizedButton.onclick = handleSendAnonymizedClick;
	sendAnonymizedButton.style.display = 'none';

    const collapseButton = document.createElement("button");
    collapseButton.id = "pii-collapse-button";
    collapseButton.innerHTML = `<span role="img" aria-label="Collapse">−</span>`;
    collapseButton.title = "Minimize panel";
    collapseButton.classList.add('pii-action-button', 'pii-collapse-button');
    setupCollapseButtonInteraction(collapseButton, container);

    container.style.position = 'relative';

    const actionBar = getOrCreateActionBar(container);
    if (actionBar) {
        actionBar.appendChild(collapseButton);
    }
    container.appendChild(scanButton);
    container.appendChild(clearButton);
    container.appendChild(acceptAllButton);
    container.appendChild(fillButton);
    container.appendChild(revertButton);
    container.appendChild(modelSelectContainer);
	container.appendChild(modeContainer);
	container.appendChild(sendAnonymizedButton);

    makeContainerDraggable(container);
    initializeContainerCollapse(container);
    document.body.appendChild(container);
	updateModeUIState();
    console.log("PII Scan buttons injected successfully to document.body");
  } else {
    console.log("PII Scan container already exists, skipping injection");
    if (!container.hasAttribute('data-draggable-initialized')) {
      makeContainerDraggable(container);
    }
	updateModeUIState();
  }

  if (container) {
    ensureInfoButton(container);
  }
  maybeAutoShowInfoPopup();
}

// Make the PII scan container draggable
function makeContainerDraggable(container) {
  if (!container) return;
  
  // Mark as initialized to avoid duplicate initialization
  container.setAttribute('data-draggable-initialized', 'true');
  
  // Load saved position from localStorage
  const savedPosition = localStorage.getItem('pii-container-position');
  if (savedPosition) {
    try {
      const { top, left } = JSON.parse(savedPosition);
      // Validate position is within viewport
      if (typeof top === 'number' && typeof left === 'number' && 
          top >= 0 && left >= 0 && 
          top < window.innerHeight && left < window.innerWidth) {
        container.style.top = top + 'px';
        container.style.left = left + 'px';
        container.style.right = 'auto';
        container.style.bottom = 'auto';
      }
    } catch (e) {
      console.warn('[PII Extension] Error loading saved position:', e);
    }
  }
  
  let isDragging = false;
  let initialX;
  let initialY;
  let dragMoved = false;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let activePointerId = null;

  const resolveElementTarget = (target) => {
    if (!target) return null;
    if (target.nodeType === 1) {
      return target;
    }
    return target.parentElement || null;
  };

  const canDragFromTarget = (rawTarget) => {
    const target = resolveElementTarget(rawTarget);
    if (!target) return false;
    const insideContainer = target === container || target.closest('#pii-scan-container') === container;
    if (!insideContainer) return false;
    if (container.classList.contains('pii-collapsed')) {
      return true;
    }
    if (target.closest('[data-pii-drag-handle="true"]')) {
      return true;
    }
    return !target.closest('button') && !target.closest('select') && !target.closest('label');
  };
  
  // Drag handle removed - user prefers dragging from container background only
  // const dragHandle = document.createElement('div');
  // dragHandle.style.cssText = `
  //   width: 100%;
  //   height: 30px;
  //   background: linear-gradient(135deg, #048BA8 0%, #22D3EE 100%);
  //   border-radius: 8px 8px 0 0;
  //   cursor: move;
  //   display: flex;
  //   align-items: center;
  //   justify-content: center;
  //   position: relative;
  //   margin-bottom: 8px;
  //   user-select: none;
  // `;
  // dragHandle.innerHTML = '<span style="color: white; font-size: 12px; font-weight: 600;">⋮⋮ Drag to move</span>';
  // dragHandle.title = 'Drag to move the extension panel';
  // 
  // // Insert drag handle at the beginning
  // container.insertBefore(dragHandle, container.firstChild);
  // 
  // // Mouse down on drag handle
  // dragHandle.addEventListener('mousedown', dragStart);
  
  const usePointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;

  // Mouse down on container (for dragging from container background)
  if (!usePointerEvents) {
    container.addEventListener('mousedown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (canDragFromTarget(e.target)) {
        dragStart(e);
      }
    });
    
    // Touch events for mobile support
    container.addEventListener('touchstart', (e) => {
      if (canDragFromTarget(e.target)) {
        e.preventDefault();
        dragStart(e);
      }
    }, { passive: false });
  } else {
    container.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (!canDragFromTarget(e.target)) return;
      activePointerId = e.pointerId;
      e.preventDefault();
      dragStart(e);
    }, { passive: false });
  }
  
  function dragStart(e) {
    if (!canDragFromTarget(e.target)) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const pointerX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const pointerY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

    if (e.type === 'touchstart') {
      initialX = e.touches[0].clientX - rect.left;
      initialY = e.touches[0].clientY - rect.top;
    } else {
      initialX = e.clientX - rect.left;
      initialY = e.clientY - rect.top;
    }

    dragStartClientX = pointerX;
    dragStartClientY = pointerY;
    dragMoved = false;
    isDragging = true;
    container.style.cursor = container.classList.contains('pii-collapsed') ? 'grab' : 'move';
    container.style.transition = 'none'; // Disable transitions during drag
  }
  
  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      
      let clientX, clientY;
      if (e.type === 'touchmove') {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      if (!dragMoved) {
        const deltaX = Math.abs(clientX - dragStartClientX);
        const deltaY = Math.abs(clientY - dragStartClientY);
        if (deltaX > 3 || deltaY > 3) {
          dragMoved = true;
        }
      }
      
      // Calculate new position
      const newLeft = clientX - initialX;
      const newTop = clientY - initialY;
      
      // Constrain to viewport
      const rect = container.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      
      const constrainedLeft = Math.max(0, Math.min(newLeft, Math.max(0, maxLeft)));
      const constrainedTop = Math.max(0, Math.min(newTop, Math.max(0, maxTop)));
      
      container.style.left = constrainedLeft + 'px';
      container.style.top = constrainedTop + 'px';
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    }
  }
  
  function dragEnd(e) {
    if (usePointerEvents && activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) {
      return;
    }

    if (isDragging) {
      isDragging = false;
      activePointerId = null;
      container.style.cursor = 'default';
      container.style.transition = ''; // Re-enable transitions
      
      // Save position to localStorage (save as viewport-relative for fixed positioning)
      const rect = container.getBoundingClientRect();
      const position = {
        top: rect.top,
        left: rect.left
      };

      if (container.classList.contains('pii-collapsed')) {
        localStorage.setItem('pii-container-collapsed-position', JSON.stringify(position));
      } else {
        localStorage.setItem('pii-container-position', JSON.stringify(position));
      }

      if (dragMoved) {
        container.dataset.piiSuppressNextClick = 'true';
        setTimeout(() => {
          if (container?.dataset) {
            delete container.dataset.piiSuppressNextClick;
          }
        }, 0);
      }
    }
  }
  
  // Add event listeners
  if (usePointerEvents) {
    document.addEventListener('pointermove', (e) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) {
        return;
      }
      if (isDragging) {
        drag(e);
      }
    }, { passive: false });
    document.addEventListener('pointerup', dragEnd);
    document.addEventListener('pointercancel', dragEnd);
  } else {
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchmove', (e) => {
      if (isDragging) {
        e.preventDefault();
        drag(e);
      }
    }, { passive: false });
    document.addEventListener('touchend', dragEnd);
  }
}

// Initialize container collapse state
function initializeContainerCollapse(container) {
  const isCollapsed = localStorage.getItem('pii-container-collapsed') === 'true';
  if (isCollapsed) {
    collapseContainer(container);
  }
}

// Toggle container collapse/expand
function toggleContainerCollapse(container) {
  const isCollapsed = container.classList.contains('pii-collapsed');
  
  if (isCollapsed) {
    expandContainer(container);
  } else {
    collapseContainer(container);
  }
}

// Collapse container to minimal size - use dedicated draggable mini trigger
function collapseContainer(container) {
  if (!container) return;
  container.classList.add('pii-collapsed');

  const rect = container.getBoundingClientRect();
  const fallbackPosition = {
    top: Math.max(15, Math.min(rect.top, window.innerHeight - 64)),
    left: Math.max(15, Math.min(rect.left, window.innerWidth - 64))
  };

  let storedPosition = fallbackPosition;
  const savedCollapsedPosition = localStorage.getItem('pii-container-collapsed-position');
  if (savedCollapsedPosition) {
    try {
      const parsed = JSON.parse(savedCollapsedPosition);
      storedPosition = {
        top: typeof parsed.top === 'number' ? parsed.top : fallbackPosition.top,
        left: typeof parsed.left === 'number' ? parsed.left : fallbackPosition.left
      };
    } catch (err) {
      console.warn('[PII Extension] Error parsing collapsed position:', err);
    }
  } else {
    localStorage.setItem('pii-container-collapsed-position', JSON.stringify(storedPosition));
  }

  const miniTrigger = ensureMiniTrigger(container);
  applyMiniPosition(miniTrigger, storedPosition);

  container.dataset.originalDisplay = container.dataset.originalDisplay || getComputedStyle(container).display || 'flex';
  container.style.display = 'none';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';

  localStorage.setItem('pii-container-collapsed', 'true');
}

// Expand container to full size from mini trigger
function expandContainer(container) {
  if (!container) return;

  const miniTrigger = getMiniTrigger();
  const miniRect = miniTrigger?.dataset.active === 'true' ? miniTrigger.getBoundingClientRect() : null;

  if (miniTrigger) {
    miniTrigger.dataset.active = 'false';
    miniTrigger.style.display = 'none';
    miniTrigger.style.pointerEvents = 'none';
    miniTrigger.style.opacity = '0';
  }

  container.classList.remove('pii-collapsed');
  container.style.display = container.dataset.originalDisplay || 'flex';
  container.style.opacity = '1';
  container.style.pointerEvents = '';
  container.style.width = '';
  container.style.height = '';
  container.style.minWidth = '';
  container.style.minHeight = '';
  container.style.padding = '';
  container.style.borderRadius = '';
  container.style.overflow = '';

  const collapseBtn = container.querySelector('#pii-collapse-button');
  if (collapseBtn) {
    collapseBtn.innerHTML = '<span role="img" aria-label="Collapse">−</span>';
    collapseBtn.title = 'Minimize panel';
    setupCollapseButtonInteraction(collapseBtn, container);
  }

  let targetTop = 15;
  let targetLeft = 15;

  if (miniRect) {
    targetTop = Math.max(0, Math.min(miniRect.top, window.innerHeight - container.offsetHeight));
    targetLeft = Math.max(0, Math.min(miniRect.left, window.innerWidth - container.offsetWidth));
  } else {
    const savedPosition = localStorage.getItem('pii-container-position');
    if (savedPosition) {
      try {
        const parsed = JSON.parse(savedPosition);
        if (typeof parsed.top === 'number' && typeof parsed.left === 'number') {
          targetTop = parsed.top;
          targetLeft = parsed.left;
        }
      } catch (err) {
        console.warn('[PII Extension] Error restoring container position:', err);
      }
    }
  }

  container.style.top = targetTop + 'px';
  container.style.left = targetLeft + 'px';
  container.style.right = 'auto';
  container.style.bottom = 'auto';

  localStorage.setItem('pii-container-position', JSON.stringify({ top: targetTop, left: targetLeft }));
  localStorage.setItem('pii-container-collapsed', 'false');
}

// Universal content finder that works on different page types
function findContentArea() {
  const pageType = detectPageType();
  console.log(`Finding content area for page type: ${pageType}`);
  
  // IMPORTANT: For ChatGPT and Gemini, ONLY scan the input textarea
  // Never scan the conversation history
  if (pageType === 'chatgpt' || pageType === 'gemini') {
    console.log(`[PII Extension] ${pageType === 'gemini' ? 'Gemini' : 'ChatGPT'} detected - using textarea-only approach`);
    
    // Try multiple selectors for textarea/input fields
    const textareaSelectors = [
      'textarea[aria-label*="prompt"]',
      'textarea[aria-label*="message"]',
      'textarea[placeholder*="prompt"]',
      'textarea[placeholder*="message"]',
      'textarea[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea'
    ];
    
    let textarea = null;
    for (const selector of textareaSelectors) {
      textarea = document.querySelector(selector);
      if (textarea) {
        console.log(`[PII Extension] Found input field with selector: ${selector}`);
        break;
      }
    }
    
    if (textarea) {
      // Create a virtual container with ONLY the textarea content for scanning
      const virtualContainer = document.createElement('div');
      virtualContainer.textContent = textarea.value || textarea.textContent || '';
      console.log(`[PII Extension] Scanning only input field content (${virtualContainer.textContent.length} characters)`);
      return virtualContainer;
    } else {
      console.warn("[PII Extension] No textarea/input field found");
      return null;
    }
  }
  
  let contentSelectors = [];
  
  switch(pageType) {
    case 'google-docs':
      contentSelectors = [
        '.kix-page-content-wrap .kix-page',
        '.kix-page-content-wrap',
        '.kix-canvas-tile-content',
        '.kix-paginateddocument'
      ];
      break;
      
    case 'gmail':
       contentSelectors = [
        '.ii.gt .a3s.aiL', // Email message content (main)
        '.ii.gt .a3s', // Alternative message content
        '[role="listitem"] .a3s', // Message in conversation view
        '.adn.ads .a3s', // Message body alternative
        '.ii.gt', // Message container
        '.gs .a3s', // Another message format
        '.h7', // Email body alternative
        '.Am.Al.editable', // Compose window
        '[g_editable="true"]', // Gmail compose area
        '.editable', // Generic editable area
        '[contenteditable="true"]', // Any contenteditable area
        '.gmail_default' // Gmail default content
      ];
      break;
      
    default: // general-web
      contentSelectors = [
        'main',
        'article',
        '.content',
        '#content',
        '.post',
        '.entry-content',
        'body'
      ];
  }
  
  // Try each selector for non-ChatGPT pages
  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      console.log(`Testing selector: ${selector}`);
      console.log(`Element textContent length: ${element.textContent.length}`);
      console.log(`Sample content: "${element.textContent.substring(0, 200)}"`);
      
      const textNodes = getSimpleTextNodesIn(element);
      console.log(`Found ${textNodes.length} text nodes`);
      
      if (textNodes.length > 0) {
        // For Google Docs, check for document content
        if (pageType === 'google-docs') {
          const combinedText = textNodes.map(n => n.textContent).join(' ');
          if (combinedText.includes('İde') || combinedText.includes('Tuzla') || combinedText.includes('Neris')) {
            console.log(`Found Google Docs content using selector: ${selector}`);
            return element;
          }
        } else if (pageType === 'gmail') {
          // For Gmail, check if content contains email-like content or our PII
          const combinedText = textNodes.map(n => n.textContent).join(' ');
          console.log(`Gmail content sample: "${combinedText.substring(0, 100)}"`);
          if (combinedText.includes('İde') || combinedText.includes('Tuzla') || combinedText.includes('Neris') || 
              combinedText.includes('emregursoy@gmail.com') || combinedText.includes('yücel.saygin') ||
              combinedText.includes('@') || combinedText.length > 100) { // Email content indicators
            console.log(`Found Gmail email content using selector: ${selector}`);
            return element;
          }
        } else {
          // For other pages, any text content is good
          console.log(`Found content area using selector: ${selector}`);
          return element;
        }
      }
    }
  }
  
  // Fallback: use document.body for non-ChatGPT pages
  if (pageType !== 'chatgpt') {
    console.log("Using document.body as fallback");
    return document.body;
  }
  
  return null;
}

// Generate unique suggestion ID
function generateSuggestionId() {
    return 'suggestion_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Get redaction label based on PII type
function getRedactionLabel(piiType) {
    const labels = {
        'PERSON': '[NAME]',
        'LOCATION': '[LOCATION]', 
        'EMAIL': '[EMAIL]',
        'PHONE': '[PHONE]',
        'ORGANIZATION': '[ORGANIZATION]'
    };
    return labels[piiType] || '[REDACTED]';
}

// ============================================================================
// FAKER LIBRARY FOR SYNTHETIC DATA GENERATION
// ============================================================================

// Global memory structure to track: original PII -> masked version -> faked version
// Structure: window.piiMapping = Map<uniqueId, {original, masked, fake, type, position}>
if (!window.piiMapping) {
    window.piiMapping = new Map();
}

// Generate unique ID for each PII mapping
function generatePIIMappingId() {
    return 'pii_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Simple client-side Faker
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateFakeForType(type) {
    // Normalize
    const t = (type || '').toUpperCase();
    switch (t) {
        case 'PERSON':
        case 'NAME':
            return `${randomChoice(['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Sam', 'Jamie', 'Avery', 'Quinn'])} ${randomChoice(['Smith','Johnson','Brown','Garcia','Miller','Davis','Wilson','Moore','Taylor','Anderson'])}`;
        case 'EMAIL':
            const name = randomChoice(['alex', 'jordan', 'taylor', 'morgan', 'casey', 'riley', 'sam', 'jamie', 'avery', 'quinn']);
            return `${name}${Math.floor(Math.random()*90+10)}@example.com`;
        case 'PHONE':
        case 'PHONE_NUMBER':
            return `+1-${Math.floor(100+Math.random()*900)}-${Math.floor(100+Math.random()*900)}-${Math.floor(1000+Math.random()*9000)}`;
        case 'LOCATION':
        case 'ADDRESS':
            return `${Math.floor(100+Math.random()*900)} ${randomChoice(['Oak St','Maple Ave','Pine Rd','Elm St','Cedar Ln','Main St','Park Ave','First St','Second Ave'])}, ${randomChoice(['Springfield','Riverton','Lakewood','Fairview','Greenwood','Riverside','Hillcrest','Brookside'])}`;
        case 'ORGANIZATION':
        case 'COMPANY':
            return `${randomChoice(['Acme','Globex','Initech','Umbrella','Stark','Wayne','Oscorp','Cyberdyne','Tyrell'])} ${randomChoice(['LLC','Inc','Group','Co','Corp','Industries'])}`;
        case 'CREDIT_CARD':
            // Simple 16-digit pattern
            return `${Math.floor(4000+Math.random()*5000)} ${Math.floor(1000+Math.random()*9000)} ${Math.floor(1000+Math.random()*9000)} ${Math.floor(1000+Math.random()*9000)}`;
        case 'SSN':
        case 'US_SSN':
            return `${Math.floor(100+Math.random()*900)}-${Math.floor(10+Math.random()*90)}-${Math.floor(1000+Math.random()*9000)}`;
        case 'IP_ADDRESS':
            return `${Math.floor(1+Math.random()*220)}.${Math.floor(1+Math.random()*220)}.${Math.floor(1+Math.random()*220)}.${Math.floor(1+Math.random()*220)}`;
        case 'URL':
            return `https://www.${randomChoice(['example','demo','sample','testsite','placeholder'])}.com/${Math.random().toString(36).substring(2,8)}`;
        case 'DATE_TIME':
            return `${Math.floor(1+Math.random()*12)}/${Math.floor(1+Math.random()*28)}/20${Math.floor(20+Math.random()*6)}`;
        default:
            // Generic fallback - small random token
            return `${randomChoice(['Pat','Lee','Jo','De','Kim','Max'])}${Math.floor(Math.random()*9000)}`;
    }
}

// Map redaction labels to types
function labelToType(label) {
    if (!label) return null;
    const l = label.replace(/\[|\]/g, '').toUpperCase();
    switch (l) {
        case 'NAME': return 'PERSON';
        case 'EMAIL': return 'EMAIL';
        case 'PHONE': return 'PHONE';
        case 'LOCATION': return 'LOCATION';
        case 'ORGANIZATION': return 'ORGANIZATION';
        case 'REDACTED': return 'PERSON';
        case 'ID': return 'ID';
        case 'BANK_ACCOUNT': return 'BANK_ACCOUNT';
        case 'SSN': return 'SSN';
        case 'URL': return 'URL';
        case 'DATE_TIME': return 'DATE_TIME';
        default: return l;
    }
}

// ============================================================================
// END FAKER LIBRARY
// ============================================================================

// Check if a text position overlaps with already-redacted text
function isRedactedText(text, start, end) {
    // Check if the text at this position contains redaction labels
    const textAtPosition = text.substring(start, end);
    const redactionLabels = ['[NAME]', '[LOCATION]', '[EMAIL]', '[PHONE]', '[ORGANIZATION]', '[REDACTED]', '[ID]', '[BANK_ACCOUNT]', '[SSN]', '[URL]', '[DATE_TIME]'];
    
    // Check if the text itself is a redaction label
    if (redactionLabels.some(label => textAtPosition.includes(label))) {
        return true;
    }
    
    // Check if the position overlaps with any redaction label in the text
    // Find ALL occurrences of each label, not just the first
    for (const label of redactionLabels) {
        let searchIndex = 0;
        while (true) {
            const labelIndex = text.indexOf(label, searchIndex);
            if (labelIndex === -1) break;
            
            const labelEnd = labelIndex + label.length;
            // Check if our PII position overlaps with this redaction label
            if ((start >= labelIndex && start < labelEnd) || 
                (end > labelIndex && end <= labelEnd) ||
                (start <= labelIndex && end >= labelEnd)) {
                return true;
            }
            
            searchIndex = labelIndex + 1;
        }
    }
    
    return false;
}

// Filter out PII entities that overlap with already-redacted text
function filterRedactedPII(entities, text) {
    return entities.filter(entity => {
        // Check if this entity overlaps with any redaction label
        const redactionLabels = ['[NAME]', '[LOCATION]', '[EMAIL]', '[PHONE]', '[ORGANIZATION]', '[REDACTED]'];
        
        // Find all redaction labels in the text
        const redactionRanges = [];
        for (const label of redactionLabels) {
            let searchIndex = 0;
            while (true) {
                const labelIndex = text.indexOf(label, searchIndex);
                if (labelIndex === -1) break;
                redactionRanges.push({
                    start: labelIndex,
                    end: labelIndex + label.length
                });
                searchIndex = labelIndex + 1;
            }
        }
        
        // Check if entity overlaps with any redaction range
        for (const range of redactionRanges) {
            if ((entity.start >= range.start && entity.start < range.end) || 
                (entity.end > range.start && entity.end <= range.end) ||
                (entity.start <= range.start && entity.end >= range.end)) {
                console.log(`[PII Extension] Filtering out PII "${entity.value}" at ${entity.start}-${entity.end} - overlaps with redaction label`);
                return false;
            }
        }
        
        // Also check if the entity text itself contains a redaction label
        const entityText = text.substring(entity.start, entity.end);
        if (redactionLabels.some(label => entityText.includes(label))) {
            console.log(`[PII Extension] Filtering out PII "${entity.value}" - contains redaction label`);
            return false;
        }
        
        return true;
    });
}

// ChatGPT Integration Helper Functions
// These functions safely update ChatGPT's input using React's synthetic event system

/**
 * Enhanced textarea finder for ChatGPT/Gemini
 * Tries multiple selectors and methods to find the input field
 * Returns { textarea, selector, text } or null if not found
 */
function findChatGPTTextarea() {
    const pageType = detectPageType();
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
        
        const pageType = detectPageType();
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

// Extract sanitized text from the content area after redactions
function extractSanitizedText() {
    try {
        const editor = findContentArea();
        if (!editor) {
            console.warn("[PII Extension] No content area found for text extraction");
            return null;
        }
        
        let sanitizedText = '';
        
        // Walk through all text nodes and redacted elements safely
        const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: function(node) {
                    try {
                        // Accept text nodes
                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        // Accept redacted spans
                        if (node.nodeType === Node.ELEMENT_NODE && 
                            node.classList && node.classList.contains('pii-redacted')) {
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        return NodeFilter.FILTER_SKIP;
                    } catch (error) {
                        console.error("[PII Extension] Error in node filter:", error);
                        return NodeFilter.FILTER_SKIP;
                    }
                }
            }
        );
        
        let node;
        while (node = walker.nextNode()) {
            try {
                if (node.nodeType === Node.TEXT_NODE) {
                    sanitizedText += node.textContent;
                } else if (node.classList && node.classList.contains('pii-redacted')) {
                    sanitizedText += node.textContent; // This will be the redaction label like [NAME]
                }
            } catch (error) {
                console.error("[PII Extension] Error processing node:", error);
            }
        }
        
        return sanitizedText.trim();
    } catch (error) {
        console.error("[PII Extension] Error extracting sanitized text:", error);
        return null;
    }
}

// Simplified text node finder without aggressive filtering
function getSimpleTextNodesIn(element) {
    const textNodes = [];
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // Only skip completely empty nodes and script/style
                if (node.textContent.trim().length === 0) {
                    return NodeFilter.FILTER_REJECT;
                }
                const parent = node.parentElement;
                if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    return textNodes;
}

// Clears all PII highlights from the document
function clearHighlights(showAlert = true) {
    try {
        const pageType = detectPageType();
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
            
            // Alert removed per user request
            // if (showAlert) {
            //     alert("Highlights cleared.");
            // }
            
            console.log("[PII Extension] Cleared ChatGPT/Gemini highlights");
            return;
        }
        
        // Clear regular highlights by replacing HTML
        const editor = findContentArea();
        let highlightedElements = [];
        let redactedElements = [];
        let textHighlightCount = 0;
        
        if (editor) {
            try {
                // Find highlighted spans
                highlightedElements = editor.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
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
            document.querySelectorAll(`.${SUGGESTION_POPUP_CLASS}`).forEach((popup, index) => {
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
        suggestionStates.clear();
        
        const totalCleared = textHighlightCount + redactedElements.length;
        
        // Alerts removed per user request
        // if (showAlert && totalCleared > 0) {
        //     alert(`All highlights and redactions cleared. (${textHighlightCount} highlights + ${redactedElements.length} redactions)`);
        // } else if (showAlert && totalCleared === 0) {
        //     alert("No highlights to clear.");
        // }
        
        console.log(`[PII Extension] Cleared ${totalCleared} elements successfully`);
    } catch (error) {
        console.error("[PII Extension] Critical error in clearHighlights:", error);
        // Alert removed per user request
        // if (showAlert) {
        //     alert("An error occurred while clearing highlights. Some elements may remain highlighted.");
        // }
    }
}

// Accept all detected PII suggestions automatically
function acceptAllPII() {
    try {
        console.log("[PII Extension] Accept All PII initiated...");
        
        const pageType = detectPageType();
        
        // CRITICAL: For ChatGPT/Gemini, use special non-DOM approach
        if (pageType === 'chatgpt' || pageType === 'gemini') {
            acceptAllPIIForChatGPT();
            return;
        }
        
        // Disable send button during processing if on ChatGPT
        if (pageType === 'chatgpt') {
            toggleChatGPTSendButton(false);
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
                    const redactionLabel = getRedactionLabel(piiType);
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
                    const redactionLabel = getRedactionLabel(piiType);
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
        
        // Alerts removed per user request
        // if (acceptedCount > 0) {
        //     alert(`Successfully accepted and redacted ${acceptedCount} PII elements.`);
        // } else {
        //     alert("No PII detected to accept. Please scan for PII first.");
        // }
        
        console.log(`[PII Extension] Accept All completed. ${acceptedCount} PII elements processed.`);
    } catch (error) {
        console.error("[PII Extension] Critical error in acceptAllPII:", error);
        // Alert removed per user request
        // alert("An error occurred while processing PII. Please try again.");
    }
}

// Replace redaction labels in chat input and replace .pii-redacted spans in DOM with fake data
// Stores mapping: original PII -> masked version -> faked version in window.piiMapping
function fillRedactions() {
    const pageType = detectPageType();
    
    // Regex for redaction labels like [NAME], [EMAIL], etc.
    const labelRegex = /\[(NAME|LOCATION|EMAIL|PHONE|ORGANIZATION|REDACTED|ID|BANK_ACCOUNT|SSN|URL|DATE_TIME)\]/gi;
    
    if (pageType === 'chatgpt' || pageType === 'gemini') {
        const textareaResult = findChatGPTTextarea();
        if (!textareaResult || !textareaResult.textarea) {
            console.warn('[PII Extension] Input field not found for filling faker data.');
            return;
        }
        
        const textarea = textareaResult.textarea;
        let text = textarea.value || textarea.textContent || textarea.innerText || '';
        if (!text || text.trim().length === 0) {
            console.warn('[PII Extension] No text found in input to fill.');
            return;
        }
        
        let replacedCount = 0;
        const mappings = []; // Store mappings for this fill operation
        
        // Replace each redaction label with fake data and track the mapping
        let matchIndex = 0;
        const newText = text.replace(labelRegex, (match, labelType) => {
            const piiType = labelToType(match);
            const fake = generateFakeForType(piiType);
            const matchPosition = text.indexOf(match, matchIndex);
            matchIndex = matchPosition + match.length;
            
            // Try to find existing mapping by masked label and type
            // IMPORTANT: Only match mappings from current scan session to prevent reusing old fake data
            // Check if mapping's original value exists in current scan's detected PII
            let existingMapping = null;
            const currentScanPIIValues = window.chatGPTFoundPII 
                ? new Set(window.chatGPTFoundPII.map(pii => pii.value.toLowerCase()))
                : new Set();
            
            for (const [id, mapping] of window.piiMapping.entries()) {
                if (mapping.masked === match && 
                    mapping.type === piiType && 
                    mapping.fake === null) {
                    // Only reuse mapping if its original value is in the current scan's detected PII
                    // This ensures we don't reuse mappings from previous prompts
                    if (currentScanPIIValues.size === 0 || 
                        (mapping.original && currentScanPIIValues.has(mapping.original.toLowerCase()))) {
                        existingMapping = mapping;
                        break;
                    }
                }
            }
            
            if (existingMapping) {
                // Update existing mapping with fake value
                existingMapping.fake = fake;
                existingMapping.filledTimestamp = Date.now();
                mappings.push(existingMapping);
                console.log(`[PII Extension] Updated existing mapping: ${existingMapping.original} -> ${existingMapping.masked} -> ${existingMapping.fake}`);
            } else {
                // Create new mapping if not found
                const mappingId = generatePIIMappingId();
                // Try to find original PII value from stored data
                let originalValue = match; // Default to masked label if original not found
                
                // Try to match by position in original text if available
                if (window.chatGPTOriginalText && window.chatGPTFoundPII) {
                    // This is approximate - we'll use the masked label as fallback
                    originalValue = match;
                }
                
                const mapping = {
                    id: mappingId,
                    original: originalValue,
                    masked: match,
                    fake: fake,
                    type: piiType,
                    position: matchPosition,
                    timestamp: Date.now(),
                    filledTimestamp: Date.now()
                };
                
                mappings.push(mapping);
                window.piiMapping.set(mappingId, mapping);
                console.log(`[PII Extension] Created new mapping: ${mapping.original} -> ${mapping.masked} -> ${mapping.fake}`);
            }
            
            replacedCount++;
            return fake;
        });
        
        if (replacedCount === 0) {
            console.log('[PII Extension] No redaction labels found to fill.');
            return;
        }
        
        const success = setChatGPTInputValue(newText, textarea);
        if (success) {
            // Remove overlays and popups
            document.querySelectorAll('.pii-textarea-overlay, .pii-suggestion-popup').forEach(el => {
                if (el._updatePosition) {
                    window.removeEventListener('scroll', el._updatePosition, true);
                    window.removeEventListener('resize', el._updatePosition);
                }
                el.remove();
            });
            
            console.log(`[PII Extension] Filled ${replacedCount} redactions with synthetic data. Mappings stored in window.piiMapping`);
        } else {
            console.error('[PII Extension] Failed to update input field with fake data.');
        }
        
        return;
    }
    
    // For general pages: replace .pii-redacted spans
    const redactedSpans = Array.from(document.querySelectorAll('.pii-redacted'));
    if (redactedSpans.length === 0) {
        console.log('[PII Extension] No redacted spans found on this page to fill.');
        return;
    }
    
    let filled = 0;
    redactedSpans.forEach(span => {
        try {
            const originalValue = span.getAttribute('data-original-value') || span.textContent || '';
            const piiType = span.getAttribute('data-pii-type') || labelToType(span.textContent) || 'PERSON';
            const maskedLabel = span.textContent || '';
            const fake = generateFakeForType(piiType);
            
            // Create mapping
            const mappingId = generatePIIMappingId();
            const mapping = {
                id: mappingId,
                original: originalValue,
                masked: maskedLabel,
                fake: fake,
                type: piiType,
                position: -1, // DOM position, not text position
                timestamp: Date.now()
            };
            
            window.piiMapping.set(mappingId, mapping);
            
            // Replace span with fake data
            const textNode = document.createTextNode(fake);
            // Preserve original in data attribute if not already present
            if (!span.hasAttribute('data-original-value')) {
                span.setAttribute('data-original-value', originalValue);
            }
            span.setAttribute('data-fake-value', fake);
            span.setAttribute('data-mapping-id', mappingId);
            
            // Replace the text content but keep the span for styling
            span.textContent = fake;
            span.classList.remove('pii-redacted');
            span.classList.add('pii-filled');
            
            filled++;
            console.log(`[PII Extension] Mapping stored: ${mapping.original} -> ${mapping.masked} -> ${mapping.fake}`);
        } catch (e) {
            console.error('[PII Extension] Error filling a redacted span:', e);
        }
    });
    
    console.log(`[PII Extension] Filled ${filled} redacted spans with synthetic data. Mappings stored in window.piiMapping`);
}

// Aggressive location-specific revert using the same multi-strategy approach as main revert
function revertLocationsAggressively(locationMappings) {
	if (!locationMappings || locationMappings.length === 0) return;
	
	console.log(`[PII Extension] Aggressive location revert for ${locationMappings.length} locations`);
	const pageType = detectPageType();
	const responseSelectors = getAssistantResponseSelectors(pageType);
	
	let responseElements = [];
	for (const selector of responseSelectors) {
		try {
			const elements = document.querySelectorAll(selector);
			if (elements.length > 0) {
				responseElements = Array.from(elements);
				break;
			}
		} catch (e) {
			// ignore
		}
	}
	
	// If no specific selector, use document body
	if (responseElements.length === 0) {
		responseElements = [document.body];
	}
	
	let totalReplacements = 0;
	
	for (const mapping of locationMappings) {
		const fakeValue = mapping.fake;
		const originalValue = mapping.original;
		const escapedFake = fakeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		
		// Use the same multi-strategy approach as main revert
		const regexPatterns = [];
		
		// Strategy 1: Full match with flexible whitespace
		regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
		
		// Strategy 2: Component-based matching
		const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
		const originalParts = originalValue.split(/[,\s\/]+/).filter(p => p.length > 2);
		
		for (const part of fakeParts) {
			if (part.length > 3) {
				const escapedPart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				regexPatterns.push(new RegExp(`\\b${escapedPart}\\b`, 'gi'));
			}
		}
		
		// Strategy 3: Without common address words
		const addressWords = ['Ave', 'Avenue', 'St', 'Street', 'Rd', 'Road', 'Blvd', 'Boulevard', 'Ln', 'Lane', 'Dr', 'Drive', 'Ct', 'Court', 'Pl', 'Place', 'Way', 'in', 'at'];
		const fakeWithoutAddressWords = fakeValue.split(/\s+/).filter(w => !addressWords.includes(w)).join(' ');
		if (fakeWithoutAddressWords !== fakeValue && fakeWithoutAddressWords.length > 3) {
			const escaped = fakeWithoutAddressWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			regexPatterns.push(new RegExp(escaped.replace(/\s+/g, '\\s+'), 'gi'));
		}
		
		// Apply to all response elements
		for (const element of responseElements) {
			const walker = document.createTreeWalker(
				element,
				NodeFilter.SHOW_TEXT,
				null,
				false
			);
			
			const textNodes = [];
			let textNode;
			while (textNode = walker.nextNode()) {
				if (textNode.textContent && textNode.textContent.trim().length > 0) {
					textNodes.push(textNode);
				}
			}
			
			for (const textNode of textNodes) {
				let nodeText = textNode.textContent;
				let nodeModified = false;
				
				// Two-pass approach: First try full address replacement, then components
				// Pass 1: Try full fake address replacement with flexible matching
				// Create multiple full-match patterns to handle ChatGPT reformatting
				const fullPatterns = [
					new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'), // Original with flexible whitespace
					new RegExp(escapedFake.replace(/[.\s]+/g, '[.\\s]+'), 'gi'), // Handle . changes
					new RegExp(escapedFake.replace(/[/\s]+/g, '[/\\s]+'), 'gi'), // Handle / changes
				];
				
				let fullReplaced = false;
				for (const fullPattern of fullPatterns) {
					const fullMatch = nodeText.match(fullPattern);
					if (fullMatch && fullMatch[0].length > 5) { // Ensure meaningful match
						nodeText = nodeText.replace(fullPattern, originalValue);
						nodeModified = true;
						totalReplacements++;
						console.log(`[PII Extension] Full location address replaced: "${fullMatch[0]}" -> "${originalValue}"`);
						fullReplaced = true;
						break;
					}
				}
				
				if (fullReplaced) {
					textNode.textContent = nodeText;
					continue; // Move to next text node, full address already replaced
				}
				
				// Pass 2: Try component replacement if full match didn't work
				for (const regex of regexPatterns) {
					// Skip full patterns in second pass since we already tried them
					const isFullPattern = fullPatterns.some(fp => fp.source === regex.source);
					if (isFullPattern) continue;
					
					const beforeReplace = nodeText;
					nodeText = nodeText.replace(regex, (match) => {
						// Determine replacement value
						let replacementValue = originalValue;
						
						// If we matched the full fake value, always replace with full original
						if (match === fakeValue || match.toLowerCase() === fakeValue.toLowerCase()) {
							nodeModified = true;
							console.log(`[PII Extension] Full location match: "${match}" -> "${replacementValue}"`);
							return replacementValue;
						}
						
						// Check if match is a component
						const matchedPartIndex = fakeParts.findIndex(p => 
							match.toLowerCase().includes(p.toLowerCase()) || 
							p.toLowerCase().includes(match.toLowerCase())
						);
						
						// If original is a single word and we matched a component that's in the original,
						// try to replace the larger context (full fake address) if it exists nearby
						if (originalParts.length === 1 && matchedPartIndex >= 0) {
							const originalWord = originalParts[0].toLowerCase();
							const matchedPart = fakeParts[matchedPartIndex].toLowerCase();
							
							// If the matched component is the original word, try to find and replace full fake address
							if (matchedPart === originalWord || originalWord.includes(matchedPart) || matchedPart.includes(originalWord)) {
								// Look for the full fake address pattern in the text around this match
								const fakePattern = new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi');
								const fullMatch = fakePattern.exec(nodeText);
								if (fullMatch) {
									nodeModified = true;
									console.log(`[PII Extension] Found full fake address near component, replacing: "${fullMatch[0]}" -> "${replacementValue}"`);
									return replacementValue; // Will be replaced in next iteration or by full pattern
								}
							}
						}
						
						if (matchedPartIndex >= 0 && matchedPartIndex < originalParts.length) {
							replacementValue = originalParts[matchedPartIndex];
							console.log(`[PII Extension] Location component match: "${match}" -> "${replacementValue}"`);
						}
						
						// Check if this match is part of the fake location
						const isComponent = fakeParts.some(p => 
							match.toLowerCase().includes(p.toLowerCase()) || 
							p.toLowerCase().includes(match.toLowerCase())
						);
						
						if (isComponent) {
							nodeModified = true;
							return replacementValue;
						}
						return match;
					});
					
					if (nodeText !== beforeReplace) {
						textNode.textContent = nodeText;
						if (nodeModified) {
							totalReplacements++;
						}
						break; // Found and replaced, move to next text node
					}
				}
			}
		}
	}
	
	console.log(`[PII Extension] Aggressive location revert complete: ${totalReplacements} replacements`);
}

// Revert fake PII data in ChatGPT/Gemini response back to original PII values
function revertPIIsInDocumentBody(filledMappings) {
	if (!filledMappings || filledMappings.length === 0) return;
	
	console.log('[PII Extension] Performing document-wide revert...');
	const sortedMappings = filledMappings.sort((a, b) => b.fake.length - a.fake.length);
	let totalReplacements = 0;
	
	const walker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_TEXT,
		null,
		false
	);
	
	const nodesToUpdate = [];
	let node;
	
	while (node = walker.nextNode()) {
		if (node.textContent && node.textContent.trim().length > 0) {
			nodesToUpdate.push(node);
		}
	}
	
	for (const mapping of sortedMappings) {
		const fakeValue = mapping.fake;
		const originalValue = mapping.original;
		const escapedFake = fakeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		
		// Create appropriate regex patterns
		let regexPatterns = [];
		if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
			const fakeDigits = fakeValue.replace(/\D/g, '');
			regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
			if (fakeDigits.length >= 10) {
				const digitPattern = fakeDigits.split('').join('[\\s\\-\\.\\(\\)]*');
				regexPatterns.push(new RegExp(digitPattern, 'gi'));
			}
		} else if (mapping.type === 'LOCATION') {
			// For locations, use same improved matching as main revert function
			regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
			
			const fakeParts = fakeValue.split(/[,\s]+/).filter(p => p.length > 2);
			for (const part of fakeParts) {
				if (part.length > 3) {
					const escapedPart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					regexPatterns.push(new RegExp(`\\b${escapedPart}\\b`, 'gi'));
				}
			}
			
			const addressWords = ['Ave', 'Avenue', 'St', 'Street', 'Rd', 'Road', 'Blvd', 'Boulevard', 'Ln', 'Lane', 'Dr', 'Drive', 'Ct', 'Court', 'Pl', 'Place', 'Way', 'in', 'at'];
			const fakeWithoutAddressWords = fakeValue.split(/\s+/).filter(w => !addressWords.includes(w)).join(' ');
			if (fakeWithoutAddressWords !== fakeValue && fakeWithoutAddressWords.length > 3) {
				const escaped = fakeWithoutAddressWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				regexPatterns.push(new RegExp(escaped.replace(/\s+/g, '\\s+'), 'gi'));
			}
		} else {
			regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
		}
		
		for (const textNode of nodesToUpdate) {
			const originalText = textNode.textContent;
			for (const regex of regexPatterns) {
				if (regex.test(originalText)) {
					const newText = originalText.replace(regex, (match) => {
						if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
							const matchDigits = match.replace(/\D/g, '');
							const fakeDigits = fakeValue.replace(/\D/g, '');
							if (matchDigits === fakeDigits) {
								return originalValue;
							}
						} else if (mapping.type === 'LOCATION') {
							// For locations, check if match is a component
							const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
							const isComponent = fakeParts.some(p => 
								match.toLowerCase().includes(p.toLowerCase()) || 
								p.toLowerCase().includes(match.toLowerCase())
							);
							
							if (match === fakeValue || match.toLowerCase() === fakeValue.toLowerCase() || isComponent) {
								// Try to map to corresponding original component
								const originalParts = originalValue.split(/[,\s\/]+/).filter(p => p.length > 2);
								const matchedPartIndex = fakeParts.findIndex(p => 
									match.toLowerCase().includes(p.toLowerCase()) || 
									p.toLowerCase().includes(match.toLowerCase())
								);
								
								if (matchedPartIndex >= 0 && matchedPartIndex < originalParts.length) {
									return originalParts[matchedPartIndex];
								}
								return originalValue;
							}
						} else if (match.toLowerCase() === fakeValue.toLowerCase()) {
							return originalValue;
						}
						return match;
					});
					
					if (newText !== originalText) {
						textNode.textContent = newText;
						totalReplacements++;
						console.log(`[PII Extension] Document-wide revert: "${fakeValue}" -> "${originalValue}"`);
						break; // Found and replaced, move to next text node
					}
				}
			}
		}
	}
	
	console.log(`[PII Extension] Document-wide revert complete: ${totalReplacements} replacements`);
}

function revertPIIsInResponse() {
    const pageType = detectPageType();
    
    if (pageType !== 'chatgpt' && pageType !== 'gemini') {
        console.warn('[PII Extension] Revert PIIs only works on ChatGPT/Gemini pages');
        return;
    }
    
    // Check if we have mappings
    if (!window.piiMapping || window.piiMapping.size === 0) {
        console.warn('[PII Extension] No PII mappings found. Please scan, accept, and fill PIIs first.');
        return;
    }
    
    // Get mappings that have fake data (were filled)
    const filledMappings = [];
    for (const [id, mapping] of window.piiMapping.entries()) {
        if (mapping.fake && mapping.original) {
            filledMappings.push(mapping);
        }
    }
    
    if (filledMappings.length === 0) {
        console.warn('[PII Extension] No filled mappings found. Please fill PIIs first.');
        return;
    }
    
    console.log(`[PII Extension] Found ${filledMappings.length} filled mappings to revert`);
    filledMappings.forEach((m, idx) => {
        console.log(`[PII Extension] Mapping ${idx + 1}: type="${m.type}", fake="${m.fake}", original="${m.original}"`);
    });
    
	// Find ChatGPT/Gemini response messages
	const responseSelectors = getAssistantResponseSelectors(pageType);
    
    let responseElements = [];
    for (const selector of responseSelectors) {
        try {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                responseElements = Array.from(elements);
                console.log(`[PII Extension] Found ${elements.length} potential response elements with selector: ${selector}`);
                const lastElement = responseElements[responseElements.length - 1];
                const responseText = (lastElement.textContent || lastElement.innerText || '').substring(0, 200);
                console.log(`[PII Extension] Latest response preview: "${responseText}..."`);
                break;
            }
        } catch (e) {
            console.warn(`[PII Extension] Error with selector ${selector}:`, e);
        }
    }
    
    // If no specific selector worked, try to find the latest message in the conversation
    if (responseElements.length === 0) {
        // Try to find conversation container and get latest message
        const conversationContainers = [
            'div[class*="conversation"]',
            'div[class*="chat"]',
            'main',
            'div[role="main"]'
        ];
        
        for (const containerSelector of conversationContainers) {
            try {
                const container = document.querySelector(containerSelector);
                if (container) {
                    // Get all text nodes or divs that might contain the response
                    const allDivs = container.querySelectorAll('div');
                    if (allDivs.length > 0) {
                        // Get the last few divs (likely the latest response)
                        responseElements = Array.from(allDivs).slice(-5);
                        console.log(`[PII Extension] Using fallback: found ${responseElements.length} elements from container`);
                        break;
                    }
                }
            } catch (e) {
                console.warn(`[PII Extension] Error with container selector ${containerSelector}:`, e);
            }
        }
    }
    
    if (responseElements.length === 0) {
        console.warn('[PII Extension] Could not find ChatGPT response elements. Trying to find by text content...');
        
        // Last resort: search entire document for fake values
        let revertedCount = 0;
        let totalReplacements = 0;
        
        // Sort mappings by fake value length (longest first) to avoid partial replacements
        const sortedMappings = filledMappings.sort((a, b) => b.fake.length - a.fake.length);
        
        // Process each mapping
        for (const mapping of sortedMappings) {
            const fakeValue = mapping.fake;
            const originalValue = mapping.original;
            
            // Escape special regex characters
            const escapedFake = fakeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Create multiple regex patterns for better matching
            const regexPatterns = [];
            
            if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                // For names, try multiple patterns:
                // 1. Full name with word boundaries
                regexPatterns.push(new RegExp(`\\b${escapedFake}\\b`, 'gi'));
                
                // 2. Split name into first and last (GPT might use just first or last name)
                const nameParts = fakeValue.split(/\s+/);
                if (nameParts.length >= 2) {
                    const firstName = nameParts[0];
                    const lastName = nameParts[nameParts.length - 1];
                    const originalParts = originalValue.split(/\s+/);
                    
                    // Match first name only if original also has it
                    if (originalParts.length >= 1) {
                        regexPatterns.push(new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
                    }
                    // Match last name only if original also has it
                    if (originalParts.length >= 2) {
                        regexPatterns.push(new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
                    }
                }
            } else if (mapping.type === 'LOCATION') {
                // For locations, ONLY match the full location string
                // Do NOT do partial matching - locations are too complex and GPT reformats them significantly
                // Partial matching causes incorrect replacements (e.g., "Oak Street" -> wrong location)
                regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
            } else {
                // For emails, phones, etc., use exact match with flexible whitespace
                regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
            }
            
            // Try each pattern
            for (const regex of regexPatterns) {
                // Search and replace in all text nodes
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );
                
                let node;
                const nodesToUpdate = [];
                
                while (node = walker.nextNode()) {
                    if (node.textContent && regex.test(node.textContent)) {
                        nodesToUpdate.push(node);
                    }
                }
                
                // Replace in found nodes
                for (const textNode of nodesToUpdate) {
                    const originalText = textNode.textContent;
                    
                    // Determine replacement value based on what was matched
                    let replacementValue = originalValue;
                    if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                        // If matching a partial name, replace with corresponding part
                        const nameParts = fakeValue.split(/\s+/);
                        const originalParts = originalValue.split(/\s+/);
                        const matchText = originalText.match(regex)?.[0] || '';
                        
                        if (nameParts.length >= 2 && originalParts.length >= 2) {
                            if (matchText.toLowerCase() === nameParts[0].toLowerCase()) {
                                replacementValue = originalParts[0]; // First name
                            } else if (matchText.toLowerCase() === nameParts[nameParts.length - 1].toLowerCase()) {
                                replacementValue = originalParts[originalParts.length - 1]; // Last name
                            }
                        }
                    }
                    
                    const newText = originalText.replace(regex, (match) => {
                        // Case-sensitive replacement to preserve formatting
                        if (match === fakeValue) {
                            return replacementValue;
                        } else if (match.toLowerCase() === fakeValue.toLowerCase()) {
                            // Preserve case of first letter if different
                            if (match[0] === match[0].toUpperCase() && replacementValue[0]) {
                                return replacementValue[0].toUpperCase() + replacementValue.slice(1);
                            }
                            return replacementValue;
                        } else if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                            // Partial name match
                            return replacementValue;
                        }
                        return match;
                    });
                    
                    if (newText !== originalText) {
                        textNode.textContent = newText;
                        totalReplacements++;
                    }
                }
                
                if (nodesToUpdate.length > 0) {
                    revertedCount++;
                    console.log(`[PII Extension] Reverted: "${fakeValue}" -> "${originalValue}" (${nodesToUpdate.length} occurrences)`);
                    break; // Found matches, move to next mapping
                }
            }
        }
        
        console.log(`[PII Extension] Revert complete: ${revertedCount} mappings reverted, ${totalReplacements} total replacements`);
        return;
    }
    
    // Process response elements
    let totalReverted = 0;
    let totalReplacements = 0;
    
    // Sort mappings by fake value length (longest first) to avoid partial replacements
    const sortedMappings = filledMappings.sort((a, b) => b.fake.length - a.fake.length);
    
    for (const element of responseElements) {
        let elementText = element.textContent || element.innerText || '';
        if (!elementText.trim()) continue;
        
        let modified = false;
        let modifiedText = elementText;
        
        // Process each mapping
        for (const mapping of sortedMappings) {
            const fakeValue = mapping.fake;
            const originalValue = mapping.original;
            
            // Escape special regex characters
            const escapedFake = fakeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Create multiple regex patterns for better matching
            const regexPatterns = [];
            
            if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                // For names, try multiple patterns
                regexPatterns.push(new RegExp(`\\b${escapedFake}\\b`, 'gi'));
                
                // Split name into parts for partial matching
                const nameParts = fakeValue.split(/\s+/);
                if (nameParts.length >= 2) {
                    const firstName = nameParts[0];
                    const lastName = nameParts[nameParts.length - 1];
                    const originalParts = originalValue.split(/\s+/);
                    
                    if (originalParts.length >= 1) {
                        regexPatterns.push(new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
                    }
                    if (originalParts.length >= 2) {
                        regexPatterns.push(new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
                    }
                }
            } else if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
                // For phone numbers, normalize to digits only and create flexible patterns
                const fakeDigits = fakeValue.replace(/\D/g, '');
                const originalDigits = originalValue.replace(/\D/g, '');
                
                console.log(`[PII Extension] Phone number matching: fake="${fakeValue}" (digits: ${fakeDigits}), original="${originalValue}" (digits: ${originalDigits})`);
                
                // Try exact match first
                regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
                
                // Try with different separators (dashes, spaces, parentheses)
                const separators = ['-', ' ', '\\.', '\\(', '\\)'];
                for (const sep of separators) {
                    const pattern = fakeValue.replace(/[-.\s()]/g, sep).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    regexPatterns.push(new RegExp(pattern, 'gi'));
                }
                
                // Try matching by digits only (most flexible)
                if (fakeDigits.length >= 10) {
                    const digitPattern = fakeDigits.split('').join('[\\s\\-\\.\\(\\)]*');
                    regexPatterns.push(new RegExp(digitPattern, 'gi'));
                }
            } else if (mapping.type === 'LOCATION') {
                // For locations, try multiple strategies:
                // 1. Full match with flexible whitespace
                regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
                
                // 2. Break down into components and match each part
                // ChatGPT often reformats addresses, so we need to match components
                const fakeParts = fakeValue.split(/[,\s]+/).filter(p => p.length > 2);
                const originalParts = originalValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                
                // Match individual significant words (longer than 3 chars)
                for (const part of fakeParts) {
                    if (part.length > 3) {
                        const escapedPart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        regexPatterns.push(new RegExp(`\\b${escapedPart}\\b`, 'gi'));
                    }
                }
                
                // 3. Try matching without common address words (Ave, St, Rd, etc.)
                const addressWords = ['Ave', 'Avenue', 'St', 'Street', 'Rd', 'Road', 'Blvd', 'Boulevard', 'Ln', 'Lane', 'Dr', 'Drive', 'Ct', 'Court', 'Pl', 'Place', 'Way', 'in', 'at'];
                const fakeWithoutAddressWords = fakeValue.split(/\s+/).filter(w => !addressWords.includes(w)).join(' ');
                if (fakeWithoutAddressWords !== fakeValue && fakeWithoutAddressWords.length > 3) {
                    const escaped = fakeWithoutAddressWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    regexPatterns.push(new RegExp(escaped.replace(/\s+/g, '\\s+'), 'gi'));
                }
                
                console.log(`[PII Extension] Location matching: fake="${fakeValue}", original="${originalValue}", ${fakeParts.length} parts`);
            } else {
                regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
            }
            
            // Try each pattern
            for (const regex of regexPatterns) {
                const matches = modifiedText.match(regex);
                if (matches && matches.length > 0) {
                    console.log(`[PII Extension] Found ${matches.length} matches with pattern for "${fakeValue}":`, matches);
                    
                    // Determine replacement value
                    let replacementValue = originalValue;
                    if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                        const nameParts = fakeValue.split(/\s+/);
                        const originalParts = originalValue.split(/\s+/);
                        const firstMatch = matches[0];
                        
                        if (nameParts.length >= 2 && originalParts.length >= 2) {
                            if (firstMatch.toLowerCase() === nameParts[0].toLowerCase()) {
                                replacementValue = originalParts[0];
                            } else if (firstMatch.toLowerCase() === nameParts[nameParts.length - 1].toLowerCase()) {
                                replacementValue = originalParts[originalParts.length - 1];
                            }
                        }
                    } else if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
                        // For phone numbers, always use original format
                        replacementValue = originalValue;
                    } else if (mapping.type === 'LOCATION') {
                        // For locations, if we matched a component, try to map it
                        const firstMatch = matches[0];
                        const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                        const originalParts = originalValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                        
                        // If match is a component of fake, try to find corresponding original component
                        const matchedPartIndex = fakeParts.findIndex(p => 
                            firstMatch.toLowerCase().includes(p.toLowerCase()) || 
                            p.toLowerCase().includes(firstMatch.toLowerCase())
                        );
                        
                        if (matchedPartIndex >= 0 && matchedPartIndex < originalParts.length) {
                            // Use corresponding original part
                            replacementValue = originalParts[matchedPartIndex];
                            console.log(`[PII Extension] Location component match: "${firstMatch}" -> "${replacementValue}" (part ${matchedPartIndex})`);
                        } else {
                            // Use full original location
                            replacementValue = originalValue;
                        }
                    }
                    
                    // Replace with original, preserving case if possible
                    modifiedText = modifiedText.replace(regex, (match) => {
                        if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
                            // For phone numbers, check if digits match
                            const matchDigits = match.replace(/\D/g, '');
                            const fakeDigits = fakeValue.replace(/\D/g, '');
                            if (matchDigits === fakeDigits) {
                                console.log(`[PII Extension] Phone number match confirmed: "${match}" (digits: ${matchDigits}) -> "${replacementValue}"`);
                                return replacementValue;
                            }
                        } else if (mapping.type === 'LOCATION') {
                            // For locations, replace any matched component with original
                            // Check if this match is part of the fake location
                            const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                            const isComponent = fakeParts.some(p => 
                                match.toLowerCase().includes(p.toLowerCase()) || 
                                p.toLowerCase().includes(match.toLowerCase())
                            );
                            
                            if (match === fakeValue || match.toLowerCase() === fakeValue.toLowerCase() || isComponent) {
                                console.log(`[PII Extension] Location match: "${match}" -> "${replacementValue}"`);
                                return replacementValue;
                            }
                        } else if (match === fakeValue) {
                            return replacementValue;
                        } else if (match.toLowerCase() === fakeValue.toLowerCase()) {
                            if (match[0] === match[0].toUpperCase() && replacementValue[0]) {
                                return replacementValue[0].toUpperCase() + replacementValue.slice(1);
                            }
                            return replacementValue;
                        } else if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                            return replacementValue;
                        }
                        return match;
                    });
                    
                    modified = true;
                    totalReplacements += matches.length;
                    console.log(`[PII Extension] Reverted in response: "${fakeValue}" -> "${replacementValue}" (${matches.length} occurrences)`);
                    break; // Found matches, move to next mapping
                }
            }
        }
        
        if (modified) {
            // Preserve DOM structure by replacing only text nodes, not the entire element
            // This maintains GPT's formatting, line breaks, and HTML structure
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let textNode;
            const textNodes = [];
            
            // Collect all text nodes
            while (textNode = walker.nextNode()) {
                textNodes.push(textNode);
            }
            
            // Apply replacements directly to each text node to preserve structure
            // Process each text node individually with all mappings
            for (const textNode of textNodes) {
                let nodeText = textNode.textContent;
                let nodeModified = false;
                
                // Apply each mapping replacement to this text node
                // Process in reverse order (longest first) to avoid partial replacements
                for (const mapping of sortedMappings) {
                    const fakeValue = mapping.fake;
                    const originalValue = mapping.original;
                    const escapedFake = fakeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    
                    // Create appropriate regex based on PII type
                    let regex;
                    let regexPatterns = [];
                    if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                        // For names, try full name first, then partial
                        regexPatterns.push(new RegExp(`\\b${escapedFake}\\b`, 'gi'));
                    } else if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
                        // For phone numbers, create multiple patterns
                        const fakeDigits = fakeValue.replace(/\D/g, '');
                        regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
                        if (fakeDigits.length >= 10) {
                            const digitPattern = fakeDigits.split('').join('[\\s\\-\\.\\(\\)]*');
                            regexPatterns.push(new RegExp(digitPattern, 'gi'));
                        }
                    } else if (mapping.type === 'LOCATION') {
                        // For locations, try multiple strategies like in the main revert function
                        regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
                        
                        // Break down into components
                        const fakeParts = fakeValue.split(/[,\s]+/).filter(p => p.length > 2);
                        for (const part of fakeParts) {
                            if (part.length > 3) {
                                const escapedPart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                regexPatterns.push(new RegExp(`\\b${escapedPart}\\b`, 'gi'));
                            }
                        }
                        
                        // Try without common address words
                        const addressWords = ['Ave', 'Avenue', 'St', 'Street', 'Rd', 'Road', 'Blvd', 'Boulevard', 'Ln', 'Lane', 'Dr', 'Drive', 'Ct', 'Court', 'Pl', 'Place', 'Way', 'in', 'at'];
                        const fakeWithoutAddressWords = fakeValue.split(/\s+/).filter(w => !addressWords.includes(w)).join(' ');
                        if (fakeWithoutAddressWords !== fakeValue && fakeWithoutAddressWords.length > 3) {
                            const escaped = fakeWithoutAddressWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            regexPatterns.push(new RegExp(escaped.replace(/\s+/g, '\\s+'), 'gi'));
                        }
                    } else {
                        // For emails, etc., match with flexible whitespace
                        regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
                    }
                    
                    let matched = false;
                    for (regex of regexPatterns) {
                        if (regex.test(nodeText)) {
                            matched = true;
                            break;
                        }
                    }
                    
                    if (matched) {
                        // Determine replacement value
                        let replacementValue = originalValue;
                        let allowPartialMatch = false;
                        
                        if (mapping.type === 'PERSON' || mapping.type === 'NAME') {
                            const nameParts = fakeValue.split(/\s+/);
                            const originalParts = originalValue.split(/\s+/);
                            
                            // Only allow partial matching if both fake and original have multiple parts
                            if (nameParts.length >= 2 && originalParts.length >= 2) {
                                // Check if we're matching a full name or partial
                                const fullMatch = nodeText.includes(fakeValue);
                                
                                if (!fullMatch) {
                                    // Check for partial matches - be very conservative
                                    const firstName = nameParts[0];
                                    const lastName = nameParts[nameParts.length - 1];
                                    
                                    // Only match if the text contains JUST the first or last name (with word boundaries)
                                    const firstNameRegex = new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                                    const lastNameRegex = new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                                    
                                    if (firstNameRegex.test(nodeText) && !nodeText.includes(fakeValue)) {
                                        // Check if it's a standalone first name (not part of another name)
                                        const firstNameMatches = nodeText.match(firstNameRegex);
                                        if (firstNameMatches && firstNameMatches.length > 0) {
                                            // Only replace if it's clearly the first name alone
                                            replacementValue = originalParts[0];
                                            allowPartialMatch = true;
                                        }
                                    } else if (lastNameRegex.test(nodeText) && !nodeText.includes(fakeValue)) {
                                        // Check if it's a standalone last name
                                        const lastNameMatches = nodeText.match(lastNameRegex);
                                        if (lastNameMatches && lastNameMatches.length > 0) {
                                            // Only replace if it's clearly the last name alone
                                            replacementValue = originalParts[originalParts.length - 1];
                                            allowPartialMatch = true;
                                        }
                                    }
                                }
                            }
                        } else if (mapping.type === 'LOCATION') {
                            // For locations, determine replacement based on matched component
                            const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                            const originalParts = originalValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                            
                            // Try to find which component was matched
                            for (const part of fakeParts) {
                                if (nodeText.toLowerCase().includes(part.toLowerCase())) {
                                    const partIndex = fakeParts.indexOf(part);
                                    if (partIndex >= 0 && partIndex < originalParts.length) {
                                        replacementValue = originalParts[partIndex];
                                        allowPartialMatch = true;
                                        break;
                                    }
                                }
                            }
                            
                            // If no component match, use full original
                            if (!allowPartialMatch) {
                                replacementValue = originalValue;
                            }
                        }
                        
                        // Replace in this text node - try all patterns
                        for (const patternRegex of regexPatterns) {
                            const beforeReplace = nodeText;
                            nodeText = nodeText.replace(patternRegex, (match) => {
                                if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
                                    // For phone numbers, check if digits match
                                    const matchDigits = match.replace(/\D/g, '');
                                    const fakeDigits = fakeValue.replace(/\D/g, '');
                                    if (matchDigits === fakeDigits) {
                                        nodeModified = true;
                                        console.log(`[PII Extension] Text node phone match: "${match}" -> "${replacementValue}"`);
                                        return replacementValue;
                                    }
                                } else if (mapping.type === 'LOCATION') {
                                    // For locations, check if match is a component of fake location
                                    const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                                    const isComponent = fakeParts.some(p => 
                                        match.toLowerCase().includes(p.toLowerCase()) || 
                                        p.toLowerCase().includes(match.toLowerCase())
                                    );
                                    
                                    if (match === fakeValue || match.toLowerCase() === fakeValue.toLowerCase() || isComponent) {
                                        nodeModified = true;
                                        console.log(`[PII Extension] Text node location match: "${match}" -> "${replacementValue}"`);
                                        return replacementValue;
                                    }
                                } else if (match === fakeValue || match.toLowerCase() === fakeValue.toLowerCase()) {
                                    nodeModified = true;
                                    // Preserve case of first letter
                                    if (match[0] === match[0].toUpperCase() && replacementValue[0]) {
                                        return replacementValue[0].toUpperCase() + replacementValue.slice(1);
                                    }
                                    return replacementValue;
                                } else if (allowPartialMatch && (mapping.type === 'PERSON' || mapping.type === 'NAME' || mapping.type === 'LOCATION')) {
                                    // Only do partial replacement if we explicitly allowed it
                                    nodeModified = true;
                                    console.log(`[PII Extension] Text node partial match (${mapping.type}): "${match}" -> "${replacementValue}"`);
                                    return replacementValue;
                                }
                                return match;
                            });
                            if (nodeText !== beforeReplace) {
                                break; // Found and replaced, move to next mapping
                            }
                        }
                    }
                }
                
                // Only update the text node if it was modified
                if (nodeModified) {
                    textNode.textContent = nodeText;
                }
            }
            
            totalReverted++;
        }
    }
    
    console.log(`[PII Extension] Revert complete: ${totalReverted} response elements updated, ${totalReplacements} total replacements`);
}

// Handle model selection change
function handleModelChange(event) {
    const selectedModel = event.target.value;
    const previousModel = currentModel;
    currentModel = selectedModel;
    
    console.log(`Model changed from ${previousModel} to ${selectedModel}`);
    
    // Update the dropdown text to show current model
    const modelSelect = document.getElementById('pii-model-select');
    if (modelSelect) {
        // Update the selected option text to show "(Current)"
        Array.from(modelSelect.options).forEach(option => {
            const modelKey = option.value;
            const config = MODEL_CONFIGS[modelKey];
            if (modelKey === selectedModel) {
                option.textContent = `${config.name} (Current)`;
            } else {
                option.textContent = config.name;
            }
        });
    }
    
    const modelConfig = MODEL_CONFIGS[selectedModel];
    if (modelConfig) {
        if (selectedModel === MODEL_AUTO) {
            const { text } = getCurrentPromptText(detectPageType());
            if (text.trim()) {
                const autoPreview = analyzePromptForModel(text);
                const modelName = getModelDisplayName(autoPreview.model);
                showAutoModelPopup(modelName, autoPreview.reason, 'Auto Preview');
            } else {
                showAutoModelPopup(modelConfig.name.trim(), 'We will inspect each prompt and pick the best detector automatically.', 'Auto Select Enabled');
            }
        } else {
            const reason = `${modelConfig.description} • Accuracy: ${modelConfig.accuracy}`;
            showAutoModelPopup(modelConfig.name.trim(), reason, `${modelConfig.name.trim()} Selected`);
        }
    }
    
    // Clear existing highlights since we're switching models
    clearHighlights(false);
    
    // Optionally auto-rescan with new model (commented out for now)
    // setTimeout(() => handleScanClick(), 500);
}


// Handles the Scan button click event
async function handleScanClick() {
  try {
    console.log("[PII Extension] Scan initiated...");
    
    const pageType = detectPageType();
    
    // Disable send button during scanning if on ChatGPT or Gemini
    if (pageType === 'chatgpt' || pageType === 'gemini') {
      if (pageType === 'chatgpt') {
        toggleChatGPTSendButton(false);
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
    
    const promptContext = getCurrentPromptText(pageType);
    const editor = promptContext.editor;
    if (!editor) {
      // Alert removed per user request
      // alert("Content area not found. Please make sure you're on a supported page.");
      
      // Re-enable send button if scan fails
      if (pageType === 'chatgpt') {
        try {
          toggleChatGPTSendButton(true);
        } catch (buttonError) {
          console.error("[PII Extension] Error re-enabling send button after scan failure:", buttonError);
        }
      }
      return;
    }
    
    const textToAnalyze = promptContext.text;
    
    if (!textToAnalyze.trim()) {
      // Alert removed per user request
      // alert("No text found to analyze. Please type your message in the input field first.");
      if (pageType === 'chatgpt') {
        try {
          toggleChatGPTSendButton(true);
        } catch (buttonError) {
          console.error("[PII Extension] Error re-enabling send button:", buttonError);
        }
      }
      return;
    }
    
    // Resolve model (auto mode inspects the prompt)
    let resolvedModel = currentModel;
    lastAutoReason = '';
    if (currentModel === MODEL_AUTO) {
        const autoChoice = analyzePromptForModel(textToAnalyze);
        resolvedModel = autoChoice.model;
        lastAutoReason = autoChoice.reason;
        const autoName = getModelDisplayName(resolvedModel);
        console.log(`[PII Extension] Auto-selected model "${resolvedModel}": ${lastAutoReason}`);
        showAutoModelPopup(autoName, lastAutoReason, 'Auto Model Selected');
    }
    lastResolvedModel = resolvedModel;
    
    // Show loading indicator
    const scanButton = document.getElementById("pii-scan-button");
    const originalButtonText = scanButton.innerHTML;
    scanButton.innerHTML = `<span role="img" aria-label="Loading">⏳</span> Scanning...`;
    scanButton.disabled = true;
    
    let piiResults;
    try {
      // Try to use backend API first
      const backendAvailable = await checkBackendHealth();
      
      if (backendAvailable) {
        console.log(`[PII Extension] Backend available, using model "${resolvedModel}" via API...`);
        piiResults = await detectPIIFromBackend(textToAnalyze, resolvedModel);
      } else {
        console.warn("[PII Extension] Backend unavailable - no fallback available");
        // COMMENTED OUT: Mock data backup code disabled
        // piiResults = getMockPIIData(resolvedModel);
        piiResults = {
          "has_pii": false,
          "detected_entities": [],
          "total_entities": 0,
          "model_used": resolvedModel,
          "confidence_threshold": 0.8
        };
        // Alert removed per user request
        // alert("⚠️ Backend server not available. Using fallback mode. Please ensure the backend server is running on http://127.0.0.1:5000");
      }
    } catch (error) {
      console.error("[PII Extension] Error detecting PII:", error);
      // COMMENTED OUT: Mock data backup code disabled
      // Fallback to mock data on error
      // piiResults = getMockPIIData(resolvedModel);
      piiResults = {
        "has_pii": false,
        "detected_entities": [],
        "total_entities": 0,
        "model_used": resolvedModel,
        "confidence_threshold": 0.8
      };
      // Alert removed per user request
      // alert("⚠️ Error connecting to backend. Using fallback mode. Please check if the backend server is running.");
    } finally {
      // Restore button
      scanButton.innerHTML = originalButtonText;
      scanButton.disabled = false;
    }
    
    // Process results and highlight
    if (piiResults && piiResults.detected_entities && piiResults.detected_entities.length > 0) {
        const modelName = getLastModelName();
        
        // Don't show alert here - let the highlighting function show the final count
        // This ensures consistency between detected and actually highlighted items
        try {
          highlightPiiInDocument(piiResults.detected_entities);
        } catch (highlightError) {
          console.error("[PII Extension] Error highlighting PII:", highlightError);
          // Alert removed per user request
          // alert("PII detected but highlighting failed. Please try again.");
        }
        
        // Re-enable send button after highlighting is complete
        if (pageType === 'chatgpt') {
          setTimeout(() => {
            try {
              toggleChatGPTSendButton(true);
            } catch (buttonError) {
              console.error("[PII Extension] Error re-enabling send button after highlighting:", buttonError);
            }
          }, 500);
        }
    } else {
        const modelName = getLastModelName();
        // Alert removed per user request
        // alert(`Scan complete with ${modelName}, no PII found.`);
        
        // Re-enable send button if no PII found
        if (pageType === 'chatgpt') {
          try {
            toggleChatGPTSendButton(true);
          } catch (buttonError) {
            console.error("[PII Extension] Error re-enabling send button after no PII found:", buttonError);
          }
        }
    }
  } catch (error) {
    console.error("[PII Extension] Critical error in handleScanClick:", error);
    
    // Always try to re-enable send button in case of errors
    try {
      const pageType = detectPageType();
      if (pageType === 'chatgpt') {
        toggleChatGPTSendButton(true);
      }
      // For Gemini, we don't modify the send button
      // Restore button
      const scanButton = document.getElementById("pii-scan-button");
      if (scanButton) {
        scanButton.innerHTML = `<span role="img" aria-label="Shield">🛡️</span> Scan for PII`;
        scanButton.disabled = false;
      }
    } catch (buttonError) {
      console.error("[PII Extension] Error re-enabling send button after critical error:", buttonError);
    }
    
    // Alert removed per user request
    // alert("An error occurred during scanning. Please try again.");
  }
}

// The core function to highlight PII using safe regex-based HTML replacement
function highlightPiiInDocument(entities) {
    const pageType = detectPageType();
    
    // CRITICAL: For ChatGPT and Gemini, use special approach that only highlights in input field
    if (pageType === 'chatgpt' || pageType === 'gemini') {
        console.log(`[PII Extension] Using ${pageType === 'gemini' ? 'Gemini' : 'ChatGPT'}-safe highlighting approach`);
        highlightPiiForChatGPT(entities);
        return;
    }
    
    // Original approach for other platforms
    const editor = findContentArea();
    if (!editor) {
        console.warn("Cannot highlight PII: Content area not found");
        return;
    }

    console.log("Starting regex-based PII highlighting process...");
    console.log("Editor element:", editor);

    let highlightCount = 0;

    // Check if editor HTML already contains highlights to avoid nested highlighting
    if (editor.innerHTML.includes(HIGHLIGHT_CLASS)) {
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
        const highlightHTML = `<span class="${HIGHLIGHT_CLASS}" data-pii-type="${entity.type}" data-pii-value="${entity.value}" data-suggestion-id="${generateSuggestionId()}">$1</span>`;
        
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
            const modelName = getLastModelName();
            const totalDetected = entities.length;
            
            // Alerts removed per user request
            // if (highlightCount === totalDetected) {
            //     alert(`Scan complete with ${modelName}! Found ${highlightCount} PII items. Click any highlighted text to review and accept/reject.`);
            // } else {
            //     alert(`Scan complete with ${modelName}! Detected ${totalDetected} PII items, highlighted ${highlightCount} (${totalDetected - highlightCount} may be already redacted or not found). Click any highlighted text to review and accept/reject.`);
            // }
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
        } else {
            // Alert removed per user request
            // alert("No PII found to highlight. Make sure your document contains the sample text.");
        }
    }
}

// ChatGPT/Gemini-specific highlighting that shows inline highlights in the input field
function highlightPiiForChatGPT(entities) {
    try {
        const pageType = detectPageType();
        const isGemini = pageType === 'gemini';
        
        // Use the enhanced textarea finder
        const textareaResult = findChatGPTTextarea();
        
        if (!textareaResult || !textareaResult.textarea) {
            // Alert removed per user request
            // alert(`${isGemini ? 'Gemini' : 'ChatGPT'} input not found. Please make sure you're in the chat interface and have typed a message.`);
            return;
        }
        
        const textarea = textareaResult.textarea;
        // CRITICAL: Always extract text the same way and normalize it consistently
        // This ensures the text used for scanning matches what we'll use for accepting
        let originalText = textareaResult.text;
        
        // Normalize text immediately to ensure consistent encoding
        // This handles cases where value vs textContent might differ
        if (originalText) {
            originalText = originalText.normalize('NFC');
        }
        
        // If textareaResult.text is empty, try direct extraction with normalization
        if (!originalText || !originalText.trim()) {
            const directText = textarea.value || textarea.textContent || textarea.innerText || '';
            originalText = directText.normalize('NFC');
        }
        
        console.log(`[PII Extension] Found input field with selector: ${textareaResult.selector}`);
        console.log(`[PII Extension] Text extraction method: value=${textarea.value?.length || 0}, textContent=${textarea.textContent?.length || 0}, innerText=${textarea.innerText?.length || 0}`);
        
        if (!originalText || !originalText.trim()) {
            console.warn(`[PII Extension] No text found in ${isGemini ? 'Gemini' : 'ChatGPT'} input field`);
            console.warn(`[PII Extension] Textarea value: "${textarea.value}"`);
            console.warn(`[PII Extension] Textarea textContent: "${textarea.textContent}"`);
            console.warn(`[PII Extension] Textarea innerText: "${textarea.innerText}"`);
            // Alert removed per user request
            // alert(`No text found in ${isGemini ? 'Gemini' : 'ChatGPT'} input. Please type your message in the input field first.`);
            return;
        }
        
        console.log(`[PII Extension] Analyzing ${isGemini ? 'Gemini' : 'ChatGPT'} input field text for PII (${originalText.length} characters, normalized)...`);
        
        // First, filter out any PII that overlaps with already-redacted text
        const filteredEntities = filterRedactedPII(entities, originalText);
        console.log(`[PII Extension] Filtered ${entities.length - filteredEntities.length} PII entities that overlap with redacted text`);
        
        // Find PII in the text by searching for each entity value in the current text
        // This ensures we find the actual positions, even if text has changed
        const foundPII = [];
        filteredEntities.forEach(entity => {
            // Get entity value - try 'value' first, then 'text', then extract from text
            let entityValue = entity.value || entity.text;
            if (!entityValue && entity.start !== undefined && entity.end !== undefined) {
                // Extract value from text using start/end positions
                entityValue = originalText.substring(entity.start, entity.end);
            }
            
            // Skip if we still don't have a value
            if (!entityValue || typeof entityValue !== 'string') {
                console.warn("[PII Extension] Skipping entity without valid value:", entity);
                return;
            }
            
            const entityType = entity.type;
            
            // Normalize both text and entity value for better matching
            // This handles Unicode normalization issues (e.g., Turkish characters)
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
                    if (!isRedactedText(normalizedText, foundIndex, foundIndex + normalizedEntityValue.length)) {
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
                        if (!isRedactedText(normalizedText, foundIndex, foundIndex + actualText.length)) {
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
                // Backend provided offsets - verify if they're still valid
                const backendStart = entity.start;
                const backendEnd = entity.end;
                
                if (backendStart >= 0 && backendEnd <= normalizedText.length && backendEnd > backendStart) {
                    const textAtBackendOffset = normalizedText.substring(backendStart, backendEnd);
                    
                    // Check if the text at backend offset matches (case-insensitive)
                    if (textAtBackendOffset.toLowerCase() === lowerEntityValue) {
                        // Backend offset is still valid
                        if (!isRedactedText(normalizedText, backendStart, backendEnd)) {
                            occurrences.push({
                                start: backendStart,
                                end: backendEnd,
                                value: textAtBackendOffset
                            });
                            console.log(`[PII Extension] Found PII "${entityValue}" using backend offset ${backendStart}-${backendEnd}`);
                        } else {
                            console.warn(`[PII Extension] Backend offset ${backendStart}-${backendEnd} points to already-redacted text`);
                        }
                    } else {
                        // Backend offset doesn't match - text might have changed
                        console.warn(`[PII Extension] Backend offset mismatch: expected "${entityValue}" at ${backendStart}-${backendEnd}, found "${textAtBackendOffset}"`);
                    }
                }
            }
            
            // Strategy 4: If still not found, try with whitespace normalization
            if (occurrences.length === 0) {
                // Remove all whitespace and compare
                const textNoWhitespace = normalizedText.replace(/\s+/g, '');
                const entityNoWhitespace = normalizedEntityValue.replace(/\s+/g, '');
                
                if (textNoWhitespace.includes(entityNoWhitespace)) {
                    // Find position accounting for removed whitespace
                    const lowerTextNoWS = textNoWhitespace.toLowerCase();
                    const lowerEntityNoWS = entityNoWhitespace.toLowerCase();
                    const indexInNoWS = lowerTextNoWS.indexOf(lowerEntityNoWS);
                    
                    if (indexInNoWS !== -1) {
                        // Try to find the actual position in original text
                        // This is approximate but better than nothing
                        const approximateIndex = normalizedText.toLowerCase().indexOf(lowerEntityValue);
                        if (approximateIndex !== -1) {
                            const actualText = normalizedText.substring(approximateIndex, approximateIndex + normalizedEntityValue.length);
                            if (actualText.toLowerCase() === lowerEntityValue && 
                                !isRedactedText(normalizedText, approximateIndex, approximateIndex + normalizedEntityValue.length)) {
                                occurrences.push({
                                    start: approximateIndex,
                                    end: approximateIndex + normalizedEntityValue.length,
                                    value: actualText
                                });
                            }
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
            
            if (occurrences.length === 0) {
                // Enhanced debugging
                console.warn(`[PII Extension] Could not find PII "${entityValue}" in current text`);
                console.warn(`[PII Extension] Entity length: ${entityValue.length}, Text length: ${normalizedText.length}`);
                console.warn(`[PII Extension] Entity (first 50 chars): "${entityValue.substring(0, 50)}"`);
                console.warn(`[PII Extension] Text contains entity (case-insensitive): ${lowerText.includes(lowerEntityValue)}`);
                
                // Try to find partial matches to help debug
                if (normalizedEntityValue.length > 5) {
                    // Check if at least part of the entity exists
                    const firstPart = normalizedEntityValue.substring(0, Math.min(10, normalizedEntityValue.length));
                    const lastPart = normalizedEntityValue.substring(Math.max(0, normalizedEntityValue.length - 10));
                    
                    const firstPartFound = lowerText.includes(firstPart.toLowerCase());
                    const lastPartFound = lowerText.includes(lastPart.toLowerCase());
                    
                    console.warn(`[PII Extension] First part "${firstPart}" found: ${firstPartFound}`);
                    console.warn(`[PII Extension] Last part "${lastPart}" found: ${lastPartFound}`);
                    
                    if (firstPartFound || lastPartFound) {
                        // Try to find where it might be
                        const searchPattern = firstPartFound ? firstPart : lastPart;
                        const searchIndex = lowerText.indexOf(searchPattern.toLowerCase());
                        if (searchIndex !== -1) {
                            const contextStart = Math.max(0, searchIndex - 20);
                            const contextEnd = Math.min(normalizedText.length, searchIndex + searchPattern.length + 20);
                            const context = normalizedText.substring(contextStart, contextEnd);
                            console.warn(`[PII Extension] Found partial match at position ${searchIndex}, context: "${context}"`);
                        }
                    }
                }
                
                // Check if entity might be split across lines or have different whitespace
                const entityWords = normalizedEntityValue.split(/\s+/).filter(w => w.length > 0);
                if (entityWords.length > 1) {
                    const allWordsFound = entityWords.every(word => 
                        lowerText.includes(word.toLowerCase())
                    );
                    if (allWordsFound) {
                        console.warn(`[PII Extension] All words of "${entityValue}" are present in text, but not as a continuous string`);
                    }
                }
                
                // For emails, check if @ symbol might be causing issues
                if (entityType === 'EMAIL' && normalizedEntityValue.includes('@')) {
                    const emailParts = normalizedEntityValue.split('@');
                    if (emailParts.length === 2) {
                        const localPart = emailParts[0];
                        const domainPart = emailParts[1];
                        const localFound = lowerText.includes(localPart.toLowerCase());
                        const domainFound = lowerText.includes(domainPart.toLowerCase());
                        console.warn(`[PII Extension] Email local part "${localPart}" found: ${localFound}`);
                        console.warn(`[PII Extension] Email domain "${domainPart}" found: ${domainFound}`);
                    }
                }
            }
        });
        
        if (foundPII.length === 0) {
            // Alert removed per user request
            // alert(`No PII found in your ${isGemini ? 'Gemini' : 'ChatGPT'} message.`);
            return;
        }
        
        // Store the original text and PII info for later use
        window.chatGPTOriginalText = originalText;
        window.chatGPTFoundPII = foundPII;
        window.chatGPTTextarea = textarea;
        
        // Create inline overlay highlights for each PII item
        createInlineHighlightsForTextarea(textarea, foundPII, originalText);
        
        // Show consistent info message with model name
        const modelName = getLastModelName() || 'Presidio';
        const totalDetected = entities.length;
        const totalHighlighted = foundPII.length;
        
        // Alerts removed per user request
        // if (totalHighlighted === totalDetected) {
        //     alert(`Scan complete with ${modelName}! Found ${totalHighlighted} PII items. Click any yellow highlight to accept or reject individually.`);
        // } else {
        //     alert(`Scan complete with ${modelName}! Detected ${totalDetected} PII items, highlighted ${totalHighlighted} (${totalDetected - totalHighlighted} filtered out - may be already redacted). Click any yellow highlight to accept or reject individually.`);
        // }
        
    } catch (error) {
        console.error("[PII Extension] Error in chat interface PII analysis:", error);
        const pageType = detectPageType();
        // Alert removed per user request
        // alert(`Error analyzing ${pageType === 'gemini' ? 'Gemini' : 'ChatGPT'} text. Please try again.`);
    }
}

// NEW ROBUST HIGHLIGHTING SYSTEM
// Creates accurate highlights by finding actual text positions and handling multi-line text properly
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
    const lineHeight = parseFloat(textareaStyle.lineHeight) || parseFloat(textareaStyle.fontSize) * 1.2;
    
    // Sort entities by position
    const sortedEntities = entities.sort((a, b) => a.start - b.start);
    
    sortedEntities.forEach((entity, index) => {
        try {
            const entityText = text.substring(entity.start, entity.end);
            
            // Use new robust positioning method
            const lineSegments = getTextLineSegments(textarea, text, entity.start, entity.end, textareaRect, textareaStyle);
            
            if (lineSegments.length === 0) {
                console.warn(`[PII Extension] Could not find line segments for "${entity.value}"`);
                return;
            }
            
            // Create a highlight overlay for each line segment
            // This ensures accurate highlighting even for multi-line text
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
// Uses precise Range API to get exact character positions
// Returns array of {left, top, width, height} for each line segment
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
    overlay.setAttribute('data-suggestion-id', generateSuggestionId());
    
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

// ============================================================================
// OFFSET TRACKING SYSTEM FOR PII REDACTION
// ============================================================================

/**
 * Option A: Replace spans in descending order (from end to start)
 * This prevents earlier spans' indices from shifting when later ones are replaced.
 * 
 * @param {string} text - Original text string
 * @param {Array} spans - Array of {start, end, entity} objects with original offsets
 * @param {Function} maskFor - Callback that returns mask string for given entity
 * @returns {Object} {text: redactedText, updatedSpans: array with new offsets}
 */
function redactPII_DescendingOrder(text, spans, maskFor) {
    // Sort spans by start position in descending order
    const sortedSpans = [...spans].sort((a, b) => b.start - a.start);
    
    let redactedText = text;
    const updatedSpans = [];
    
    // Track offset adjustments for each span
    const adjustments = new Map();
    
    sortedSpans.forEach(span => {
        const mask = maskFor(span.entity);
        const originalLength = span.end - span.start;
        const lengthDiff = mask.length - originalLength;
        
        // Apply redaction
        redactedText = redactedText.substring(0, span.start) + mask + redactedText.substring(span.end);
        
        // Calculate new offsets for this span
        const newStart = span.start;
        const newEnd = span.start + mask.length;
        
        updatedSpans.push({
            start: newStart,
            end: newEnd,
            entity: span.entity,
            maskedText: mask
        });
        
        // Store adjustment for spans that come before this one
        adjustments.set(span.start, lengthDiff);
    });
    
    // Update offsets for all spans based on adjustments
    updatedSpans.forEach(span => {
        let adjustment = 0;
        adjustments.forEach((diff, position) => {
            if (position > span.start) {
                adjustment += diff;
            }
        });
        
        if (adjustment !== 0) {
            span.start += adjustment;
            span.end += adjustment;
        }
    });
    
    // Sort updated spans back to ascending order
    updatedSpans.sort((a, b) => a.start - b.start);
    
    return {
        text: redactedText,
        updatedSpans: updatedSpans
    };
}

/**
 * Option B: Replace spans in ascending order with delta tracking
 * Tracks cumulative length difference as we process each span.
 * 
 * @param {string} text - Original text string
 * @param {Array} spans - Array of {start, end, entity} objects with original offsets
 * @param {Function} maskFor - Callback that returns mask string for given entity
 * @returns {Object} {text: redactedText, updatedSpans: array with new offsets}
 */
function redactPII_AscendingOrder(text, spans, maskFor) {
    // Sort spans by start position in ascending order
    const sortedSpans = [...spans].sort((a, b) => a.start - b.start);
    
    let redactedText = text;
    let cumulativeDelta = 0; // Track cumulative length difference
    const updatedSpans = [];
    
    sortedSpans.forEach(span => {
        const mask = maskFor(span.entity);
        const originalLength = span.end - span.start;
        const lengthDiff = mask.length - originalLength;
        
        // Adjust start/end positions based on previous redactions
        const adjustedStart = span.start + cumulativeDelta;
        const adjustedEnd = span.end + cumulativeDelta;
        
        // Apply redaction at adjusted position
        redactedText = redactedText.substring(0, adjustedStart) + 
                      mask + 
                      redactedText.substring(adjustedEnd);
        
        // Calculate new offsets
        const newStart = adjustedStart;
        const newEnd = adjustedStart + mask.length;
        
        updatedSpans.push({
            start: newStart,
            end: newEnd,
            entity: span.entity,
            maskedText: mask
        });
        
        // Update cumulative delta for next iterations
        cumulativeDelta += lengthDiff;
    });
    
    return {
        text: redactedText,
        updatedSpans: updatedSpans
    };
}

/**
 * Remove overlapping spans to prevent offset calculation errors
 * When spans overlap, keep the one that starts first and is longest
 * 
 * @param {Array} spans - Array of {start, end, entity} objects
 * @returns {Array} Non-overlapping spans array
 */
function removeOverlappingSpans(spans) {
    if (spans.length === 0) return [];
    
    // Sort by start position, then by length (longest first) for same start
    const sorted = [...spans].sort((a, b) => {
        if (a.start !== b.start) {
            return a.start - b.start;
        }
        // If same start, prefer longer span
        return (b.end - b.start) - (a.end - a.start);
    });
    
    const nonOverlapping = [];
    
    for (const span of sorted) {
        // Check if this span overlaps with any already added span
        let overlaps = false;
        for (const existing of nonOverlapping) {
            // Check if spans overlap: one starts before the other ends
            if (span.start < existing.end && span.end > existing.start) {
                overlaps = true;
                break;
            }
        }
        
        if (!overlaps) {
            nonOverlapping.push(span);
        }
    }
    
    return nonOverlapping;
}

/**
 * Main redaction function - uses Option B (ascending order) by default
 * as it's more intuitive and easier to understand.
 */
function redactPIIWithOffsetTracking(text, spans, maskFor) {
    return redactPII_AscendingOrder(text, spans, maskFor);
}

// ============================================================================
// END OFFSET TRACKING SYSTEM
// ============================================================================

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

// Helper function to calculate text position using a mirror element with accurate word wrapping
function calculateTextPosition(textarea, fullText, start, end, textareaRect, textareaStyle) {
    const paddingLeft = parseFloat(textareaStyle.paddingLeft) || 0;
    const paddingTop = parseFloat(textareaStyle.paddingTop) || 0;
    const fontSize = parseFloat(textareaStyle.fontSize) || 14;
    const fontFamily = textareaStyle.fontFamily;
    const lineHeight = parseFloat(textareaStyle.lineHeight) || fontSize * 1.2;
    const borderWidth = parseFloat(textareaStyle.borderLeftWidth) || 0;
    
    // Validate indices
    if (start < 0 || end < start || end > fullText.length) {
        console.warn(`[PII Extension] Invalid text indices: start=${start}, end=${end}, textLength=${fullText.length}`);
        return { left: 0, top: 0, width: 0, height: lineHeight };
    }
    
    // Create a mirror div with same styling as textarea, positioned exactly like textarea
    const mirror = document.createElement('div');
    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.wordBreak = textareaStyle.wordBreak || 'normal';
    mirror.style.fontSize = fontSize + 'px';
    mirror.style.fontFamily = fontFamily;
    mirror.style.fontWeight = textareaStyle.fontWeight;
    mirror.style.fontStyle = textareaStyle.fontStyle;
    mirror.style.letterSpacing = textareaStyle.letterSpacing;
    mirror.style.lineHeight = textareaStyle.lineHeight;
    mirror.style.width = textareaRect.width + 'px';
    mirror.style.padding = textareaStyle.padding;
    mirror.style.border = textareaStyle.border;
    mirror.style.boxSizing = 'border-box';
    mirror.style.overflow = 'hidden';
    mirror.style.left = textareaRect.left + 'px';
    mirror.style.top = textareaRect.top + 'px';
    mirror.style.zIndex = '-9999'; // Ensure it's behind everything
    document.body.appendChild(mirror);
    
    const textBefore = fullText.substring(0, start);
    const entityText = fullText.substring(start, end);
    const textAfter = fullText.substring(end);
    
    // Use marker spans to measure exact positions
    const startMarker = document.createElement('span');
    startMarker.id = 'pii-start-marker-' + Date.now();
    startMarker.style.display = 'inline';
    startMarker.style.width = '0';
    startMarker.style.height = '0';
    startMarker.style.overflow = 'hidden';
    
    const endMarker = document.createElement('span');
    endMarker.id = 'pii-end-marker-' + Date.now();
    endMarker.style.display = 'inline';
    endMarker.style.width = '0';
    endMarker.style.height = '0';
    endMarker.style.overflow = 'hidden';
    
    // Build mirror content with markers - use text nodes to preserve exact formatting
    mirror.innerHTML = '';
    if (textBefore) {
        mirror.appendChild(document.createTextNode(textBefore));
    }
    mirror.appendChild(startMarker);
    if (entityText) {
        mirror.appendChild(document.createTextNode(entityText));
    }
    mirror.appendChild(endMarker);
    if (textAfter) {
        mirror.appendChild(document.createTextNode(textAfter));
    }
    
    // Force a reflow to ensure layout is calculated
    void mirror.offsetHeight;
    
    // Get positions of markers
    const startRect = startMarker.getBoundingClientRect();
    const endRect = endMarker.getBoundingClientRect();
    
    // Check if text spans multiple lines (wrapped text)
    // Compare Y positions - if they differ significantly, text wraps
    const lineHeightValue = parseFloat(textareaStyle.lineHeight) || fontSize * 1.2;
    const spansMultipleLines = Math.abs(startRect.top - endRect.top) > lineHeightValue * 0.3;
    
    let left, top, width, height;
    
    if (spansMultipleLines) {
        // Text wraps across multiple lines
        // For multi-line text, we need to be more careful with width calculation
        // The issue is that a single rectangle can't perfectly represent wrapped text
        // So we'll calculate a reasonable bounding box
        
        left = startRect.left;
        top = startRect.top;
        
        // Calculate the number of lines
        const numLines = Math.ceil((endRect.bottom - startRect.top) / lineHeightValue);
        
        // For multi-line text, calculate width more carefully
        // First line: from start to right edge (or to end if it fits on one line)
        // Last line: from left edge to end
        const firstLineRemaining = textareaRect.right - startRect.left;
        const lastLineWidth = endRect.right - textareaRect.left;
        
        if (numLines === 2) {
            // Two lines: use the maximum width needed
            // But don't make it wider than necessary
            width = Math.max(firstLineRemaining, lastLineWidth);
            // Cap it at textarea width to avoid over-extending
            width = Math.min(width, textareaRect.width);
        } else {
            // Three or more lines: middle lines need full width
            // But we still need to cover first and last lines properly
            width = textareaRect.width;
            // But if the calculated width from markers is reasonable, use that instead
            const markerWidth = endRect.right - startRect.left;
            if (markerWidth < textareaRect.width * 1.5 && markerWidth > 0) {
                width = Math.max(markerWidth, Math.max(firstLineRemaining, lastLineWidth));
            }
        }
        
        // Height spans from first line top to last line bottom
        height = endRect.bottom - startRect.top;
        
        // Ensure minimum dimensions
        if (height < lineHeightValue) {
            height = lineHeightValue;
        }
        if (width <= 0) {
            width = 20; // Minimum width
        }
        
        console.log(`[PII Extension] Multi-line text "${entityText.substring(0, 30)}": ${numLines} lines, width=${width.toFixed(1)}, height=${height.toFixed(1)}`);
    } else {
        // Single line - use marker positions directly
        left = startRect.left;
        top = startRect.top;
        width = Math.max(endRect.right - startRect.left, 10);
        height = Math.max(endRect.bottom - startRect.top, lineHeight);
    }
    
    // Ensure width is not negative or zero
    if (width <= 0) {
        // Fallback: estimate width based on text length
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = `${fontSize}px ${fontFamily}`;
        width = Math.max(context.measureText(entityText).width, 20);
    }
    
    // Ensure height is reasonable (for multi-line, should be at least lineHeight)
    if (height <= 0) {
        height = spansMultipleLines ? lineHeight * Math.ceil(entityText.length / 50) : lineHeight;
    }
    
    // Clean up
    try {
        document.body.removeChild(mirror);
    } catch (e) {
        console.warn('[PII Extension] Error removing mirror element:', e);
    }
    
    return { left, top, width, height };
}

// Helper function to find text node at a specific character position
function findTextNodeAtPosition(element, charPosition) {
    let currentPos = 0;
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
    );
    
    let node;
    while (node = walker.nextNode()) {
        const nodeLength = node.textContent.length;
        if (currentPos + nodeLength >= charPosition) {
            return node;
        }
        currentPos += nodeLength;
    }
    return null;
}

// Show suggestion popup for textarea overlay highlights
function showTextareaSuggestionPopup(overlayElement, entity) {
    // Remove any existing popups
    document.querySelectorAll(`.${SUGGESTION_POPUP_CLASS}`).forEach(popup => popup.remove());
    
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const suggestionId = overlayElement.getAttribute('data-suggestion-id');
    
    // Create popup
    const popup = document.createElement('div');
    popup.className = SUGGESTION_POPUP_CLASS;
    
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
            <strong>Will become:</strong> "<span class="pii-redaction-preview">${getRedactionLabel(piiType)}</span>"
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
        // Alert removed per user request
        // alert("Input field not found. Please try scanning again.");
        popup.remove();
        return;
    }
    
    // Get current text from textarea (may have been modified)
    const currentText = textarea.value || textarea.textContent || '';
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const redactionLabel = getRedactionLabel(piiType);
    
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
        // Try to find the exact PII value in the text
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
            // Alert removed per user request
            // alert(`Error: Could not find "${piiValue}" in the text. The text may have been modified.`);
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
    // After redaction, offsets shift by the difference between original and redacted length
    const redactionLengthDiff = redactionLabel.length - (actualEnd - actualStart);
    const redactionPoint = newText.indexOf(redactionLabel);
    
    const updatedPII = [];
    window.chatGPTFoundPII.forEach(pii => {
        let newStart = pii.start;
        let newEnd = pii.end;
        
        // If this PII comes after the redaction point, adjust its offsets
        if (pii.start >= actualEnd) {
            newStart = pii.start + redactionLengthDiff;
            newEnd = pii.end + redactionLengthDiff;
        } else if (pii.end > actualStart && pii.start < actualEnd) {
            // This PII overlaps with the redacted one - skip it (shouldn't happen, but safety check)
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
    // Find all overlays with the same PII value and position, remove them
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

// ChatGPT/Gemini-specific accept all function
// Uses the new offset tracking system for accurate redaction
function acceptAllPIIForChatGPT() {
    try {
        const pageType = detectPageType();
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
            // Alert removed per user request
            // alert("Please scan for PII first.");
            return;
        }
        
        // CRITICAL: Extract text the same way as during scanning to ensure consistency
        // Use the same extraction method that was used when storing chatGPTOriginalText
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
        // This is critical - the stored originalText was normalized, so we must normalize currentText too
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
                        !isRedactedText(normalizedCurrentText, storedStart, storedEnd)) {
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
                        if (!isRedactedText(normalizedCurrentText, foundIndex, foundIndex + normalizedPiiValue.length)) {
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
                        
                        if (!isRedactedText(normalizedCurrentText, foundIndex, foundIndex + actualText.length)) {
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
                        !isRedactedText(normalizedCurrentText, actualStart, actualEnd)) {
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
            
            if (foundOccurrences.length === 0) {
                console.warn(`[PII Extension] Could not find PII "${piiValue}" (${pii.type}) in current text`);
                console.warn(`[PII Extension] PII value length: ${piiValue.length}, normalized: "${normalizedPiiValue}"`);
                console.warn(`[PII Extension] Text length: ${normalizedCurrentText.length}`);
                console.warn(`[PII Extension] Text contains PII (case-insensitive): ${lowerText.includes(lowerPiiValue)}`);
            } else {
                console.log(`[PII Extension] Found ${foundOccurrences.length} occurrence(s) of "${piiValue}" (${pii.type})`);
            }
        });
        
        if (spans.length === 0) {
            // Alert removed per user request
            // alert("No PII found to redact. The text may have been modified or already redacted.");
            return;
        }
        
        // Remove overlapping spans to prevent offset calculation errors
        // This is critical - overlapping spans cause nested/incorrect redaction tags
        const nonOverlappingSpans = removeOverlappingSpans(spans);
        
        if (nonOverlappingSpans.length === 0) {
            // Alert removed per user request
            // alert("No PII found to redact after removing overlaps. The text may have been modified or already redacted.");
            return;
        }
        
        // Sort spans by start position (required for offset tracking)
        nonOverlappingSpans.sort((a, b) => a.start - b.start);
        
        // Create mask function
        const maskFor = (entity) => {
            return getRedactionLabel(entity.type);
        };
        
        // Use the new offset tracking system to redact all PII
        // IMPORTANT: Use normalized text for redaction since spans are based on normalized positions
        // This ensures correct matching for Turkish characters and Unicode issues
        const result = redactPIIWithOffsetTracking(normalizedCurrentText, nonOverlappingSpans, maskFor);
        
        console.log(`[PII Extension] Redacted ${nonOverlappingSpans.length} PII items using offset tracking system (${spans.length} total found, ${spans.length - nonOverlappingSpans.length} overlaps removed)`);
        console.log(`[PII Extension] Original text length: ${normalizedCurrentText.length}, Redacted length: ${result.text.length}`);
        
        // Store mappings for original PII -> masked version (for future fake data filling)
        // This allows us to track: original -> masked -> fake
        nonOverlappingSpans.forEach((span, index) => {
            const mappingId = generatePIIMappingId();
            const maskedLabel = getRedactionLabel(span.entity.type);
            const mapping = {
                id: mappingId,
                original: span.entity.value, // Original PII value
                masked: maskedLabel, // The redaction label like [NAME]
                fake: null, // Will be filled when user clicks Fill button
                type: span.entity.type,
                position: span.start, // Position in original text
                timestamp: Date.now()
            };
            
            window.piiMapping.set(mappingId, mapping);
            console.log(`[PII Extension] Pre-stored mapping for future fill: ${mapping.original} -> ${mapping.masked}`);
        });
        
        // Update input field safely (works for both ChatGPT and Gemini)
        const success = setChatGPTInputValue(result.text, textarea);
        if (success) {
            // Remove all overlays
            document.querySelectorAll('.pii-textarea-overlay').forEach(el => {
                if (el._updatePosition) {
                    window.removeEventListener('scroll', el._updatePosition, true);
                    window.removeEventListener('resize', el._updatePosition);
                }
                el.remove();
            });
            
            // Alert removed per user request
            // alert(`Successfully redacted ${nonOverlappingSpans.length} PII items. Your message is ready to send.`);
            
            // Keep stored data for fill operation (don't delete yet)
            // We'll clean it up after fill or when user sends message
            // delete window.chatGPTOriginalText;
            // delete window.chatGPTFoundPII;
            // delete window.chatGPTTextarea;
        } else {
            // Alert removed per user request
            // alert(`Failed to update ${isGemini ? 'Gemini' : 'ChatGPT'} input. Please try again.`);
        }
        
    } catch (error) {
        console.error("[PII Extension] Error in chat interface accept all:", error);
        // Alert removed per user request
        // alert("Error redacting PII. Please try again.");
    }
}

// Helper function to get all text nodes within an element
function getTextNodesIn(element) {
    const textNodes = [];
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // Skip empty text nodes and script/style content
                if (node.textContent.trim().length === 0) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Skip nodes in script, style, or other non-content elements
                const parent = node.parentElement;
                if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
        // Debug: log first few characters of each text node
        if (textNodes.length <= 5) {
            console.log(`Text node ${textNodes.length}: "${node.textContent.substring(0, 50)}..."`);
        }
    }
    
    // If we found some text nodes, log a sample of the content
    if (textNodes.length > 0) {
        const sampleText = textNodes.slice(0, 3).map(n => n.textContent.trim()).join(' ');
        console.log(`Sample content from text nodes: "${sampleText.substring(0, 100)}..."`);
    }
    
    return textNodes;
}

// Check if a node is already highlighted
function isAlreadyHighlighted(node) {
    let parent = node.parentElement;
    while (parent) {
        if (parent.classList && parent.classList.contains(HIGHLIGHT_CLASS)) {
            return true;
        }
        parent = parent.parentElement;
    }
    return false;
}

// Highlight specific text within a text node
function highlightTextInNode(textNode, startIndex, length, entity) {
    try {
        const text = textNode.textContent;
        const beforeText = text.substring(0, startIndex);
        const highlightedText = text.substring(startIndex, startIndex + length);
        const afterText = text.substring(startIndex + length);

        // Create highlight span
        const highlightSpan = document.createElement('span');
        highlightSpan.className = HIGHLIGHT_CLASS;
        highlightSpan.setAttribute('data-pii-type', entity.type);
        highlightSpan.setAttribute('data-pii-value', entity.value);
        highlightSpan.textContent = highlightedText;
        highlightSpan.style.backgroundColor = '#FBBF24';
        highlightSpan.style.color = '#000';
        highlightSpan.style.cursor = 'pointer';
        highlightSpan.style.padding = '2px';
        highlightSpan.style.borderRadius = '3px';

        // Create document fragment to replace the text node
        const fragment = document.createDocumentFragment();
        
        if (beforeText) {
            fragment.appendChild(document.createTextNode(beforeText));
        }
        
        fragment.appendChild(highlightSpan);
        
        if (afterText) {
            fragment.appendChild(document.createTextNode(afterText));
        }

        // Replace the original text node with the fragment
        textNode.parentNode.replaceChild(fragment, textNode);
        
        console.log(`Highlighted: "${highlightedText}" as ${entity.type}`);
    } catch (error) {
        console.error('Error highlighting text:', error);
    }
}

// Adds click listeners to the highlighted PII spans for suggestions
function addRedactEvents() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
        // Skip if already processed or rejected
        if (el.classList.contains(REJECTED_CLASS)) return;
        
        el.onclick = (event) => {
            event.stopPropagation(); // Prevents interference with page editor
            showSuggestionPopup(el);
        };
        
        // Add hover effect
        el.style.cursor = 'pointer';
        el.title = 'Click to review PII suggestion';
    });
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
        // Alert removed per user request
        // alert(`Overlay highlighting complete! Found ${highlightCount} PII suggestions. Click yellow boxes to review and accept/reject.`);
    } else {
        // Alert removed per user request
        // alert("Could not create overlay highlights. The text might not be accessible for positioning.");
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
    overlay.setAttribute('data-suggestion-id', generateSuggestionId());
    
    overlay.style.position = 'absolute';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.backgroundColor = 'rgba(251, 191, 36, 0.7)'; // New palette yellow with transparency
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

// Show suggestion popup for overlay highlights
function showOverlaySuggestionPopup(overlayElement) {
    // Remove any existing popups
    document.querySelectorAll(`.${SUGGESTION_POPUP_CLASS}`).forEach(popup => popup.remove());
    
    const piiValue = overlayElement.getAttribute('data-pii-value');
    const piiType = overlayElement.getAttribute('data-pii-type');
    const suggestionId = overlayElement.getAttribute('data-suggestion-id');
    
    // Create popup similar to regular suggestion popup
    const popup = document.createElement('div');
    popup.className = SUGGESTION_POPUP_CLASS;
    
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
            <strong>Will become:</strong> "<span class="pii-redaction-preview">${getRedactionLabel(piiType)}</span>"
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
    const pageType = detectPageType();
    
    // Store decision
    suggestionStates.set(suggestionId, 'accepted');
    
    // Change overlay to show it's redacted
    const redactionLabel = getRedactionLabel(piiType);
    overlayElement.style.backgroundColor = 'rgba(34, 211, 238, 0.9)'; // New palette cyan
    overlayElement.style.border = '2px solid #22D3EE';
    overlayElement.innerHTML = `<span style="color: black; font-weight: bold; font-size: 12px; padding: 2px; display: flex; align-items: center; justify-content: center; height: 100%;">${redactionLabel}</span>`;
    overlayElement.onclick = null; // Remove click handler
    overlayElement.style.cursor = 'default';
    overlayElement.title = `Redacted ${piiType}: ${piiValue}`;
    
    // If on ChatGPT, update the input field with sanitized content
    if (pageType === 'chatgpt') {
        setTimeout(() => {
            const sanitizedText = extractSanitizedText();
            if (sanitizedText) {
                setChatGPTInputValue(sanitizedText);
            }
        }, 100); // Small delay to ensure DOM is updated
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
    suggestionStates.set(suggestionId, 'rejected');
    
    // Remove the overlay entirely
    overlayElement.remove();
    
    // Remove popup
    popup.remove();
    
    console.log(`Rejected overlay suggestion: ${piiType} "${piiValue}"`);
}

// Legacy redact function (keeping for backward compatibility)
function showSuggestionPopup(highlightElement) {
    // Remove any existing popups
    document.querySelectorAll(`.${SUGGESTION_POPUP_CLASS}`).forEach(popup => popup.remove());
    
    const piiValue = highlightElement.getAttribute('data-pii-value');
    const piiType = highlightElement.getAttribute('data-pii-type');
    const suggestionId = highlightElement.getAttribute('data-suggestion-id');
    
    // Create popup container
    const popup = document.createElement('div');
    popup.className = SUGGESTION_POPUP_CLASS;
    
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
            <strong>Will become:</strong> "<span class="pii-redaction-preview">${getRedactionLabel(piiType)}</span>"
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
        const pageType = detectPageType();
        
        // Store decision
        suggestionStates.set(suggestionId, 'accepted');
        
        // Replace with redaction label
        const redactionLabel = getRedactionLabel(piiType);
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
                    const sanitizedText = extractSanitizedText();
                    if (sanitizedText) {
                        setChatGPTInputValue(sanitizedText);
                    }
                } catch (updateError) {
                    console.error("[PII Extension] Error updating ChatGPT input after individual acceptance:", updateError);
                }
            }, 100); // Small delay to ensure DOM is updated
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
    suggestionStates.set(suggestionId, 'rejected');
    
    // Remove highlighting but keep original text
    const textNode = document.createTextNode(highlightElement.textContent);
    highlightElement.parentNode.replaceChild(textNode, highlightElement);
    
    // Remove popup
    popup.remove();
    
    console.log(`Rejected suggestion: ${piiType} "${piiValue}"`);
}

// Redact function
function handleRedactClick(el) {
    const piiValue = el.getAttribute('data-pii-value');
    const piiType = el.getAttribute('data-pii-type');
    
    if (!piiValue) return;

    // 1. Create masked text
    const mask = '*'.repeat(piiValue.length);
    
    // 2. Replace the highlighted span with masked text
    const maskedTextNode = document.createTextNode(mask);
    el.parentNode.replaceChild(maskedTextNode, el);
    
    console.log(`Redacted: ${piiType} - "${piiValue}" -> "${mask}"`);
    
    // Optional: Show confirmation
    // alert(`Redacted ${piiType}: ${piiValue}`);
}

// Detect page type and adjust behavior accordingly
function detectPageType() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  
  if (hostname.includes('docs.google.com')) {
    return 'google-docs';
  } else if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) {
    return 'chatgpt';
  } else if (hostname.includes('gemini.google.com') || hostname.includes('bard.google.com')) {
    return 'gemini';
  } else if (hostname.includes('gmail.com')) {
    return 'gmail';
  } else {
    return 'general-web';
  }
}

// Initialize the PII detector with robust DOM loading handling
// ============================================================================
// MESSAGE SEND DETECTION AND HIGHLIGHT CLEANUP
// ============================================================================

/**
 * Detects when a message is sent and clears highlights from input field
 * Also ensures highlights don't appear in sent messages
 */
function setupMessageSendDetection() {
    const pageType = detectPageType();
    
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
        if (agentPipelineState.running || agentPipelineState.awaitingResponse) {
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

// ============================================================================
// END MESSAGE SEND DETECTION
// ============================================================================

function initializePiiDetector() {
  const pageType = detectPageType();
  console.log(`Detected page type: ${pageType}`);
  
  // Ensure document.body is available
  if (document.body) {
    injectScanButton();
    // Setup message send detection for chat interfaces
    setupMessageSendDetection();
  } else {
    // Wait for body to be available
    const observer = new MutationObserver((mutations, obs) => {
      if (document.body) {
        injectScanButton();
        // Setup message send detection for chat interfaces
        setupMessageSendDetection();
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

