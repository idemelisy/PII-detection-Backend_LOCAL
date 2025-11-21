// ============================================================================
// UI MODULE
// ============================================================================
// UI components: scan button, container, draggable elements, popups

(function() {
'use strict';

// Ensure required modules are loaded
if (!window.PIIExtension || !window.PIIExtension.config) {
    console.error('[PII Extension] Config module must be loaded before ui module');
}
if (!window.PIIExtension || !window.PIIExtension.models) {
    console.error('[PII Extension] Models module must be loaded before ui module');
}
if (!window.PIIExtension || !window.PIIExtension.pageDetection) {
    console.error('[PII Extension] PageDetection module must be loaded before ui module');
}

const config = window.PIIExtension.config;
const models = window.PIIExtension.models;
const pageDetection = window.PIIExtension.pageDetection;

// ============================================================================
// POPUP AND INFO FUNCTIONS
// ============================================================================

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
                localStorage.setItem(config.INFO_POPUP_STORAGE_KEY, 'true');
            } else {
                localStorage.removeItem(config.INFO_POPUP_STORAGE_KEY);
            }
        });
    }

    return overlay;
}

function showInfoPopup() {
    const overlay = ensureInfoPopupElements();
    const checkbox = overlay.querySelector('#pii-info-hide-checkbox');
    if (checkbox) {
        checkbox.checked = localStorage.getItem(config.INFO_POPUP_STORAGE_KEY) === 'true';
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
        if (localStorage.getItem(config.INFO_POPUP_STORAGE_KEY) === 'true') {
            return;
        }
        if (window[config.INFO_POPUP_AUTO_FLAG]) {
            return;
        }
        window[config.INFO_POPUP_AUTO_FLAG] = true;
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

// ============================================================================
// MINI TRIGGER FUNCTIONS
// ============================================================================

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

// ============================================================================
// CONTAINER COLLAPSE/EXPAND FUNCTIONS
// ============================================================================

function initializeContainerCollapse(container) {
    const isCollapsed = localStorage.getItem('pii-container-collapsed') === 'true';
    if (isCollapsed) {
        collapseContainer(container);
    }
}

function toggleContainerCollapse(container) {
    const isCollapsed = container.classList.contains('pii-collapsed');
    
    if (isCollapsed) {
        expandContainer(container);
    } else {
        collapseContainer(container);
    }
}

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

// ============================================================================
// CONTAINER DRAGGABLE FUNCTION
// ============================================================================

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

// ============================================================================
// SCAN BUTTON INJECTION
// ============================================================================
// NOTE: This function references handleScanClick, clearHighlights, acceptAllPII,
// fillRedactions, revertPIIsInResponse, handleModelChange, handleModeChange,
// handleSendAnonymizedClick, and updateModeUIState which are in other modules
// These will need to be accessed via window.PIIExtension namespace

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
            // Use module reference
            if (window.PIIExtension.highlighting && window.PIIExtension.highlighting.handleScanClick) {
                window.PIIExtension.highlighting.handleScanClick(event);
            }
        });

        const clearButton = document.createElement("button");
        clearButton.id = "pii-clear-button";
        clearButton.innerHTML = `<span role="img" aria-label="Clear">❌</span> Clear Highlights`;
        clearButton.onclick = () => {
            // Use module reference
            if (window.PIIExtension.highlighting && window.PIIExtension.highlighting.clearHighlights) {
                window.PIIExtension.highlighting.clearHighlights();
            }
        };

        const acceptAllButton = document.createElement("button");
        acceptAllButton.id = "pii-accept-all-button";
        acceptAllButton.innerHTML = `<span role="img" aria-label="Accept All">✅</span> Accept All`;
        acceptAllButton.onclick = () => {
            // Use module reference
            if (window.PIIExtension.highlighting && window.PIIExtension.highlighting.acceptAllPII) {
                window.PIIExtension.highlighting.acceptAllPII();
            }
        };

        const fillButton = document.createElement("button");
        fillButton.id = "pii-fill-button";
        fillButton.innerHTML = `<span role="img" aria-label="Fill">🪄</span> Fill (faker)`;
        fillButton.onclick = () => {
            try {
                if (window.PIIExtension.textProcessing && window.PIIExtension.textProcessing.fillRedactions) {
                    window.PIIExtension.textProcessing.fillRedactions();
                }
            } catch (e) {
                console.error('[PII Extension] Error in Fill button:', e);
            }
        };

        const revertButton = document.createElement("button");
        revertButton.id = "pii-revert-button";
        revertButton.innerHTML = `<span role="img" aria-label="Revert">↩️</span> Revert PIIs`;
        revertButton.onclick = () => {
            try {
                if (window.PIIExtension.textProcessing && window.PIIExtension.textProcessing.revertPIIsInResponse) {
                    window.PIIExtension.textProcessing.revertPIIsInResponse();
                }
            } catch (e) {
                console.error('[PII Extension] Error in Revert button:', e);
            }
        };

        const modelSelectContainer = document.createElement("div");
        modelSelectContainer.id = "pii-model-container";

        const modelLabel = document.createElement("label");
        modelLabel.htmlFor = config.MODEL_SELECT_ID;
        modelLabel.textContent = "Model:";
        modelLabel.style.fontSize = "12px";
        modelLabel.style.color = "#048BA8";
        modelLabel.style.fontWeight = "600";
        modelLabel.style.marginBottom = "4px";
        modelLabel.style.display = "block";

        const modelSelect = document.createElement("select");
        modelSelect.id = config.MODEL_SELECT_ID;
        modelSelect.addEventListener('change', (event) => {
            if (window.PIIExtension.models && window.PIIExtension.models.handleModelChange) {
                window.PIIExtension.models.handleModelChange(event);
            }
        });
        
        const modelStatus = document.createElement("div");
        modelStatus.id = config.MODEL_STATUS_ID;
        modelStatus.style.fontSize = "11px";
        modelStatus.style.color = "#0f172a";
        modelStatus.style.marginTop = "4px";
        modelStatus.textContent = "Last run: pending...";

        modelSelectContainer.appendChild(modelLabel);
        modelSelectContainer.appendChild(modelSelect);
        modelSelectContainer.appendChild(modelStatus);
        models.populateModelSelectOptions(null, modelSelect);
        const lastResolved = window.PIIExtension.getLastResolvedModel();
        const currentModel = window.PIIExtension.getCurrentModel();
        models.updateModelStatusIndicator(lastResolved || currentModel);

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
            <option value="${config.MODE_CONTROL}">Control Mode (Manual)</option>
            <option value="${config.MODE_AGENT}">Agent Mode (Auto)</option>
        `;
        modeSelect.value = window.PIIExtension.getExtensionMode();
        modeSelect.onchange = (event) => {
            if (window.PIIExtension.agent && window.PIIExtension.agent.handleModeChange) {
                window.PIIExtension.agent.handleModeChange(event);
            }
        };
        modeContainer.appendChild(modeSelect);

        modeContainer.style.maxWidth = '200px';
        modeSelect.style.width = '100%';

        const sendAnonymizedButton = document.createElement('button');
        sendAnonymizedButton.id = 'pii-send-anonymized-button';
        sendAnonymizedButton.innerHTML = `<span role="img" aria-label="Agent">🤖</span> Send Anonymized`;
        sendAnonymizedButton.onclick = (event) => {
            if (window.PIIExtension.agent && window.PIIExtension.agent.handleSendAnonymizedClick) {
                window.PIIExtension.agent.handleSendAnonymizedClick(event);
            }
        };
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
        // TODO: Replace with module reference
        if (typeof updateModeUIState === 'function') {
            updateModeUIState();
        } else if (window.PIIExtension.agent && window.PIIExtension.agent.updateModeUIState) {
            window.PIIExtension.agent.updateModeUIState();
        }
        console.log("PII Scan buttons injected successfully to document.body");
    } else {
        console.log("PII Scan container already exists, skipping injection");
        if (!container.hasAttribute('data-draggable-initialized')) {
            makeContainerDraggable(container);
        }
        if (window.PIIExtension.agent && window.PIIExtension.agent.updateModeUIState) {
            window.PIIExtension.agent.updateModeUIState();
        }
    }

    if (container) {
        ensureInfoButton(container);
    }
    maybeAutoShowInfoPopup();
}

// Export to global namespace
window.PIIExtension.ui = {
    showAutoModelPopup,
    getOrCreateActionBar,
    ensureInfoButton,
    ensureInfoPopupElements,
    showInfoPopup,
    hideInfoPopup,
    maybeAutoShowInfoPopup,
    blockClickIfDragging,
    getMiniTrigger,
    applyMiniPosition,
    ensureMiniTrigger,
    makeMiniTriggerDraggable,
    initializeContainerCollapse,
    toggleContainerCollapse,
    collapseContainer,
    expandContainer,
    setupCollapseButtonInteraction,
    makeContainerDraggable,
    injectScanButton
};

})(); // End IIFE
