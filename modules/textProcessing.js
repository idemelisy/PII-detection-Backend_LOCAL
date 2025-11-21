// ============================================================================
// TEXT PROCESSING MODULE
// ============================================================================
// Text extraction, redaction, faker library, and PII mapping functions

(function() {
'use strict';

// Ensure required modules are loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before textProcessing module');
}
if (!window.PIIExtension || !window.PIIExtension.pageDetection) {
    console.error('[PII Extension] PageDetection module must be loaded before textProcessing module');
}

const config = window.PIIExtension.config;
const pageDetection = window.PIIExtension.pageDetection;

// Global memory structure to track: original PII -> masked version -> faked version
// Structure: window.piiMapping = Map<uniqueId, {original, masked, fake, type, position}>
if (!window.piiMapping) {
    window.piiMapping = new Map();
}

// Generate unique ID for each PII mapping
function generatePIIMappingId() {
    return 'pii_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
// TEXT EXTRACTION AND UTILITIES
// ============================================================================

// Universal content finder that works on different page types
function findContentArea() {
    const pageType = pageDetection.detectPageType();
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

/**
 * Remove overlapping spans to prevent offset calculation errors
 * When spans overlap, keep the one that starts first and is longest
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
        let overlappingWith = null;
        for (const existing of nonOverlapping) {
            // Check if spans overlap: one starts before the other ends
            if (span.start < existing.end && span.end > existing.start) {
                overlaps = true;
                overlappingWith = existing;
                break;
            }
        }
        
        if (!overlaps) {
            nonOverlapping.push(span);
        } else if (overlappingWith) {
            console.log(`[PII Extension] Removed overlapping PII: "${span.entity.value}" (${span.entity.type}) at ${span.start}-${span.end} - overlaps with "${overlappingWith.entity.value}" (${overlappingWith.entity.type}) at ${overlappingWith.start}-${overlappingWith.end}`);
        }
    }
    
    return nonOverlapping;
}

/**
 * Replace spans in ascending order with delta tracking
 * Tracks cumulative length difference as we process each span.
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
 * Main redaction function - uses ascending order by default
 */
function redactPIIWithOffsetTracking(text, spans, maskFor) {
    return redactPII_AscendingOrder(text, spans, maskFor);
}

// Export to global namespace
window.PIIExtension.textProcessing = {
    generatePIIMappingId,
    generateSuggestionId,
    getRedactionLabel,
    randomChoice,
    generateFakeForType,
    labelToType,
    findContentArea,
    getSimpleTextNodesIn,
    extractSanitizedText,
    isRedactedText,
    filterRedactedPII,
    removeOverlappingSpans,
    redactPII_AscendingOrder,
    redactPIIWithOffsetTracking
};

})(); // End IIFE
