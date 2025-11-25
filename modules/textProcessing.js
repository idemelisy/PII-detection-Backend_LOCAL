// ============================================================================
// TEXT PROCESSING MODULE
// ============================================================================
// Text extraction, redaction, faker library, and PII mapping functions

console.log('[PII Extension] ===== textProcessing.js file loaded =====');
console.log('[PII Extension] Current window.PIIExtension:', window.PIIExtension);
console.log('[PII Extension] Current window.PIIExtension.textProcessing:', window.PIIExtension?.textProcessing);

(function() {
'use strict';

try {
    console.log('[PII Extension] textProcessing module starting to load...');

    // Ensure window.PIIExtension exists
    if (!window.PIIExtension) {
        window.PIIExtension = {};
        console.log('[PII Extension] Created window.PIIExtension');
    }

// Ensure required modules are loaded
if (!window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before textProcessing module');
}
if (!window.PIIExtension.pageDetection) {
    console.error('[PII Extension] PageDetection module must be loaded before textProcessing module');
}

const config = window.PIIExtension.config || {};
const pageDetection = window.PIIExtension.pageDetection || {};

const DEFAULT_REDACTION_LABEL = '[REDACTED]';
const GENERIC_LABEL_PATTERN = '\\[[A-Z0-9_]+\\]';

function createLabelRegex(flags = 'gi') {
    return new RegExp(GENERIC_LABEL_PATTERN, flags);
}

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

// Normalize any PII type (e.g. "GivenName", "phone number") into TOKEN format
function normalizePiiTypeToken(piiType) {
    if (piiType === undefined || piiType === null) {
        return null;
    }
    const normalized = String(piiType)
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .toUpperCase();
    return normalized || null;
}

// Get redaction label based on PII type (falls back to [REDACTED])
function getRedactionLabel(piiType) {
    const normalizedType = normalizePiiTypeToken(piiType);
    if (!normalizedType) {
        return DEFAULT_REDACTION_LABEL;
    }
    return `[${normalizedType}]`;
}

function containsRedactionLabel(text) {
    if (!text) return false;
    return createLabelRegex('i').test(text);
}

function findRedactionRanges(text) {
    if (!text) return [];
    const ranges = [];
    const regex = createLabelRegex('gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
        ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            label: match[0]
        });
    }
    return ranges;
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
        // Location-related: Single word to avoid offset issues
        case 'LOCATION':
        case 'ADDRESS':
        case 'STREET':
        case 'CITY':
        case 'STATE':
        case 'COUNTRY':
            return randomChoice(['Springfield','Riverton','Lakewood','Fairview','Greenwood','Riverside','Hillcrest','Brookside','Oakland','Portland','Austin','Denver','Phoenix','Seattle','Boston','Dallas']);
        case 'BUILDINGNUM':
            return `${Math.floor(1+Math.random()*999)}`;
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
    const normalizedLabel = normalizePiiTypeToken(label.replace(/\[|\]/g, ''));
    if (!normalizedLabel) {
        return null;
    }
    switch (normalizedLabel) {
        case 'NAME':
        case 'FULLNAME':
        case 'FULL_NAME':
        case 'FIRSTNAME':
        case 'FIRST_NAME':
        case 'LASTNAME':
        case 'LAST_NAME':
        case 'SURNAME':
        case 'GIVENNAME':
        case 'GIVEN_NAME':
            return 'PERSON';
        case 'EMAIL':
        case 'EMAILADDRESS':
        case 'EMAIL_ADDRESS':
            return 'EMAIL';
        case 'PHONE':
        case 'PHONENUMBER':
        case 'PHONE_NUMBER':
        case 'TELEPHONENUM':
        case 'TELEPHONE':
        case 'TELEPHONE_NUMBER':
        case 'MOBILE':
        case 'MOBILEPHONE':
        case 'MOBILE_PHONE':
            return 'PHONE';
        case 'LOCATION':
        case 'ADDRESS':
        case 'STREET':
        case 'CITY':
        case 'COUNTRY':
        case 'STATE':
            return 'LOCATION';
        case 'BUILDINGNUM':
        case 'BUILDING_NUM':
        case 'BUILDINGNUMBER':
        case 'BUILDING_NUMBER':
            return 'BUILDINGNUM';
        case 'ORGANIZATION':
        case 'COMPANY':
        case 'ORG':
            return 'ORGANIZATION';
        case 'REDACTED':
            return 'PERSON';
        case 'ID':
            return 'ID';
        case 'BANK_ACCOUNT':
        case 'BANKACCOUNT':
            return 'BANK_ACCOUNT';
        case 'SSN':
        case 'US_SSN':
            return 'SSN';
        case 'URL':
        case 'WEBSITE':
        case 'LINK':
            return 'URL';
        case 'DATE_TIME':
        case 'DATETIME':
        case 'DATE':
            return 'DATE_TIME';
        default:
            return normalizedLabel;
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
    const redactionRanges = findRedactionRanges(text);
    if (redactionRanges.length === 0) {
        return false;
    }
    
    const textAtPosition = text.substring(start, end);
    if (containsRedactionLabel(textAtPosition)) {
        return true;
    }
    
    for (const range of redactionRanges) {
        if ((start >= range.start && start < range.end) ||
            (end > range.start && end <= range.end) ||
            (start <= range.start && end >= range.end)) {
            return true;
        }
    }
    
    return false;
}

// Filter out PII entities that overlap with already-redacted text
function filterRedactedPII(entities, text) {
    const redactionRanges = findRedactionRanges(text);
    
    if (redactionRanges.length === 0) {
        return entities;
    }
    
    return entities.filter(entity => {
        for (const range of redactionRanges) {
            if ((entity.start >= range.start && entity.start < range.end) || 
                (entity.end > range.start && entity.end <= range.end) ||
                (entity.start <= range.start && entity.end >= range.end)) {
                console.log(`[PII Extension] Filtering out PII "${entity.value}" at ${entity.start}-${entity.end} - overlaps with redaction label ${range.label}`);
                return false;
            }
        }
        
        const entityText = text.substring(entity.start, entity.end);
        if (containsRedactionLabel(entityText)) {
            console.log(`[PII Extension] Filtering out PII "${entity.value}" - contains redaction label`);
            return false;
        }
        
        return true;
    });
}

function ensurePiiMapping() {
    if (!window.piiMapping) {
        window.piiMapping = new Map();
    }
    return window.piiMapping;
}

function findExistingMappingForLabel(maskLabel, piiType, currentScanPIIValues) {
    const mappings = ensurePiiMapping();
    console.log(`[PII Extension] Searching for mapping: label="${maskLabel}", type="${piiType}", total mappings=${mappings.size}`);
    
    // Helper function to check if types match (handles variations like GIVENNAME -> PERSON)
    function typesMatch(mappingType, requestedType) {
        if (!mappingType || !requestedType) return false;
        if (mappingType === requestedType) return true;
        
        // Normalize types to uppercase for comparison
        const mappingTypeUpper = mappingType.toUpperCase();
        const requestedTypeUpper = requestedType.toUpperCase();
        if (mappingTypeUpper === requestedTypeUpper) return true;
        
        // Handle PERSON/NAME variations - use labelToType to normalize
        const personTypes = ['PERSON', 'NAME', 'GIVENNAME', 'GIVEN_NAME', 'FIRSTNAME', 'FIRST_NAME', 'LASTNAME', 'LAST_NAME', 'SURNAME', 'FULLNAME', 'FULL_NAME'];
        const mappingIsPerson = personTypes.some(t => mappingTypeUpper.includes(t.toUpperCase()));
        const requestedIsPerson = personTypes.some(t => requestedTypeUpper.includes(t.toUpperCase()));
        if (mappingIsPerson && requestedIsPerson) {
            return true;
        }
        
        // Handle PHONE variations
        const phoneTypes = ['PHONE', 'PHONE_NUMBER', 'PHONENUMBER', 'TELEPHONE', 'TELEPHONE_NUMBER', 'TELEPHONENUM', 'MOBILE', 'MOBILEPHONE', 'MOBILE_PHONE'];
        const mappingIsPhone = phoneTypes.some(t => mappingTypeUpper.includes(t.toUpperCase()));
        const requestedIsPhone = phoneTypes.some(t => requestedTypeUpper.includes(t.toUpperCase()));
        if (mappingIsPhone && requestedIsPhone) {
            return true;
        }
        
        // Handle LOCATION variations
        const locationTypes = ['LOCATION', 'CITY', 'ADDRESS', 'STREET', 'STREET_ADDRESS', 'COUNTRY', 'STATE', 'ZIP', 'POSTAL_CODE'];
        const mappingIsLocation = locationTypes.some(t => mappingTypeUpper.includes(t.toUpperCase()));
        const requestedIsLocation = locationTypes.some(t => requestedTypeUpper.includes(t.toUpperCase()));
        if (mappingIsLocation && requestedIsLocation) {
            return true;
        }
        
        return false;
    }
    
    for (const [, mapping] of mappings.entries()) {
        const maskedMatch = mapping.masked === maskLabel;
        const typeMatch = typesMatch(mapping.type, piiType);
        
        if (maskedMatch && typeMatch) {
            console.log(`[PII Extension] Found potential mapping: original="${mapping.original}", masked="${mapping.masked}", type="${mapping.type}", fake=${mapping.fake ? 'set' : 'null'}`);
            // Allow reusing mappings even if they already have fake values (for re-fill scenarios)
            // But prefer mappings without fake values
            if (mapping.fake === null || mapping.fake === undefined) {
                if (currentScanPIIValues.size === 0) {
                    console.log(`[PII Extension] Returning mapping (no PII value check needed)`);
                    return mapping;
                }
                const originalLower = mapping.original ? mapping.original.toLowerCase() : null;
                if (originalLower && currentScanPIIValues.has(originalLower)) {
                    console.log(`[PII Extension] Returning mapping (PII value matched)`);
                    return mapping;
                }
            }
        } else if (maskedMatch && !typeMatch) {
            console.log(`[PII Extension] Mapping found but type mismatch: mapping.type="${mapping.type}", requested="${piiType}"`);
        }
    }
    
    // If no mapping found without fake, try to find one with fake (for re-fill)
    for (const [, mapping] of mappings.entries()) {
        if (mapping.masked === maskLabel && typesMatch(mapping.type, piiType)) {
            if (currentScanPIIValues.size === 0) {
                return mapping;
            }
            const originalLower = mapping.original ? mapping.original.toLowerCase() : null;
            if (originalLower && currentScanPIIValues.has(originalLower)) {
                return mapping;
            }
        }
    }
    
    return null;
}

function createMapping(maskLabel, piiType, fakeValue, position, originalValue) {
    const mappings = ensurePiiMapping();
    const mappingId = generatePIIMappingId();
    const mapping = {
        id: mappingId,
        original: originalValue || maskLabel,
        masked: maskLabel,
        fake: fakeValue,
        type: piiType,
        position,
        timestamp: Date.now(),
        filledTimestamp: Date.now()
    };
    mappings.set(mappingId, mapping);
    return mapping;
}

// Helper to generate unique fake data for a session
function generateUniqueFake(piiType, existingFakes) {
    let fake = generateFakeForType(piiType);
    let attempts = 0;
    while (existingFakes.has(fake.toLowerCase()) && attempts < 10) {
        fake = generateFakeForType(piiType);
        attempts++;
    }
    existingFakes.add(fake.toLowerCase());
    return fake;
}

function fillRedactionsInChatInput() {
    console.log('[PII Extension] fillRedactionsInChatInput called');
    
    const chatIntegration = window.PIIExtension && window.PIIExtension.chatIntegration;
    if (!chatIntegration || !chatIntegration.findChatGPTTextarea || !chatIntegration.setChatGPTInputValue) {
        console.warn('[PII Extension] Chat integration module not ready for fill operation');
        return;
    }
    
    const textareaResult = chatIntegration.findChatGPTTextarea();
    if (!textareaResult || !textareaResult.textarea) {
        console.warn('[PII Extension] Input field not found for filling faker data.');
        return;
    }
    
    const textarea = textareaResult.textarea;
    const text = textarea.value || textarea.textContent || textarea.innerText || '';
    console.log(`[PII Extension] Input text length: ${text.length}`);
    
    if (!text || text.trim().length === 0) {
        console.warn('[PII Extension] No text found in input to fill.');
        return;
    }
    
    const labelRegex = createLabelRegex('gi');
    
    // First pass: collect all matches with their positions
    const matches = [];
    labelRegex.lastIndex = 0;
    while (true) {
        const match = labelRegex.exec(text);
        if (!match) break;
        matches.push({
            match: match[0],
            index: match.index,
            length: match[0].length
        });
    }
    
    if (matches.length === 0) {
        console.log('[PII Extension] No redaction labels found to fill.');
        return;
    }
    
    // Group matches by label
    const matchesByLabel = {};
    for (const matchInfo of matches) {
        const label = matchInfo.match;
        if (!matchesByLabel[label]) {
            matchesByLabel[label] = [];
        }
        matchesByLabel[label].push(matchInfo);
    }
    
    // Get existing mappings and group by masked label
    const mappings = ensurePiiMapping();
    const mappingsByLabel = {};
    
    for (const [, mapping] of mappings.entries()) {
        const label = mapping.masked;
        if (!mappingsByLabel[label]) {
            mappingsByLabel[label] = [];
        }
        mappingsByLabel[label].push(mapping);
    }
    
    // Sort mappings for each label by position (original appearance order)
    // This is CRITICAL: Ensure we map 1st [GIVENNAME] to 1st Person, 2nd to 2nd Person
    for (const label in mappingsByLabel) {
        mappingsByLabel[label].sort((a, b) => {
            const posA = a.position !== undefined ? a.position : 0;
            const posB = b.position !== undefined ? b.position : 0;
            return posA - posB;
        });
    }
    
    // Track generated fakes to ensure uniqueness
    const generatedFakes = new Set();
    
    // Prepare replacements map (index -> replacement)
    const replacements = new Map();
    let replacedCount = 0;
    
    // Assign fakes to mappings matching the order in text
    for (const label in matchesByLabel) {
        const labelMatches = matchesByLabel[label];
        const labelMappings = mappingsByLabel[label] || [];
        
        console.log(`[PII Extension] Processing label "${label}": found ${labelMatches.length} matches in text, ${labelMappings.length} mappings`);
        
        // Match 1-to-1 in order
        for (let i = 0; i < labelMatches.length; i++) {
            const matchInfo = labelMatches[i];
            
            // If we have a mapping for this position
            if (i < labelMappings.length) {
                const mapping = labelMappings[i];
                const piiType = labelToType(label);
                
                // Generate fake value
                const fake = generateUniqueFake(piiType, generatedFakes);
                
                // Update mapping
                mapping.fake = fake;
                mapping.filledTimestamp = Date.now();
                mapping.fakeOffset = matchInfo.index;
                mapping.fakeLength = fake.length;
                mapping.labelOrder = i; // Store order explicitly
                
                console.log(`[PII Extension] Mapped "${label}" (match #${i}) to "${mapping.original}" -> Fake: "${fake}"`);
                
                // Store replacement
                replacements.set(matchInfo.index, {
                    length: matchInfo.length,
                    text: fake
                });
                replacedCount++;
            } else {
                console.warn(`[PII Extension] No mapping found for "${label}" match #${i} (out of mappings). Skipping.`);
            }
        }
    }
    
    if (replacedCount === 0) {
        console.log('[PII Extension] No redaction labels could be mapped to existing PII.');
        return;
    }
    
    // Apply replacements in reverse order
    let newText = text;
    const sortedIndices = Array.from(replacements.keys()).sort((a, b) => b - a);
    
    for (const index of sortedIndices) {
        const replacement = replacements.get(index);
        newText = newText.substring(0, index) + replacement.text + newText.substring(index + replacement.length);
    }
    
    const success = chatIntegration.setChatGPTInputValue(newText, textarea);
    if (success) {
        document.querySelectorAll('.pii-textarea-overlay, .pii-suggestion-popup').forEach(el => {
            if (el._updatePosition) {
                window.removeEventListener('scroll', el._updatePosition, true);
                window.removeEventListener('resize', el._updatePosition);
            }
            el.remove();
        });
        console.log(`[PII Extension] Filled ${replacedCount} redactions with synthetic data.`);
    } else {
        console.error('[PII Extension] Failed to update input field with fake data.');
    }
}

function fillRedactionsInDocument() {
    const redactedSpans = Array.from(document.querySelectorAll('.pii-redacted'));
    if (redactedSpans.length === 0) {
        console.log('[PII Extension] No redacted spans found on this page to fill.');
        return;
    }
    
    let filled = 0;
    redactedSpans.forEach(span => {
        try {
            const maskedLabel = span.textContent || '';
            const originalValue = span.getAttribute('data-original-value') || maskedLabel;
            const piiType = span.getAttribute('data-pii-type') || labelToType(maskedLabel) || 'PERSON';
            const fake = generateFakeForType(piiType);
            
            const mapping = createMapping(maskedLabel, piiType, fake, -1, originalValue);
            span.setAttribute('data-original-value', originalValue);
            span.setAttribute('data-fake-value', fake);
            span.setAttribute('data-mapping-id', mapping.id);
            span.textContent = fake;
            span.classList.remove('pii-redacted');
            span.classList.add('pii-filled');
            
            filled++;
            console.log(`[PII Extension] Mapping stored: ${mapping.original} -> ${mapping.masked} -> ${mapping.fake}`);
        } catch (error) {
            console.error('[PII Extension] Error filling a redacted span:', error);
        }
    });
    
    console.log(`[PII Extension] Filled ${filled} redacted spans with synthetic data.`);
}

function fillRedactions() {
    try {
        console.log('[PII Extension] fillRedactions called');
        
        // Check if pageDetection is available
        if (!pageDetection || !pageDetection.detectPageType) {
            console.error('[PII Extension] pageDetection module not available');
            return;
        }
        
        const pageType = pageDetection.detectPageType();
        console.log(`[PII Extension] Detected page type: ${pageType}`);
        
        if (pageType === 'chatgpt' || pageType === 'gemini') {
            console.log('[PII Extension] Using chat input fill method');
            fillRedactionsInChatInput();
        } else {
            console.log('[PII Extension] Using document fill method');
            fillRedactionsInDocument();
        }
    } catch (error) {
        console.error('[PII Extension] Error while filling redactions:', error);
        console.error('[PII Extension] Error stack:', error.stack);
    }
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

// ============================================================================
// REVERT FUNCTIONS - Replace fake PII back to original values
// ============================================================================

/**
 * Revert fake PII data in ChatGPT/Gemini response back to original PII values
 * Only processes the GPT response, not the input field
 */
function revertPIIsInResponse() {
    const pageType = pageDetection.detectPageType();
    
    if (pageType !== 'chatgpt' && pageType !== 'gemini') {
        console.warn('[PII Extension] Revert PIIs only works on ChatGPT/Gemini pages');
        return;
    }
    
    // Check if we have mappings
    if (!window.piiMapping || window.piiMapping.size === 0) {
        console.warn('[PII Extension] No PII mappings found. Please scan, accept, and fill PIIs first.');
        return;
    }
    
    // Get mappings that have fake data (were filled) for response revert
    const filledMappings = [];
    for (const [id, mapping] of window.piiMapping.entries()) {
        if (mapping.fake && mapping.original) {
            filledMappings.push(mapping);
        }
    }
    
    if (filledMappings.length === 0) {
        console.log('[PII Extension] No filled mappings found in response to revert.');
        return;
    }
    
    console.log(`[PII Extension] Found ${filledMappings.length} filled mappings to revert in response`);
    
    // Get response selectors using chatIntegration module
    const chatIntegration = window.PIIExtension?.chatIntegration;
    if (!chatIntegration || !chatIntegration.getAssistantResponseSelectors) {
        console.error('[PII Extension] chatIntegration module not available or getAssistantResponseSelectors missing');
        return;
    }
    
    const responseSelectors = chatIntegration.getAssistantResponseSelectors(pageType);
    
    let responseElements = [];
    for (const selector of responseSelectors) {
        try {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                responseElements = Array.from(elements);
                console.log(`[PII Extension] Found ${elements.length} potential response elements with selector: ${selector}`);
                break;
            }
        } catch (e) {
            console.warn(`[PII Extension] Error with selector ${selector}:`, e);
        }
    }
    
    // If no specific selector worked, use document body
    if (responseElements.length === 0) {
        responseElements = [document.body];
        console.log('[PII Extension] Using document.body for revert');
    }
    
    // Log mappings for debugging
    for (const mapping of filledMappings) {
        console.log(`[PII Extension] Mapping: fake="${mapping.fake}", original="${mapping.original}", masked="${mapping.masked}", type="${mapping.type}"`);
    }
    
    // Sort all mappings by fake value length (longest first) to avoid partial replacements
    const sortedFilledMappings = filledMappings.sort((a, b) => b.fake.length - a.fake.length);
    
    let totalReverted = 0;
    let totalReplacements = 0;
    
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
        
        if (textNodes.length === 0) {
            continue;
        }
        
        // Process each text node
        for (const textNode of textNodes) {
            let nodeText = textNode.textContent;
            let nodeModified = false;
            
            // Apply replacements for each mapping
            for (const mapping of sortedFilledMappings) {
                if (!mapping.fake || !mapping.original) continue;
                
                const fakeValue = mapping.fake;
                const originalValue = mapping.original;
                
                // Simple string replacement (global)
                // We escape special regex characters in fakeValue to use it safely
                const escapedFake = fakeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // Use simple replacement for all types to ensure consistency
                // This handles cases where GPT changes sentence structure
                const regex = new RegExp(escapedFake, 'g');
                
                if (regex.test(nodeText)) {
                    const newText = nodeText.replace(regex, originalValue);
                    if (newText !== nodeText) {
                        nodeText = newText;
                        nodeModified = true;
                        totalReplacements++;
                        console.log(`[PII Extension] Reverted: "${fakeValue}" -> "${originalValue}"`);
                    }
                }
            }
            
            if (nodeModified) {
                textNode.textContent = nodeText;
                totalReverted++;
            }
        }
    }
    
    console.log(`[PII Extension] Revert complete: ${totalReverted} text nodes modified, ${totalReplacements} total replacements made`);
}

/**
 * Revert fake PII data in document body (for general pages)
 */
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
        const regexPatterns = [];
        if (mapping.type === 'PHONE' || mapping.type === 'PHONE_NUMBER') {
            regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
            const fakeDigits = fakeValue.replace(/\D/g, '');
            if (fakeDigits.length >= 10) {
                const digitPattern = fakeDigits.split('').join('[\\s\\-\\.\\(\\)]*');
                regexPatterns.push(new RegExp(digitPattern, 'gi'));
            }
        } else if (mapping.type === 'LOCATION') {
            regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
            const fakeParts = fakeValue.split(/[,\s]+/).filter(p => p.length > 2);
            for (const part of fakeParts) {
                if (part.length > 3) {
                    const escapedPart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    regexPatterns.push(new RegExp(`\\b${escapedPart}\\b`, 'gi'));
                }
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
                            const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
                            const isComponent = fakeParts.some(p => 
                                match.toLowerCase().includes(p.toLowerCase()) || 
                                p.toLowerCase().includes(match.toLowerCase())
                            );
                            if (match === fakeValue || match.toLowerCase() === fakeValue.toLowerCase() || isComponent) {
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
                        break;
                    }
                }
            }
        }
    }
    
    console.log(`[PII Extension] Document-wide revert complete: ${totalReplacements} replacements`);
}

/**
 * Aggressive location-specific revert using multi-strategy approach
 */
function revertLocationsAggressively(locationMappings) {
    if (!locationMappings || locationMappings.length === 0) return;
    
    console.log(`[PII Extension] Aggressive location revert for ${locationMappings.length} locations`);
    const pageType = pageDetection.detectPageType();
    
    const chatIntegration = window.PIIExtension.chatIntegration;
    if (!chatIntegration || !chatIntegration.getAssistantResponseSelectors) {
        console.error('[PII Extension] chatIntegration module not available');
        return;
    }
    
    const responseSelectors = chatIntegration.getAssistantResponseSelectors(pageType);
    
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
        
        // Multi-strategy regex patterns
        const regexPatterns = [];
        regexPatterns.push(new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'));
        
        const fakeParts = fakeValue.split(/[,\s\/]+/).filter(p => p.length > 2);
        const originalParts = originalValue.split(/[,\s\/]+/).filter(p => p.length > 2);
        
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
                
                // Try full address replacement first
                const fullPatterns = [
                    new RegExp(escapedFake.replace(/\s+/g, '\\s+'), 'gi'),
                    new RegExp(escapedFake.replace(/[.\s]+/g, '[.\\s]+'), 'gi'),
                    new RegExp(escapedFake.replace(/[/\s]+/g, '[/\\s]+'), 'gi'),
                ];
                
                let fullReplaced = false;
                for (const fullPattern of fullPatterns) {
                    const fullMatch = nodeText.match(fullPattern);
                    if (fullMatch && fullMatch[0].length > 5) {
                        nodeText = nodeText.replace(fullPattern, originalValue);
                        nodeModified = true;
                        totalReplacements++;
                        fullReplaced = true;
                        break;
                    }
                }
                
                if (fullReplaced) {
                    textNode.textContent = nodeText;
                    continue;
                }
                
                // Try component replacement
                for (const regex of regexPatterns) {
                    const isFullPattern = fullPatterns.some(fp => fp.source === regex.source);
                    if (isFullPattern) continue;
                    
                    const beforeReplace = nodeText;
                    nodeText = nodeText.replace(regex, (match) => {
                        let replacementValue = originalValue;
                        
                        if (match === fakeValue || match.toLowerCase() === fakeValue.toLowerCase()) {
                            nodeModified = true;
                            return replacementValue;
                        }
                        
                        const matchedPartIndex = fakeParts.findIndex(p => 
                            match.toLowerCase().includes(p.toLowerCase()) || 
                            p.toLowerCase().includes(match.toLowerCase())
                        );
                        
                        if (matchedPartIndex >= 0 && matchedPartIndex < originalParts.length) {
                            replacementValue = originalParts[matchedPartIndex];
                        }
                        
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
                    
                    if (nodeText !== beforeReplace && nodeModified) {
                        textNode.textContent = nodeText;
                        totalReplacements++;
                        break;
                    }
                }
            }
        }
    }
    
    console.log(`[PII Extension] Aggressive location revert complete: ${totalReplacements} replacements`);
}

// Export to global namespace
try {
    // Ensure window.PIIExtension exists
    if (!window.PIIExtension) {
        window.PIIExtension = {};
        console.log('[PII Extension] Created window.PIIExtension in export section');
    }

    window.PIIExtension.textProcessing = {
        generatePIIMappingId,
        generateSuggestionId,
        getRedactionLabel,
        randomChoice,
        generateFakeForType,
        labelToType,
        fillRedactions,
        findContentArea,
        getSimpleTextNodesIn,
        extractSanitizedText,
        isRedactedText,
        filterRedactedPII,
        removeOverlappingSpans,
        redactPII_AscendingOrder,
        redactPIIWithOffsetTracking,
        revertPIIsInResponse,
        revertPIIsInDocumentBody,
        revertLocationsAggressively
    };

    console.log('[PII Extension] textProcessing module exported successfully');
    console.log('[PII Extension] Available functions:', Object.keys(window.PIIExtension.textProcessing));
} catch (error) {
    console.error('[PII Extension] Error exporting textProcessing module:', error);
    console.error('[PII Extension] Error stack:', error.stack);
}

} catch (error) {
    console.error('[PII Extension] CRITICAL ERROR in textProcessing module:', error);
    console.error('[PII Extension] Error message:', error.message);
    console.error('[PII Extension] Error stack:', error.stack);
    
    // Try to export at least an empty object so other modules don't crash
    try {
        if (!window.PIIExtension) {
            window.PIIExtension = {};
        }
        window.PIIExtension.textProcessing = {
            fillRedactions: function() {
                console.error('[PII Extension] textProcessing module failed to load - fillRedactions unavailable');
            }
        };
        console.log('[PII Extension] Exported minimal textProcessing object due to error');
    } catch (exportError) {
        console.error('[PII Extension] Could not even export minimal object:', exportError);
    }
}

})(); // End IIFE
