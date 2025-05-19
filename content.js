// In content.js

let currentUrl = window.location.href; // Tracked URL for comparison
let activeProcessingToken = null; // To manage concurrent stabilization attempts
let lastSentUrlTimestamp = {}; // Tracks when an update was last sent for a URL

const STABILIZATION_CHECK_INTERVAL = 300; // ms - How often to check for changes
const STABILIZATION_MIN_QUIET_PERIOD = 1200; // ms - Increased: How long data must be stable
const STABILIZATION_MAX_WAIT_TIME = 3000; // ms - Increased slightly: Max time to wait
const CONTENT_SCRIPT_SEND_COOLDOWN = 7000; // 7 seconds: Min time before re-sending for the same URL
const HISTORY_DEBOUNCE_DELAY = 700; // ms
const MUTATION_DEBOUNCE_DELAY = 2000; // ms

const FOCUS_MODAL_ID = 'focus-monitor-pro-modal-overlay';

const focusQuotes = [
    "The successful warrior is the average man, with laser-like focus. - Bruce Lee",
    "Concentrate all your thoughts upon the work at hand. The sun's rays do not burn until brought to a focus. - Alexander Graham Bell",
    "Focus on being productive instead of busy. - Tim Ferriss",
    "The key to success is to focus our conscious mind on things we desire not things we fear. - Brian Tracy",
    "Stay focused, go after your dreams and keep moving toward your goals. - LL Cool J"
];

console.log("Content.js (Observe-Stabilize-Timeout): Script loaded for URL:", window.location.href);

function injectModalStyles() {
    const styleId = 'focus-monitor-pro-styles';
    if (document.getElementById(styleId)) return;

    const css = `
        #${FOCUS_MODAL_ID} {
            /* Raindrop.io Inspired - Earthy/Neutral Tones */
            --rui-bg-primary: #F7F5F2;
            --rui-bg-card: #FFFFFF;
            --rui-bg-input: #FFFFFF;
            --rui-text-primary: #3A2F28;
            --rui-text-secondary: #7A6B60;
            --rui-accent-green: #6A8A7B;
            --rui-accent-green-hover: #597567;
            --rui-accent-green-text: #FFFFFF;
            --rui-focus-green: rgba(106, 138, 123, 0.25);
            --rui-accent-danger: #D47E64;
            --rui-accent-danger-hover: #BF6A51;
            --rui-accent-danger-text: #FFFFFF;
            --rui-focus-danger: rgba(212, 126, 100, 0.3);
            --rui-border-primary: #E0D8CF;
            --rui-border-input: #C9BFB6;
            --rui-border-input-focus: var(--rui-accent-green);
            --font-family-main: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            --border-radius-sm: 0.25rem; /* 4px */
            --border-radius-md: 0.375rem; /* 6px */
            --shadow-subtle: 0 2px 4px rgba(74, 59, 49, 0.06);
            --shadow-strong: 0 4px 12px rgba(74, 59, 49, 0.12);
            --transition-common: 0.2s ease-in-out;

            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: rgba(58, 47, 40, 0.6); /* Darker brown overlay, more opacity */
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            z-index: 2147483647;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: var(--font-family-main);
            opacity: 0;
            visibility: hidden;
            transition: opacity var(--transition-common), visibility 0s linear var(--transition-common);
        }
        #${FOCUS_MODAL_ID}.visible {
            opacity: 1;
            visibility: visible;
            transition: opacity var(--transition-common), visibility 0s linear 0s;
        }
        .${FOCUS_MODAL_ID}-content {
            background-color: var(--rui-bg-card);
            padding: 20px 24px;
            border-radius: var(--border-radius-md);
            box-shadow: var(--shadow-strong);
            text-align: left; /* Align text to left for content */
            max-width: 420px; /* Raindrop modals are often not too wide */
            width: 90%;
            border: 1px solid var(--rui-border-primary);
            transform: scale(0.95) translateY(10px);
            transition: transform var(--transition-common) cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity var(--transition-common);
        }
        #${FOCUS_MODAL_ID}.visible .${FOCUS_MODAL_ID}-content {
            transform: scale(1) translateY(0);
            opacity: 1;
        }
        .${FOCUS_MODAL_ID}-content h2 {
            margin-top: 0;
            color: var(--rui-text-primary);
            font-size: 1.125rem; /* 18px */
            font-weight: 600;
            margin-bottom: 8px;
        }
        .${FOCUS_MODAL_ID}-content p {
            color: var(--rui-text-secondary);
            font-size: 0.875rem; /* 14px */
            line-height: 1.6;
            margin: 0 0 16px 0;
        }
        .${FOCUS_MODAL_ID}-content .quote {
            font-style: italic;
            color: var(--rui-text-secondary);
            margin: 16px 0;
            font-size: 0.875rem;
            padding: 10px 12px;
            background-color: var(--rui-bg-primary);
            border-left: 3px solid var(--rui-accent-green);
            border-radius: 0 var(--border-radius-sm) var(--border-radius-sm) 0;
        }
        .${FOCUS_MODAL_ID}-content .button-container {
            margin-top: 20px;
            display: flex;
            flex-direction: row; /* Buttons side-by-side */
            justify-content: flex-end; /* Align to right */
            gap: 10px;
        }
        .${FOCUS_MODAL_ID}-content button {
            /* width: 100%; REMOVED - let buttons size naturally with padding and min-width */
            padding: 10px 18px; /* Increased padding for better touch/click area and text visibility */
            min-width: 100px; /* Increased min-width */
            border: 1px solid transparent;
            border-radius: var(--border-radius-sm);
            cursor: pointer;
            font-weight: 500;
            font-size: 0.9rem;
            transition: background-color var(--transition-common), border-color var(--transition-common), color var(--transition-common), transform 0.1s ease;
            text-align: center;
        }
        .${FOCUS_MODAL_ID}-content button:active {
            transform: scale(0.98);
        }
        .${FOCUS_MODAL_ID}-dismiss-btn {
            background-color: var(--rui-bg-input); /* More subtle dismiss */
            border-color: var(--rui-border-input);
            color: var(--rui-text-secondary);
        }
        .${FOCUS_MODAL_ID}-dismiss-btn:hover {
            background-color: var(--rui-border-primary);
            color: var(--rui-text-primary);
        }
        .${FOCUS_MODAL_ID}-whitelist-btn {
            background-color: var(--rui-accent-green);
            border-color: var(--rui-accent-green);
            color: var(--rui-accent-green-text);
        }
        .${FOCUS_MODAL_ID}-whitelist-btn:hover {
            background-color: var(--rui-accent-green-hover);
            border-color: var(--rui-accent-green-hover);
        }
        .${FOCUS_MODAL_ID}-goback-btn {
            background-color: var(--rui-bg-input); /* More subtle */
            border-color: var(--rui-border-input);
            color: var(--rui-text-secondary);
        }
        .${FOCUS_MODAL_ID}-goback-btn:hover {
            background-color: var(--rui-border-primary);
            color: var(--rui-text-primary);
        }
        .${FOCUS_MODAL_ID}-close-btn {
            position: absolute;
            top: 12px; /* Equidistant */
            right: 12px; /* Equidistant */
            background: none;
            border: none;
            font-size: 1.5rem; /* Increased size for better clickability */
            color: var(--rui-text-secondary);
            cursor: pointer;
            padding: 4px; /* Added padding for easier clicking */
            line-height: 1; /* Ensure X is centered if it's text */
            z-index: 10; /* Ensure it's above other modal content if absolutely positioned */
        }
        .${FOCUS_MODAL_ID}-close-btn:hover {
            color: var(--rui-text-primary);
        }
    `;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);

    // Trigger fade-in animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { // Double requestAnimationFrame for some browsers
            overlay.classList.add('visible');
        });
    });
}

function removeOffFocusModal() {
    const existingModal = document.getElementById(FOCUS_MODAL_ID);
    if (existingModal) {
        console.log("Content.js: Removing existing off-focus modal.");
        existingModal.remove();
    }
}

function showOffFocusModal(lastRelevantUrl) {
    console.log("Content.js: showOffFocusModal called. lastRelevantUrl:", lastRelevantUrl);
    removeOffFocusModal(); // Remove any existing modal first

    const overlay = document.createElement('div');
    overlay.id = FOCUS_MODAL_ID;

    const modalContent = document.createElement('div');
    modalContent.className = `${FOCUS_MODAL_ID}-content`;

    // Add the close button to the Off Focus Modal as well, for consistency
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;'; // 'X' character
    closeButton.className = `${FOCUS_MODAL_ID}-close-btn`;
    closeButton.onclick = () => removeOffFocusModal();
    modalContent.appendChild(closeButton);

    const title = document.createElement('h2');
    title.textContent = "You seem to be off focus!";

    const randomQuote = focusQuotes[Math.floor(Math.random() * focusQuotes.length)];
    const quoteElement = document.createElement('p');
    quoteElement.className = 'quote';
    quoteElement.textContent = randomQuote;

    const buttonContainer = document.createElement('div'); // Container for buttons
    buttonContainer.className = 'button-container'; // Add class for styling

    if (lastRelevantUrl && typeof lastRelevantUrl === 'string' && lastRelevantUrl.trim() !== '') {
        const goBackButton = document.createElement('button');
        goBackButton.className = `${FOCUS_MODAL_ID}-goback-btn`;
        goBackButton.textContent = "Go Back to Focus";
        goBackButton.onclick = () => {
            removeOffFocusModal(); // Remove modal before navigation
            window.location.href = lastRelevantUrl;
        };
        buttonContainer.appendChild(goBackButton);
    }

    const dismissButton = document.createElement('button');
    dismissButton.className = `${FOCUS_MODAL_ID}-dismiss-btn`;
    dismissButton.textContent = "Dismiss";
    dismissButton.onclick = () => removeOffFocusModal();

    const whitelistButton = document.createElement('button');
    whitelistButton.className = `${FOCUS_MODAL_ID}-whitelist-btn`;
    whitelistButton.textContent = "Add this page to focus";
    whitelistButton.onclick = () => {
        chrome.runtime.sendMessage({ type: "ADD_TO_WHITELIST", url: window.location.href })
            .then(response => console.log("Content.js: ADD_TO_WHITELIST sent, response:", response))
            .catch(error => console.warn("Content.js: Error sending ADD_TO_WHITELIST:", error.message));
        removeOffFocusModal();
    };

    modalContent.appendChild(title);
    modalContent.appendChild(quoteElement);
    modalContent.appendChild(buttonContainer); // Add button container
    buttonContainer.appendChild(dismissButton); // Add buttons to container
    buttonContainer.appendChild(whitelistButton);

    overlay.appendChild(modalContent);
    console.log("Content.js: Modal HTML constructed, attempting to append to body.");
    try {
        document.body.appendChild(overlay);
        console.log("Content.js: Modal appended to body.");
    } catch (e) {
        console.error("Content.js: Error appending modal to body:", e);
        return; // Stop if appending failed
    }

    // Trigger fade-in animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { // Double requestAnimationFrame for some browsers
            overlay.classList.add('visible');
        });
    });
}

// Function to create a common modal structure
function createBaseModal() {
    removeOffFocusModal(); // Clear any existing modal

    const overlay = document.createElement('div');
    overlay.id = FOCUS_MODAL_ID;

    const modalContent = document.createElement('div');
    modalContent.className = `${FOCUS_MODAL_ID}-content`;

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;'; // 'X' character
    closeButton.className = `${FOCUS_MODAL_ID}-close-btn`;
    closeButton.onclick = () => removeOffFocusModal();
    modalContent.appendChild(closeButton);

    overlay.appendChild(modalContent);
    return { overlay, modalContent };
}

function showPomodoroBreakModal(breakDuration) {
    console.log(`Content.js: showPomodoroBreakModal called. Duration: ${breakDuration} min`);
    const { overlay, modalContent } = createBaseModal();

    const title = document.createElement('h2');
    title.textContent = "Focus Period Complete!";

    const message = document.createElement('p');
    message.textContent = `Time for a ${breakDuration}-minute break. Relax and recharge!`;

    modalContent.appendChild(title);
    modalContent.appendChild(message);

    // No buttons needed other than the close 'X'

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });
    });
}

function showPomodoroWorkModal() {
    console.log("Content.js: showPomodoroWorkModal called.");
    const { overlay, modalContent } = createBaseModal();

    const title = document.createElement('h2');
    title.textContent = "Break's Over!";

    const message = document.createElement('p');
    message.textContent = "Time to focus. Let's get started on your work session!";

    modalContent.appendChild(title);
    modalContent.appendChild(message);

    // No buttons needed other than the close 'X'

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });
    });
}

// Call injectModalStyles once when the script loads
injectModalStyles();

// Helper function to run Readability.js
// Ensure Readability.js is loaded via manifest.json before this script
function getReadabilityArticle(doc) {
    if (typeof Readability === 'undefined') {
        console.warn("Content.js: Readability library not found. Ensure it is loaded.");
        return null;
    }
    try {
        // Cloning the document is safer as Readability can mutate the DOM
        const documentClone = doc.cloneNode(true);
        const reader = new Readability(documentClone, { /* pass options here if needed */ });
        const article = reader.parse(); // article can be null
        return article;
    } catch (e) {
        console.warn("Content.js: Error running Readability.js:", e);
        return null;
    }
}

// Simple hash function for a string
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(16);
}

function extractPageDataForStabilization() {
    const data = {
        url: window.location.href,
        title: document.title,
        metaDescription: document.querySelector('meta[name="description"]')?.content || "",
    };
    
    let contentToHash = "";
    const readabilityArticle = getReadabilityArticle(document);

    if (readabilityArticle && readabilityArticle.textContent && readabilityArticle.textContent.trim().length > 50) { // Arbitrary length check
        // console.log("Content.js: Using Readability for signature content.");
        contentToHash = readabilityArticle.textContent.substring(0, 1000); // Use a longer snippet from Readability for hashing
    } else {
        // Fallback to existing main/article/body logic if Readability fails or content is too short
        // console.log("Content.js: Readability failed or content too short, falling back for signature.");
        let mainContentText = "";
        const mainElement = document.querySelector('main');
        if (mainElement) {
            mainContentText = (mainElement.innerText || "").substring(0, 500);
        } else {
            const articleElement = document.querySelector('article');
            if (articleElement) {
                mainContentText = (articleElement.innerText || "").substring(0, 500);
            } else {
                mainContentText = (document.body?.innerText || "").substring(0, 300);
            }
        }
        contentToHash = mainContentText;
    }

    const normalizedContent = contentToHash.trim().replace(/\s+/g, ' ');
    const contentHash = simpleHash(normalizedContent);
    
    const signature = `${data.title}::${data.metaDescription}::${data.url}::${contentHash}`;
    // console.log(`Content.js: Stabilization Signature: ${signature}`); 
    return { data, signature }; 
}

function extractPageData() {
    const data = {
        url: window.location.href,
        title: document.title,
        metaDescription: document.querySelector('meta[name="description"]')?.content || "",
        pageText: "",
        htmlContent: ""
    };

    const readabilityArticle = getReadabilityArticle(document);

    if (readabilityArticle && readabilityArticle.textContent) {
        data.pageText = readabilityArticle.textContent.trim();
        data.htmlContent = readabilityArticle.content || ""; // Full article HTML
    } else {
        data.pageText = (document.body?.innerText || "").trim();
        data.htmlContent = (document.body?.innerHTML || "").substring(0, 10000); // Snippet to avoid being too large
    }
    // console.log("Content.js: Final extracted data:", { ...data, pageText: data.pageText.substring(0,100), htmlContent: data.htmlContent.substring(0,100) });
    return data;
}

function sendUpdateWithExtractedData(pageData, source, details, uniqueRequestId) {
    // This function actually sends the message
    console.log(`%cContent.js (ID: ${uniqueRequestId}): FINAL SEND. Source: ${source}. URL: ${pageData.url}. Title: ${pageData.title.substring(0,50)}. Details: ${JSON.stringify(details).substring(0,100)}`, "color: green;");
    chrome.runtime.sendMessage({
        type: "CONTENT_UPDATED",
        data: pageData, // This should include the body snippet taken at send time
        triggeringSource: source,
        contentJsRequestId: uniqueRequestId,
        triggeringDetails: details
    }).catch(error => {
        console.warn(`Content.js (ID: ${uniqueRequestId}): Error sending message: ${error.message}`);
    });
}

function initiateStabilizationAndSend(source, details = {}) {
    const currentFullUrl = window.location.href;

    // Check if we recently sent an update for this exact URL from content script
    if (lastSentUrlTimestamp[currentFullUrl] && 
        (Date.now() - lastSentUrlTimestamp[currentFullUrl] < CONTENT_SCRIPT_SEND_COOLDOWN)) {
        console.log(`Content.js: URL ${currentFullUrl.substring(0,70)} in content script send cooldown. Skipping new stabilization. Source: ${source}`);
        return;
    }

    const uniqueRequestId = `CJS-Stab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`Content.js (ID: ${uniqueRequestId}): Initiating stabilization. Source: ${source}. URL: ${currentFullUrl}`);

    // Cancel any previous ongoing stabilization process for this content script instance
    if (activeProcessingToken) {
        clearTimeout(activeProcessingToken.maxWaitTimeoutId);
        clearInterval(activeProcessingToken.checkIntervalId);
        console.log(`Content.js (ID: ${uniqueRequestId}): Cancelled previous stabilization (Token: ${activeProcessingToken.id})`);
    }
    
    const currentToken = {
        id: uniqueRequestId,
        startTime: Date.now(),
        lastSignature: null,
        lastSignatureTime: Date.now(),
        maxWaitTimeoutId: null,
        checkIntervalId: null
    };
    activeProcessingToken = currentToken;

    const performSend = (reason) => {
        if (activeProcessingToken !== currentToken) {
            console.log(`Content.js (ID: ${uniqueRequestId}): Stabilization for this token was cancelled or superseded. Not sending for reason: ${reason}.`);
            return; // This attempt was superseded
        }
        clearInterval(currentToken.checkIntervalId); // Stop interval checks
        clearTimeout(currentToken.maxWaitTimeoutId); // Stop max wait timeout

        const finalExtraction = extractPageData(); // Extract full data, including body, just before sending
        sendUpdateWithExtractedData(finalExtraction, `${source}_${reason}`, details, uniqueRequestId);
        activeProcessingToken = null; // Clear the active token
        lastSentUrlTimestamp[finalExtraction.url] = Date.now(); // Record send time for this URL
    };

    currentToken.maxWaitTimeoutId = setTimeout(() => {
        console.log(`Content.js (ID: ${uniqueRequestId}): Max wait time (${STABILIZATION_MAX_WAIT_TIME}ms) reached. Sending current data.`);
        performSend('MAX_WAIT');
    }, STABILIZATION_MAX_WAIT_TIME);

    const checkStability = () => {
        if (activeProcessingToken !== currentToken) {
            clearInterval(currentToken.checkIntervalId);
            // console.log(`Content.js (ID: ${uniqueRequestId}): Stability check for token ${currentToken.id} was cancelled or superseded.`);
            return;
        }

        const { signature: newSignature } = extractPageDataForStabilization();

        if (newSignature !== currentToken.lastSignature) {
            // console.log(`Content.js (ID: ${uniqueRequestId}): Content changed. Resetting quiet period. Old: ${currentToken.lastSignature}, New: ${newSignature}`);
            currentToken.lastSignature = newSignature;
            currentToken.lastSignatureTime = Date.now();
        } else {
            const quietDuration = Date.now() - currentToken.lastSignatureTime;
            if (quietDuration >= STABILIZATION_MIN_QUIET_PERIOD) {
                console.log(`Content.js (ID: ${uniqueRequestId}): Content stable for ${quietDuration}ms. Sending.`);
                performSend('STABLE');
            } else {
                // console.log(`Content.js (ID: ${uniqueRequestId}): Content stable, but quiet period not met (${quietDuration}ms / ${STABILIZATION_MIN_QUIET_PERIOD}ms).`);
            }
        }

        // Safety break for interval, in case maxWaitTimeoutId failed to clear it
        if (Date.now() - currentToken.startTime > STABILIZATION_MAX_WAIT_TIME + STABILIZATION_CHECK_INTERVAL * 2) {
            console.warn(`Content.js (ID: ${uniqueRequestId}): Interval seems to have overran max_wait_time significantly. Clearing for ${currentToken.id}.`);
            clearInterval(currentToken.checkIntervalId);
            if (activeProcessingToken === currentToken) { // If it hasn't already sent via MAX_WAIT
                 // performSend('INTERVAL_TIMEOUT_SAFETY'); // This might cause double send if MAX_WAIT is about to fire.
            }
        }
    };

    // Initial signature setup
    const { signature: initialSignature } = extractPageDataForStabilization();
    currentToken.lastSignature = initialSignature;
    currentToken.lastSignatureTime = Date.now();
    // console.log(`Content.js (ID: ${uniqueRequestId}): Initial signature for token ${currentToken.id}: ${initialSignature}`);

    currentToken.checkIntervalId = setInterval(checkStability, STABILIZATION_CHECK_INTERVAL);
    // Initial check, slight delay to allow first signature to be set if page is extremely fast.
    // setTimeout(checkStability, 50); // Or just rely on the first interval tick.
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SHOW_OFF_FOCUS_MODAL") {
        console.log("Content.js: Received SHOW_OFF_FOCUS_MODAL, lastRelevantUrl:", message.lastRelevantUrl);
        showOffFocusModal(message.lastRelevantUrl);
    } else if (message.type === "REQUEST_CONTENT_UPDATE") {
        console.log(`Content.js: Received REQUEST_CONTENT_UPDATE from background. Source: ${message.sourceOfRequest}. Current URL: ${window.location.href}`);
        initiateStabilizationAndSend(`REQUEST_CONTENT_FROM_BG_VIA_${message.sourceOfRequest || 'UNKNOWN'}`);
    } else if (message.type === "SHOW_POMODORO_BREAK_MODAL") {
        console.log("Content.js: Received SHOW_POMODORO_BREAK_MODAL, duration:", message.breakDuration);
        showPomodoroBreakModal(message.breakDuration);
    } else if (message.type === "SHOW_POMODORO_WORK_MODAL") {
        console.log("Content.js: Received SHOW_POMODORO_WORK_MODAL");
        showPomodoroWorkModal();
    }
    return false; 
});

// Debounce utility
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// Function to handle page navigation or load
function handlePageNavigationOrLoad(source) {
    console.log(`Content.js: handlePageNavigationOrLoad triggered by: ${source}. Current URL: ${window.location.href}`);
    if (currentUrl !== window.location.href || source === "DOMContentLoaded" || source === "MUTATION_CONTENT_MAIN_CHANGE") {
        console.log(`Content.js: URL changed or significant event. Old: ${currentUrl}, New: ${window.location.href}. Source: ${source}`);
        currentUrl = window.location.href; // Update tracked URL
        initiateStabilizationAndSend(source, { newUrl: currentUrl });
    } else {
        console.log(`Content.js: URL unchanged, minor event. Not re-initiating full stabilization. URL: ${currentUrl}. Source: ${source}`);
    }
}

const debouncedProcessForHistory = debounce(() => handlePageNavigationOrLoad("HISTORY_STATE_CHANGED"), HISTORY_DEBOUNCE_DELAY);
const debouncedProcessForMutation = debounce(() => handlePageNavigationOrLoad("MUTATION_CONTENT_MAIN_CHANGE"), MUTATION_DEBOUNCE_DELAY);


// Listen for DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => handlePageNavigationOrLoad("DOMContentLoaded"));
} else {
    // DOMContentLoaded has already fired
    handlePageNavigationOrLoad("DOMContentLoaded_ALREADY_FIRED");
}

// Listen for history changes (SPA navigations)
window.addEventListener('popstate', () => {
    console.log("Content.js: popstate event");
    debouncedProcessForHistory();
});

// Wrap pushState and replaceState to detect SPA navigations
const originalPushState = history.pushState;
history.pushState = function(...args) {
    console.log("Content.js: pushState called");
    originalPushState.apply(this, args);
    debouncedProcessForHistory();
};

const originalReplaceState = history.replaceState;
history.replaceState = function(...args) {
    console.log("Content.js: replaceState called");
    originalReplaceState.apply(this, args);
    debouncedProcessForHistory();
};

// MutationObserver to detect dynamic content changes
let mutationObserver = null;
function setupMutationObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
    }
    
    const targetNode = document.body;
    if (!targetNode) {
        console.warn("Content.js: document.body not found for MutationObserver. Will retry.");
        setTimeout(setupMutationObserver, 500); // Retry if body not yet available
        return;
    }

    const config = { childList: true, subtree: true, characterData: true };
    let lastObservedTitle = document.title;

    mutationObserver = new MutationObserver((mutationsList, observer) => {
        // More sophisticated check:
        // 1. Check if title changed significantly
        // 2. Check if <main> or <article> content changed substantially (more than just minor text tweaks)
        // For now, a simple heuristic: if title changes, or if there are significant additions/removals.
        
        if (document.title !== lastObservedTitle) {
            console.log("Content.js: MutationObserver - Title changed.");
            lastObservedTitle = document.title;
            debouncedProcessForMutation(); // Title change is a strong signal
            return;
        }

        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                 // Heuristic: if many nodes added/removed, or a significant node (like main/article) changes.
                 // This can be refined to check the 'significance' of the change.
                const isSignificantChange = Array.from(mutation.addedNodes).some(node => node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'MAIN' || node.tagName === 'ARTICLE' || node.contains(document.querySelector('h1, h2, article, main')))) ||
                                          Array.from(mutation.removedNodes).some(node => node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'MAIN' || node.tagName === 'ARTICLE'));

                if (isSignificantChange || mutation.target === document.body || document.main?.contains(mutation.target)) {
                     console.log("Content.js: MutationObserver - Significant childList change detected.");
                     debouncedProcessForMutation();
                     return; // Process once per batch of mutations
                }
            }
            // Could add characterData check here too, but can be very noisy.
            // if (mutation.type === 'characterData') { ... }
        }
    });

    try {
        mutationObserver.observe(targetNode, config);
        console.log("Content.js: MutationObserver is now observing the document body.");
    } catch (e) {
        console.error("Content.js: Error starting MutationObserver:", e);
    }
}

// Initial setup for MutationObserver
// Delay slightly to ensure body is fully available and reduce noise from initial rendering.
setTimeout(setupMutationObserver, 1000);

// Initial call to process the page when the script is first injected.
// Wrapped in a small timeout to allow the page to settle a bit from initial load.
setTimeout(() => {
    handlePageNavigationOrLoad("INITIAL_LOAD_TIMEOUT");
}, 500);