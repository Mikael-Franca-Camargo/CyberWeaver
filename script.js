/**
 * @file Main script for the CyberWeaver application.
 * @description This file handles all client-side logic, including block creation,
 * UI interactions, theme management, drawing, and saving the workspace state.
 */

// =================================================================================
// GLOBAL STATE AND CONFIGURATION
// =================================================================================

let connections = []; // Stores { start: 'block-id-1', end: 'block-id-2' }
let connectionMode = { active: false, startBlockId: null };
const cyberpunkColors = ['#0ff', '#f0f', '#adff2f', '#f90', '#ff0080'];
let workspaceState = {
    scale: 1,
    panX: 0,
    panY: 0
};
let commandPalette = {
    isOpen: false
};
let drawingState = {
    color: '#e74c3c' // Default to red
};

document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // INITIALIZATION
    // =================================================================================

    const workspace = document.getElementById('workspace');
    const canvas = document.getElementById('connection-canvas');
    const drawingCanvas = document.getElementById('drawing-canvas');
    const ctx = canvas.getContext('2d');

    // The transformer div is a crucial wrapper that contains all pannable/zoomable
    // elements. Applying CSS transforms to this single element is more performant
    // than transforming each block and canvas individually.
    const transformer = document.createElement('div');
    transformer.id = 'workspace-transformer';
    workspace.appendChild(transformer);
    transformer.appendChild(canvas);
    transformer.appendChild(drawingCanvas);

    // Initialize collapsible sections in the sidebar
    document.querySelectorAll('#sidebar .collapsible-header').forEach(header => {
        header.addEventListener('click', function () {
            this.classList.toggle('active');
            const isExpanded = this.getAttribute('aria-expanded') === 'true';
            this.setAttribute('aria-expanded', !isExpanded);
            
            const content = this.nextElementSibling;

            // Animate the accordion by toggling max-height
            if (content.style.maxHeight) {
                content.style.maxHeight = null; // Close the content
            } else {
                content.style.maxHeight = content.scrollHeight + "px"; // Open the content
            }
        });
    });

    // Initialize main sidebar toggle functionality
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebar && sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-collapsed');
            // Trigger a resize event to force canvases to recalculate their dimensions
            window.dispatchEvent(new Event('resize'));
        });
    }

    // Initialize block creation buttons
    const addTextBtn = document.getElementById('add-text-btn');
    addTextBtn.addEventListener('click', () => createBlock('text'));

    const addImageBtn = document.getElementById('add-image-btn');
    addImageBtn.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        
        fileInput.onchange = (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (readEvent) => {
                    createBlock('image', { content: readEvent.target.result });
                };
                reader.readAsDataURL(file);
            }
        };
        fileInput.click();
    });
    // Initialize theme switching buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            document.body.className = theme ? `theme-${theme}` : '';
            // If drawing mode is active, update the color palette to match the new theme
            if (document.body.classList.contains('drawing-mode-active')) {
                renderDrawingColors();
            }
            // Redraw connection lines with the new theme's style
            drawAllConnections();
            localStorage.setItem('workspaceTheme', theme); // Save theme choice
        });
    });

    // Ensure canvases resize with the window
    function resizeCanvas() {
        canvas.width = workspace.clientWidth;
        canvas.height = workspace.clientHeight;
        drawingCanvas.width = workspace.clientWidth;
        drawingCanvas.height = workspace.clientHeight;

        drawAllConnections();
        loadDrawing();
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Load saved state from localStorage on startup
    loadLayout();
    const savedTheme = localStorage.getItem('workspaceTheme') || 'light';
    document.body.className = savedTheme ? `theme-${savedTheme}` : '';

    // Initialize the "Enable Search Glow" preference toggle
    const searchGlowToggle = document.getElementById('toggle-search-glow');
    function applySearchGlowPreference(isGlowEnabled) {
        if (isGlowEnabled) {
            document.body.classList.remove('search-glow-disabled');
        } else {
            document.body.classList.add('search-glow-disabled');
        }
    }
    const savedGlowPreference = localStorage.getItem('searchGlowEnabled') !== 'false';
    searchGlowToggle.checked = savedGlowPreference;
    applySearchGlowPreference(savedGlowPreference);
    searchGlowToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        localStorage.setItem('searchGlowEnabled', isEnabled);
        applySearchGlowPreference(isEnabled);
    });

    // Set up global listeners for the custom confirmation dialog
    const confirmOverlay = document.getElementById('custom-confirm-overlay');
    const confirmCancelBtn = document.getElementById('custom-confirm-cancel');

    let previouslyFocusedElement; // To store focus before the modal opens.

    function closeConfirm() {
        confirmOverlay.classList.add('hidden');
        // Restore focus to the element that opened the dialog for accessibility.
        if (previouslyFocusedElement) {
            previouslyFocusedElement.focus();
        }
    }

    confirmCancelBtn.addEventListener('click', closeConfirm);
    confirmOverlay.addEventListener('click', (e) => {
        if (e.target === confirmOverlay) {
            closeConfirm();
        }
    });

    // Allow closing the dialog with the Escape key
    confirmOverlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeConfirm();
        // Basic focus trapping
        if (e.key === 'Tab') {
            // More complex focus trapping logic can be added here if needed
        }
    });

    // --- Initialize New Features ---
    initializeCommandPalette();
    initializeZoomAndPan();
    initializeImageDrop();
    initializeDrawingMode();
    initializeTutorial();

});

/**
 * Announce a message to screen readers using a live region.
 * @param {string} message The message to be announced.
 */
function announce(message, replacements = {}) {
    const announcer = document.getElementById('a11y-announcer');
    if (announcer) announcer.textContent = message;
}

/**
 * Shows a custom confirmation dialog.
 * @param {string} message The message to display.
 * @param {function} onConfirm The callback function to execute if the user confirms.
 */
function showCustomConfirm(message, onConfirm) {
    const confirmOverlay = document.getElementById('custom-confirm-overlay');
    const messageP = document.getElementById('custom-confirm-message');
    const confirmOkBtn = document.getElementById('custom-confirm-ok');
    const dialog = document.getElementById('custom-confirm-dialog');

    previouslyFocusedElement = document.activeElement; // Save current focus.

    messageP.textContent = message;

    confirmOkBtn.onclick = () => {
        onConfirm();
        closeConfirm(); // Use the centralized close function.
    };
    confirmOverlay.classList.remove('hidden');
    dialog.setAttribute('aria-modal', 'true');
    confirmOkBtn.focus();
}

/**
 * Creates a new block (text or image) and adds it to the workspace.
 * @param {string} type - The type of block to create ('text' or 'image').
 * @param {object} data - Pre-existing data for the block (used when loading).
 */
function createBlock(type, data = {}) {
    const block = document.createElement('div');
    const transformer = document.getElementById('workspace-transformer');
    if (!transformer) {
        console.error("Workspace transformer not found!");
        return;
    }
    const blockId = data.id || `block-${Date.now()}`;
    const titleId = `title-${blockId}`;

    block.id = blockId;
    block.setAttribute('aria-labelledby', titleId);
    block.className = `block ${type}-block`;

    // Apply theme-specific styles upon creation
    if (document.body.classList.contains('theme-detective')) {
        const rotation = data.rotation || (Math.random() * 6 - 3);
        block.style.transform = `rotate(${rotation}deg)`;
        block.dataset.rotation = rotation;
    }
    if (document.body.classList.contains('theme-cyberpunk')) {
        const neonColor = data.color || cyberpunkColors[Math.floor(Math.random() * cyberpunkColors.length)];
        block.dataset.color = neonColor;
        block.style.setProperty('--block-neon-color', neonColor);
    }

    // Apply worldbuilding note style if it exists
    if (data.noteStyle) {
        block.classList.add(data.noteStyle);
        block.dataset.noteStyle = data.noteStyle;
    }

    // Create the block in the center of the current viewport
    const initialX = (window.innerWidth / 2 - workspaceState.panX) / workspaceState.scale;
    const initialY = (window.innerHeight / 2 - workspaceState.panY) / workspaceState.scale;

    block.style.left = data.left || `${initialX - 100}px`;
    block.style.top = data.top || `${initialY - 75}px`;
    block.style.width = data.width || '200px';
    block.style.height = data.height || '150px';
    
    let name, content;
    if (type === 'image') {
        name = data.name || 'Image';
        content = `<img src="${data.content}" alt="User image" draggable="false">`;
    } else { // Default to text
        name = data.name || 'Text Note';
        content = data.content || 'New text note. Start typing!';
    }
    
    let contentEditable = type === 'text' ? 'contenteditable="true"' : '';

    if (type === 'text') {
        block.innerHTML = `
            <div class="block-header"> 
                <span id="${titleId}" class="block-title" contenteditable="true" title="Click to rename">${name}</span>
                <div class="block-controls">
                    <button class="connect-btn" title="Connect to another block" aria-label="Create Connection">🔗</button>
                    <div class="corner-accent top-left"></div><div class="corner-accent top-right"></div><div class="corner-accent bottom-left"></div><div class="corner-accent bottom-right"></div>
                    <button class="delete-btn" title="Delete Block" aria-label="Delete Block">&times;</button>
                </div>
            </div>
            <div class="block-content" ${contentEditable}>${content}</div>
            <div class="block-footer"><div class="color-palette"></div></div>
            <div class="resize-handle"></div>
        `;
    } else { // Image block structure
        block.innerHTML = `
            <span id="${titleId}" class="block-title" contenteditable="true" title="Click to rename">${name}</span>
            <div class="block-header"></div>
            <div class="block-controls">
                <button class="connect-btn" title="Connect to another block" aria-label="Create Connection">🔗</button>
                <button class="delete-btn" title="Delete Block" aria-label="Delete Block">&times;</button>
            </div>
            <div class="block-content">${content}</div>
            <div class="block-footer"></div>
            <div class="resize-handle"></div>
        `;
    }

    transformer.appendChild(block);
    initializeBlock(block);
    announce(`${type === 'image' ? 'Image' : 'Text note'} created.`);
    saveLayout();
}

/**
 * Deletes a block from the workspace and removes any connections to it.
 * @param {string} blockId The ID of the block to delete.
 */
function deleteBlock(blockId) {
    const block = document.getElementById(blockId);
    if (block) {
        block.remove();
        announce('Note deleted.');
    }
    connections = connections.filter(conn => conn.start !== blockId && conn.end !== blockId);
    saveLayout();
    drawAllConnections();
}

/**
 * Draws a single connection line between two blocks based on their center points.
 * @param {object} conn An object like { start: 'block-id-1', end: 'block-id-2' }
 */
function drawConnection(conn) {
    const canvas = document.getElementById('connection-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const startBlock = document.getElementById(conn.start);
    const endBlock = document.getElementById(conn.end);

    if (!startBlock || !endBlock) return; // Don't draw if a block is missing

    const startX = startBlock.offsetLeft + startBlock.offsetWidth / 2;
    const startY = startBlock.offsetTop + startBlock.offsetHeight / 2;
    const endX = endBlock.offsetLeft + endBlock.offsetWidth / 2;
    const endY = endBlock.offsetTop + endBlock.offsetHeight / 2;

    /**
     * Calculates the point on a block's border that a line from its center to an
     * external point would intersect. This prevents lines from drawing "through" blocks.
     */
    function getIntersectionPoint(block, lineEndX, lineEndY) {
        const blockX = block.offsetLeft;
        const blockY = block.offsetTop;
        const blockWidth = block.offsetWidth;
        const blockHeight = block.offsetHeight;
        const centerX = blockX + blockWidth / 2;
        const centerY = blockY + blockHeight / 2;

        const dx = lineEndX - centerX;
        const dy = lineEndY - centerY;

        // This simplified algorithm finds the intersection by determining which
        // edge (top/bottom or left/right) is the "limiting" factor.
        const ratio = Math.max(Math.abs(dx) / (blockWidth / 2), Math.abs(dy) / (blockHeight / 2));
        return [centerX + dx / ratio, centerY + dy / ratio];
    }

    const startPoint = getIntersectionPoint(startBlock, endX, endY);
    const endPoint = getIntersectionPoint(endBlock, startX, startY);

    // Reset canvas context properties to avoid styles bleeding between lines
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);

    // Apply theme-specific line styles
    if (document.body.classList.contains('theme-cyberpunk')) {
        ctx.strokeStyle = '#0ff'; // Neon cyan
        ctx.lineWidth = 2;
        ctx.shadowColor = '#0ff'; // Glow color
        ctx.shadowBlur = 10;      // Glow intensity
        ctx.setLineDash([5, 10]); // Create a dashed line effect
    } else {
        ctx.strokeStyle = '#c0392b'; // Red string color for detective mode
        ctx.lineWidth = 3;
    }

    ctx.beginPath();
    ctx.moveTo(startPoint[0], startPoint[1]);
    ctx.lineTo(endPoint[0], endPoint[1]);
    ctx.stroke();
}

/**
 * Clears the connection canvas and redraws all connections.
 */
function drawAllConnections() {
    const canvas = document.getElementById('connection-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    connections.forEach(drawConnection);
}

/**
 * Deactivates connection mode and removes visual indicators.
 */
function resetConnectionMode() {
    const startBlock = document.querySelector('.connection-mode-start');
    if (startBlock) {
        startBlock.classList.remove('connection-mode-start');
    }
    const workspace = document.getElementById('workspace');
    workspace.style.cursor = 'default';
    connectionMode.active = false;
    connectionMode.startBlockId = null;
}

/**
 * Creates a connection object and adds it to the connections array if it doesn't already exist.
 * @param {string} startBlockId 
 * @param {string} endBlockId 
 */
function createConnection(startBlockId, endBlockId) {
    // Prevent duplicate connections (in either direction)
    const exists = connections.some(c =>
        (c.start === startBlockId && c.end === endBlockId) ||
        (c.start === endBlockId && c.end === startBlockId)
    );

    if (!exists) {
        connections.push({ start: startBlockId, end: endBlockId });
        announce('Connection created.');
        saveLayout();
        drawAllConnections();
    }
}

/**
 * Saves the entire workspace state (blocks, connections, drawing) to localStorage.
 */
function saveLayout() {
    const blocks = document.querySelectorAll('.block');
    const layout = Array.from(blocks).map(block => {
        return {
            id: block.id,
            type: block.classList.contains('image-block') ? 'image' : 'text',
            left: block.style.left,
            top: block.style.top,
            width: block.style.width,
            height: block.style.height,
            rotation: block.dataset.rotation || 0,
            name: block.querySelector('.block-title').innerText,
            color: block.dataset.color,
            content: block.classList.contains('image-block')
                ? block.querySelector('img').src
                : block.querySelector('.block-content').innerHTML
        };
    });

    // Consolidate all data into a single object for storage
    const webProject = {
        layout: layout,
        connections: connections
    };

    // Save the drawing canvas content
    const drawingCanvas = document.getElementById('drawing-canvas');
    if (drawingCanvas.width > 0 && drawingCanvas.height > 0) {
        if (!isCanvasBlank(drawingCanvas)) {
            try {
                localStorage.setItem('workspaceDrawing', drawingCanvas.toDataURL());
            } catch (e) { console.error("Could not save drawing canvas:", e); }
        } else {
            localStorage.removeItem('workspaceDrawing'); // Clean up if canvas is blank
        }
    }

    localStorage.setItem('workspaceLayout', JSON.stringify(webProject));
}

/**
 * Checks if a canvas is completely blank/transparent.
 * @param {HTMLCanvasElement} canvas The canvas to check.
 * @returns {boolean} True if the canvas is blank.
 */
function isCanvasBlank(canvas) {
    const context = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    return !pixelBuffer.some(pixel => pixel !== 0);
}

/**
 * Loads the entire workspace state from localStorage and recreates all elements.
 */
function loadLayout() {
    const transformer = document.getElementById('workspace-transformer');
    if (!transformer) return;
    const savedData = localStorage.getItem('workspaceLayout');

    if (savedData) {
        // Clear existing blocks, but leave the SVG layer intact
        transformer.querySelectorAll('.block').forEach(b => b.remove());
        drawAllConnections();

        const webProject = JSON.parse(savedData);

        if (webProject.layout) {
            webProject.layout.forEach(data => {
                createBlock(data.type, data);
            });
        }
        connections = webProject.connections || [];
        drawAllConnections();

        loadDrawing();
    }
}

/**
 * Loads the drawing from localStorage onto the drawing canvas.
 */
function loadDrawing() {
    const savedDrawing = localStorage.getItem('workspaceDrawing');
    const drawingCanvas = document.getElementById('drawing-canvas');
    const drawingCtx = drawingCanvas.getContext('2d');
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    if (savedDrawing) {
        const img = new Image();
        img.onload = () => {
            drawingCtx.drawImage(img, 0, 0);
        };
        img.src = savedDrawing;
    }
}

/**
 * Initializes a block with all its interactive behaviors (drag, resize, etc.).
 * @param {HTMLElement} block The block element to initialize.
 */
function initializeBlock(block) {
    const header = block.querySelector('.block-header');
    const resizeHandle = block.querySelector('.resize-handle');
    const connectBtn = block.querySelector('.connect-btn');
    const colorPalette = block.querySelector('.color-palette');
    const titleSpan = block.querySelector('.block-title');
    const deleteBtn = block.querySelector('.delete-btn');
    const blockContent = block.querySelector('.block-content');

    // For text blocks, the whole block is draggable. For image blocks,
    // only the image content itself is the drag handle.
    const dragHandle = block.classList.contains('image-block')
        ? block.querySelector('.block-content')
        : block; // For text blocks, make the whole block the drag handle

    let isDragging = false;
    let isResizing = false;
    let startX, startY, startWidth, startHeight, workspace;
    let offsetX, offsetY;

    if (dragHandle) {
        dragHandle.addEventListener('mousedown', (e) => {
            // Prevent drag from starting if the click is on an interactive element
            // within the block, like the title, content, or control buttons.
            if (block.classList.contains('text-block')) {
                if (
                    e.target.closest('.block-content') ||
                    e.target.closest('.block-title')
                ) {
                    return;
                }
            }

            isDragging = true;
            if (document.body.classList.contains('theme-detective')) block.classList.add('dragging');
            offsetX = e.clientX - block.offsetLeft;
            offsetY = e.clientY - block.offsetTop;
            document.body.classList.add('dragging-block');
            block.parentElement.querySelectorAll('.block').forEach(b => b.style.zIndex = '10');
            block.style.zIndex = '20';
        });
    }

    // --- Title editing logic ---
    if (titleSpan) {
        // Prevent line breaks when pressing Enter in the title
        titleSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleSpan.blur();
            }
        });
        titleSpan.addEventListener('blur', saveLayout);
        block.querySelector('.block-content').addEventListener('blur', saveLayout);
    }


    // Initialize the color palette buttons for Cyberpunk blocks
    if (colorPalette && document.body.classList.contains('theme-cyberpunk')) {
        cyberpunkColors.forEach(color => {
            const colorBtn = document.createElement('button');
            colorBtn.className = 'color-picker-btn';
            colorBtn.style.backgroundColor = color;
            colorBtn.dataset.color = color;
            colorBtn.title = `Set color to ${color}`;

            if (block.dataset.color === color) {
                colorBtn.classList.add('active');
            }

            colorBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent this click from triggering a drag
                const newColor = e.target.dataset.color;

                block.dataset.color = newColor;
                block.style.setProperty('--block-neon-color', newColor);

                colorPalette.querySelectorAll('.color-picker-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                saveLayout();
            });
            colorPalette.appendChild(colorBtn);
        });
    }


    if (connectBtn) {
        connectBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the header's drag from firing

            if (!connectionMode.active) {
                // --- STARTING a connection ---
                connectionMode.active = true;
                connectionMode.startBlockId = block.id;
                block.classList.add('connection-mode-start');
                document.getElementById('workspace').style.cursor = 'crosshair';
            } else {
                // --- COMPLETING a connection ---
                const endBlockId = block.id;

                // Don't connect a block to itself
                if (connectionMode.startBlockId === endBlockId) {
                    resetConnectionMode();
                    return;
                }

                createConnection(connectionMode.startBlockId, endBlockId);
                
                resetConnectionMode();
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const blockTitle = block.querySelector('.block-title').innerText;
            const confirmationMessage = `Are you sure you want to delete the note "${blockTitle}"?`;
            showCustomConfirm(confirmationMessage, () => {
                deleteBlock(block.id);
                announce(`Note titled "${blockTitle}" has been deleted.`);
            });
        });
    }

    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = block.offsetWidth;
            startHeight = block.offsetHeight;
            e.preventDefault();
        });
    }

    document.addEventListener('mousemove', (e) => {
        const workspace = document.getElementById('workspace');
        if (isDragging) {
            let newX = (e.clientX - workspaceState.panX) / workspaceState.scale - offsetX / workspaceState.scale;
            let newY = (e.clientY - workspaceState.panY) / workspaceState.scale - offsetY / workspaceState.scale;

            block.style.left = `${newX}px`;
            block.style.top = `${newY}px`;
            drawAllConnections();
        }

        if (isResizing) {
            const dx = (e.clientX - startX) / workspaceState.scale;
            const dy = (e.clientY - startY) / workspaceState.scale;

            let newWidth = startWidth + dx;
            let newHeight = startHeight + dy;

            block.style.width = `${newWidth}px`;
            block.style.height = `${newHeight}px`;
            drawAllConnections();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            block.classList.remove('dragging');
            document.body.classList.remove('dragging-block');
            saveLayout();
        }
        if (isResizing) {
            isResizing = false;
            saveLayout();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && connectionMode.active) {
            resetConnectionMode();
        }
    });
}

/**
 * Initializes and runs the tutorial for new users.
 */
function initializeTutorial() {
    const overlay = document.getElementById('tutorial-overlay');
    const popup = document.getElementById('tutorial-popup');
    const spotlight = document.getElementById('tutorial-spotlight');
    const titleEl = document.getElementById('tutorial-title');
    const contentEl = document.getElementById('tutorial-content');
    const skipBtn = document.getElementById('tutorial-skip');
    const nextBtn = document.getElementById('tutorial-next');
    const startBtn = document.getElementById('tutorial-start-btn');

    const tutorialSteps = [
        {
            target: '#add-text-btn', // Target element on the page
            title: 'Add Notes',
            content: 'Click here to add a new text note to your workspace. You can drag, resize, and edit them.'
        },
        {
            target: '#sidebar .collapsible-header',
            title: 'Change Themes',
            content: 'Customize the look and feel of your workspace by choosing a theme that fits your style.'
        },
        {
            target: '#workspace',
            title: 'Navigate the Workspace',
            content: 'Use your mouse wheel to zoom in and out. Click and drag the middle mouse button to pan around.'
        },
        {
            title: 'Open the Command Palette',
            content: 'Press Ctrl+K to open the command palette. From here, you can quickly search notes or run commands.'
        },
        {
            target: '#toggle-drawing-btn',
            title: 'Draw Freely',
            content: 'Toggle drawing mode to sketch ideas directly on your workspace. You can change colors and undo strokes.'
        }
    ];

    let currentStep = 0;

    function showStep(stepIndex) {
        if (stepIndex >= tutorialSteps.length) {
            endTutorial();
            return;
        }

        const step = tutorialSteps[stepIndex];
        titleEl.textContent = step.title;
        contentEl.textContent = step.content;

        // Position the spotlight and popup
        if (step.target) {
            const targetElement = document.querySelector(step.target);
            const rect = targetElement.getBoundingClientRect();

            spotlight.style.top = `${rect.top - 5}px`;
            spotlight.style.left = `${rect.left - 5}px`;
            spotlight.style.width = `${rect.width + 10}px`;
            spotlight.style.height = `${rect.height + 10}px`;

            // --- Improved Pop-up Positioning Logic ---
            const popupWidth = popup.offsetWidth;
            const popupHeight = popup.offsetHeight;
            const margin = 15;

            // Default position: below the target
            let popupTop = rect.bottom + margin;
            let popupLeft = rect.left;

            // If it overflows the bottom, move it above the target
            if (popupTop + popupHeight > window.innerHeight) {
                popupTop = rect.top - popupHeight - margin;
            }
            // If it overflows the right, align it to the right edge
            if (popupLeft + popupWidth > window.innerWidth) {
                popupLeft = window.innerWidth - popupWidth - margin;
            }
            // Ensure it doesn't overflow the top or left after adjustments
            popup.style.top = `${Math.max(margin, popupTop)}px`;
            popup.style.left = `${Math.max(margin, popupLeft)}px`;

        } else {
            // If no target, center everything
            spotlight.style.top = '50%';
            spotlight.style.left = '50%';
            spotlight.style.width = '0px';
            spotlight.style.height = '0px';

            popup.style.top = `calc(50% - ${popup.offsetHeight / 2}px)`;
            popup.style.left = `calc(50% - ${popup.offsetWidth / 2}px)`;
        }

        // Change button text on the last step
        if (stepIndex === tutorialSteps.length - 1) {
            nextBtn.textContent = 'Finish';
        } else {
            nextBtn.textContent = 'Next';
        }
    }

    function endTutorial() {
        overlay.classList.add('hidden');
        localStorage.setItem('tutorialCompleted', 'true');
    }

    nextBtn.addEventListener('click', () => {
        currentStep++;
        showStep(currentStep);
    });

    skipBtn.addEventListener('click', endTutorial);

    function startTutorial() {
        currentStep = 0;
        overlay.classList.remove('hidden');
        showStep(currentStep);
    }

    startBtn.addEventListener('click', startTutorial);

    // Only auto-start the tutorial if it has never been completed
    if (localStorage.getItem('tutorialCompleted') !== 'true') {
        startTutorial();
    }
}


// --- NEW FEATURE INITIALIZATION ---

/**
 * Initializes the Command Palette (Ctrl+K).
 */
function initializeCommandPalette() {
    const overlay = document.getElementById('command-palette-overlay');
    const input = document.getElementById('command-input');
    const palette = document.getElementById('command-palette');
    const list = document.getElementById('command-list');

    let previouslyFocusedElement;
    let selectedIndex = -1;

    const commands = [
        { name: 'Create New Text Note', icon: '＋', action: () => createBlock('text') },
        { name: 'Search Notes...', icon: '⌕', action: () => {
            const query = prompt('Search for:');
            if (query) {
                searchBlocks(query);
            }
        }},
        { name: 'Generate Random Idea', icon: '💡', action: () => {
            const idea = getRandomIdea();
            createBlock('text', { name: 'Random Idea', content: idea });
        }},
        { name: 'Clear Drawing', icon: '🗑️', action: () => {
            if (confirm('Are you sure you want to clear the entire drawing?')) {
                clearDrawing();
            }
        }}
    ];

    function renderCommands(filter = '') {
        list.innerHTML = '';
        const filteredCommands = commands.filter(cmd => cmd.name.toLowerCase().includes(filter.toLowerCase()));
        
        filteredCommands.forEach((cmd, index) => {
            const li = document.createElement('li');
            // Add icon and text content
            li.innerHTML = `<span class="command-icon">${cmd.icon}</span> <span class="command-name">${cmd.name}</span>`;
            li.dataset.index = index;
            li.addEventListener('click', () => {
                cmd.action();
                closePalette();
            });
            if (index === selectedIndex) li.classList.add('selected');
            list.appendChild(li);
        });
    }

    function openPalette() {
        previouslyFocusedElement = document.activeElement;
        overlay.classList.remove('hidden');
        palette.setAttribute('aria-modal', 'true');
        input.value = '';
        selectedIndex = 0; // Select the first item by default
        renderCommands();
        input.focus();
        commandPalette.isOpen = true;
    }

    function closePalette() {
        overlay.classList.add('hidden');
        commandPalette.isOpen = false;
        palette.removeAttribute('aria-modal');
        if (previouslyFocusedElement) {
            previouslyFocusedElement.focus();
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            commandPalette.isOpen ? closePalette() : openPalette();
        }
        if (e.key === 'Escape' && commandPalette.isOpen) {
            closePalette();
        }
    });

    // Add keyboard navigation to the command palette
    input.addEventListener('keydown', (e) => {
        const items = list.querySelectorAll('li');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            renderCommands(input.value);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            renderCommands(input.value);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const selectedItem = list.querySelector('.selected');
            if (selectedItem) {
                selectedItem.click(); // Trigger the action
            }
        }
    });

    input.addEventListener('input', () => renderCommands(input.value));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePalette();
    });
}

/**
 * Clears the drawing canvas and saves the empty state.
 */
function clearDrawing() {
    const drawingCanvas = document.getElementById('drawing-canvas');
    const ctx = drawingCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    saveLayout(); // This will detect the blank canvas and remove the item from storage
}

/**
 * Returns a random creative prompt from a predefined list.
 * @returns {string} A random idea.
 */
function getRandomIdea() {
    const ideas = [
        "What if gravity was a choice?",
        "Design a city that floats on clouds.",
        "A character who can talk to ghosts, but only complains about them.",
        "The last two humans on Earth meet, and they hate each other.",
        "A library where books read their stories aloud.",
        "What if plants were the dominant species?",
        "A detective who solves crimes by interpreting dreams.",
        "Reimagine a classic fairy tale in a cyberpunk setting.",
        "A world where everyone's inner monologue is audible.",
        "An ancient artifact that plays futuristic music."
    ];
    return ideas[Math.floor(Math.random() * ideas.length)];
}

/**
 * Searches all text blocks for a query and highlights matches.
 * @param {string} query The text to search for.
 */
function searchBlocks(query) {
    const allBlocks = document.querySelectorAll('.block');
    const lowerCaseQuery = query.toLowerCase();

    // First, remove any existing highlights
    allBlocks.forEach(block => block.classList.remove('search-highlight'));

    // Then, add highlight to matching blocks
    allBlocks.forEach(block => {
        if (block.classList.contains('text-block')) {
            const content = block.querySelector('.block-content').innerText.toLowerCase();
            const title = block.querySelector('.block-title').innerText.toLowerCase();
            if (content.includes(lowerCaseQuery) || title.includes(lowerCaseQuery)) {
                block.classList.add('search-highlight');
            }
        }
    });
}

/**
 * Renders the color swatches for the drawing tool based on the current theme.
 */
function renderDrawingColors() {
    const picker = document.getElementById('drawing-color-picker');
    picker.innerHTML = ''; // Clear existing swatches

    // Use a simple, universal palette of Red, Yellow, Green, Blue
    const palette = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db'];

    palette.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'drawing-color-swatch';
        swatch.style.backgroundColor = color;
        swatch.dataset.color = color;

        if (color === drawingState.color) {
            swatch.classList.add('active');
        }

        swatch.addEventListener('click', () => {
            drawingState.color = color;
            // Update active state
            picker.querySelector('.active')?.classList.remove('active');
            swatch.classList.add('active');
        });

        picker.appendChild(swatch);
    });
}

/**
 * Initializes the drawing mode functionality.
 */
function initializeDrawingMode() {
    const toggleBtn = document.getElementById('toggle-drawing-btn');
    const undoBtn = document.getElementById('undo-drawing-btn');
    const colorPicker = document.getElementById('drawing-color-picker');
    const workspace = document.getElementById('workspace');
    const drawingCanvas = document.getElementById('drawing-canvas');
    const drawingCtx = drawingCanvas.getContext('2d');
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    // Array to store the history of canvas states for undo
    let drawingHistory = [];

    function resizeDrawingCanvas() {
        drawingCanvas.width = drawingCanvas.parentElement.clientWidth;
        drawingCanvas.height = drawingCanvas.parentElement.clientHeight;
    }
    resizeDrawingCanvas();
    window.addEventListener('resize', resizeDrawingCanvas);

    function startDrawing(e) {
        // Save the canvas state *before* this new stroke begins, for the undo history.
        drawingHistory.push(drawingCanvas.toDataURL());
        isDrawing = true;
        const workspaceRect = workspace.getBoundingClientRect();
        [lastX, lastY] = [(e.clientX - workspaceRect.left - workspaceState.panX) / workspaceState.scale, (e.clientY - workspaceRect.top - workspaceState.panY) / workspaceState.scale];
    }

    function draw(e) {
        if (!isDrawing) return;
        drawingCtx.strokeStyle = drawingState.color; // Use the selected color
        drawingCtx.lineWidth = 3;
        drawingCtx.lineCap = 'round';
        drawingCtx.lineJoin = 'round';

        drawingCtx.beginPath();
        drawingCtx.moveTo(lastX, lastY);
        const workspaceRect = workspace.getBoundingClientRect();
        const currentX = (e.clientX - workspaceRect.left - workspaceState.panX) / workspaceState.scale;
        const currentY = (e.clientY - workspaceRect.top - workspaceState.panY) / workspaceState.scale;
        drawingCtx.lineTo(currentX, currentY);
        drawingCtx.stroke();
        [lastX, lastY] = [currentX, currentY]; // Update the last position
    }

    function stopDrawing() {
        if (isDrawing) {
            isDrawing = false;
            saveLayout();
        }
    }

    undoBtn.addEventListener('click', () => {
        if (drawingHistory.length > 0) {
            const lastState = drawingHistory.pop();
            const img = new Image();
            img.onload = () => {
                drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
                drawingCtx.drawImage(img, 0, 0);
            };
            img.src = lastState;
            // Save the restored state to make the undo action persistent.
            saveLayout();
        }
    });

    toggleBtn.addEventListener('click', () => {
        const isActive = document.body.classList.toggle('drawing-mode-active');

        if (isActive) {
            colorPicker.classList.remove('hidden');
            undoBtn.style.display = 'flex';
            renderDrawingColors();
            drawingCanvas.style.pointerEvents = 'auto';
            drawingCanvas.addEventListener('mousedown', startDrawing);
            drawingCanvas.addEventListener('mousemove', draw);
            drawingCanvas.addEventListener('mouseup', stopDrawing);
            drawingCanvas.addEventListener('mouseleave', stopDrawing);
        } else {
            drawingCanvas.style.pointerEvents = 'none';
            colorPicker.classList.add('hidden');
            undoBtn.style.display = 'none';
            drawingCanvas.removeEventListener('mousedown', startDrawing);
            drawingCanvas.removeEventListener('mousemove', draw);
            drawingCanvas.removeEventListener('mouseup', stopDrawing);
            drawingCanvas.removeEventListener('mouseleave', stopDrawing);
        }
    });
}

/**
 * Initializes workspace zoom and pan functionality.
 */
function initializeZoomAndPan() {
    const workspace = document.getElementById('workspace');
    const transformer = document.getElementById('workspace-transformer');
    let isPanning = false;
    let lastMouseX, lastMouseY;

    function applyTransform() {
        transformer.style.transform = `translate(${workspaceState.panX}px, ${workspaceState.panY}px) scale(${workspaceState.scale})`;
    }

    workspace.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomIntensity = 0.08;
        const oldScale = workspaceState.scale;
        
        const delta = e.deltaY > 0 ? -1 : 1;
        workspaceState.scale += delta * zoomIntensity;
        workspaceState.scale = Math.max(0.2, Math.min(workspaceState.scale, 3));

        // Adjust pan to zoom towards the mouse pointer's location
        const mouseX = e.clientX - workspace.offsetLeft;
        const mouseY = e.clientY - workspace.offsetTop;
        workspaceState.panX = mouseX - (mouseX - workspaceState.panX) * (workspaceState.scale / oldScale);
        workspaceState.panY = mouseY - (mouseY - workspaceState.panY) * (workspaceState.scale / oldScale);

        applyTransform();
        drawAllConnections();
    });

    workspace.addEventListener('mousedown', (e) => {
        // Allow panning with the middle mouse button, or with a left-click
        // on any non-interactive background element.
        const isBackgroundClick = e.target.id === 'workspace' || 
                                  e.target.id === 'workspace-transformer' || 
                                  e.target.id === 'connection-canvas';

        if (e.button === 1 || (e.button === 0 && isBackgroundClick)) {
            isPanning = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            workspace.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });

    workspace.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const dx = e.clientX - lastMouseX;
            const dy = e.clientY - lastMouseY;
            workspaceState.panX += dx;
            workspaceState.panY += dy;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            applyTransform();
            drawAllConnections();
        }
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            workspace.style.cursor = 'default';
        }
    });
}

/**
 * Initializes drag-and-drop functionality for adding images.
 */
function initializeImageDrop() {
    const workspace = document.getElementById('workspace');

    workspace.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
    });

    workspace.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const imageUrl = event.target.result;
                    createBlock('image', { content: imageUrl });
                };
                reader.readAsDataURL(file);
            }
        }
    });
}
