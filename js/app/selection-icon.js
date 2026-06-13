/*
 * Injection script for Selection Icon (similar to Google Translate)
 */
(() => {
    let iconBtn = null;

    function createIcon() {
        if (iconBtn) return;
        
        iconBtn = document.createElement('div');
        iconBtn.id = 'vocabitan-selection-icon';
        iconBtn.title = 'Translate with Vocabitan (Selection)';
        
        // Match the Google Translate popup UI style:
        Object.assign(iconBtn.style, {
            position: 'absolute',
            zIndex: '2147483647', // Max z-index to appear over everything
            display: 'none',
            width: '30px',
            height: '30px',
            backgroundColor: '#ffffff',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
            cursor: 'pointer',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            transition: 'opacity 0.15s ease-in-out',
            opacity: '0',
            userSelect: 'none'
        });
        
        const imgContainer = document.createElement('div');
        Object.assign(imgContainer.style, {
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        const img = document.createElement('img');
        img.src = chrome.runtime.getURL('images/icon32.png');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.pointerEvents = 'none'; // Prevent dragging
        
        imgContainer.appendChild(img);
        iconBtn.appendChild(imgContainer);
        
        iconBtn.addEventListener('mousedown', (e) => {
            // Prevent text selection from clearing
            e.preventDefault();
        });
        
        iconBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideIcon();
            // Capture the raw selection text directly (like Google Translate does).
            // window.getSelection().toString() properly includes CSS-generated
            // whitespace between inline-block elements, unlike DOM textContent.
            const sel = window.getSelection();
            const selectionText = sel ? sel.toString().trim() : '';
            // Broadcast to the tab so the frontend script picks it up
            chrome.runtime.sendMessage({
                action: 'broadcastTab',
                params: {
                    message: { action: 'frontendScanSelectedText', params: { selectionText } }
                }
            });
        });
        
        // Specific styles for hover effect
        iconBtn.addEventListener('mouseover', () => {
            iconBtn.style.backgroundColor = '#f1f1f1';
        });
        iconBtn.addEventListener('mouseout', () => {
            iconBtn.style.backgroundColor = '#ffffff';
        });
        
        document.body.appendChild(iconBtn);
    }

    function showIcon(rect) {
        if (!iconBtn) createIcon();
        
        // Position slightly below and right of the selection's end
        const top = window.scrollY + rect.bottom + 5;
        const left = window.scrollX + rect.right - 15;
        
        iconBtn.style.top = top + 'px';
        iconBtn.style.left = left + 'px';
        iconBtn.style.display = 'flex';
        
        // Trigger reflow
        iconBtn.offsetHeight;
        iconBtn.style.opacity = '1';
    }

    function hideIcon() {
        if (iconBtn) {
            iconBtn.style.opacity = '0';
            setTimeout(() => {
                if (iconBtn && iconBtn.style.opacity === '0') {
                    iconBtn.style.display = 'none';
                }
            }, 150);
        }
    }

    document.addEventListener('mouseup', (e) => {
        // Wait a tick to let the selection settle
        setTimeout(() => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim() !== '') {
                // Ignore if the selection is inside an editable field like textarea/input
                // as the bounding rect might act weird, but it's okay for most basic usage.
                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                    hideIcon();
                    return;
                }

                try {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    
                    if (rect.width > 0 && rect.height > 0) {
                        showIcon(rect);
                        return;
                    }
                } catch (err) {
                    // Ignore range get errors
                }
            }
            hideIcon();
        }, 10);
    });

    document.addEventListener('mousedown', (e) => {
        if (iconBtn && e.target !== iconBtn && !iconBtn.contains(e.target)) {
            hideIcon();
        }
    });

    document.addEventListener('selectionchange', () => {
        // Selection change happens rapidly during drag.
        // It's usually better to just let mouseup handle it, but if selection is empty we hide.
        const selection = window.getSelection();
        if (!selection || selection.toString().trim() === '') {
            hideIcon();
        }
    });

})();
