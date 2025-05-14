// In content.js

let currentUrl = window.location.href; // Tracked URL for comparison
let activeProcessingToken = null; // To manage concurrent stabilization attempts
let lastSentUrlTimestamp = {}; // Tracks when an update was last sent for a URL

const STABILIZATION_CHECK_INTERVAL = 300; // ms - How often to check for changes
const STABILIZATION_MIN_QUIET_PERIOD = 1200; // ms - Increased: How long data must be stable
const STABILIZATION_MAX_WAIT_TIME = 3000; // ms - Increased slightly: Max time to wait
const CONTENT_SCRIPT_SEND_COOLDOWN = 7000; // 7 seconds: Min time before re-sending for the same URL

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
            /* Default: stacked. To make them side-by-side and to the right: */
            /* flex-direction: row; */
            /* justify-content: flex-end; */ 
            gap: 10px;
            flex-direction: column; /* Keep stacked for now, common in modals */
        }
        .${FOCUS_MODAL_ID}-content button {
            width: 100%;
            padding: 10px 14px;
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
        performSend("max_wait_timeout");
    }, STABILIZATION_MAX_WAIT_TIME);

    currentToken.checkIntervalId = setInterval(() => {
        if (activeProcessingToken !== currentToken) { // Check if superseded
            clearInterval(currentToken.checkIntervalId);
            clearTimeout(currentToken.maxWaitTimeoutId);
            return;
        }

        const { signature: currentSignature } = extractPageDataForStabilization();
        const now = Date.now();

        if (currentToken.lastSignature === null || currentSignature !== currentToken.lastSignature) {
            // Data changed, or first check
            // console.log(`Content.js (ID: ${uniqueRequestId}): Data changed or first check. New Signature: ${currentSignature.substring(0,100)}`);
            currentToken.lastSignature = currentSignature;
            currentToken.lastSignatureTime = now;
        } else {
            // Data is the same as last check
            if (now - currentToken.lastSignatureTime >= STABILIZATION_MIN_QUIET_PERIOD) {
                console.log(`Content.js (ID: ${uniqueRequestId}): Data stable for ${STABILIZATION_MIN_QUIET_PERIOD}ms. Sending.`);
                performSend("stabilized");
            } else {
                // console.log(`Content.js (ID: ${uniqueRequestId}): Data stable, but quiet period not met yet.`);
            }
        }

        if (now - currentToken.startTime > STABILIZATION_MAX_WAIT_TIME + 50) { // Safety break for interval
            console.warn(`Content.js (ID: ${uniqueRequestId}): Interval running past max_wait_time. Forcibly stopping and sending.`);
            performSend("interval_safety_timeout");
        }

    }, STABILIZATION_CHECK_INTERVAL);
}

// --- How Triggers Call `initiateStabilizationAndSend` ---

// 1. Initial Load
setTimeout(() => {
    console.log("Content.js: Initial load timeout. Initiating stabilization.");
    initiateStabilizationAndSend("initial_load");
}, 300); // Short delay to ensure script is fully running

// 2. Background Request
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "REQUEST_CONTENT_UPDATE") {
        console.log(`Content.js: Received REQUEST_CONTENT_UPDATE from background. Source: ${message.sourceOfRequest}. Initiating stabilization.`);
        initiateStabilizationAndSend("background_request", { requestedBy: message.sourceOfRequest });
    } else if (message.type === "SHOW_OFF_FOCUS_MODAL") {
        console.log("Content.js: Received SHOW_OFF_FOCUS_MODAL from background. Last relevant URL:", message.lastRelevantUrl);
        showOffFocusModal(message.lastRelevantUrl);
    }
    // Not returning true, as showOffFocusModal doesn't use sendResponse directly for this message.
});

// 3. History API changes (SPAs)
// Debounce these slightly before initiating stabilization, as history events can fire rapidly.
let historyDebounceTimer = null;
const HISTORY_DEBOUNCE_DELAY = 700; // Increased slightly

function handleHistoryChange(source) {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = setTimeout(() => {
        console.log(`Content.js: ${source} detected. Initiating stabilization.`);
        initiateStabilizationAndSend(source);
    }, HISTORY_DEBOUNCE_DELAY);
}

(function(history){
    var originalPushState = history.pushState;
    history.pushState = function() {
        const result = originalPushState.apply(history, arguments);
        handleHistoryChange("history_pushState");
        return result;
    };
    var originalReplaceState = history.replaceState;
    history.replaceState = function() {
        const result = originalReplaceState.apply(history, arguments);
        handleHistoryChange("history_replaceState");
        return result;
    };
    window.addEventListener('popstate', () => handleHistoryChange("history_popstate"));
    console.log("Content.js: History API observers attached for stabilization.");
})(window.history);


// 4. MutationObserver
// The MutationObserver should also feed into `initiateStabilizationAndSend`
// It needs its own debounce before calling `initiateStabilizationAndSend` to avoid thrashing on many small mutations.
let mutationDebounceTimer = null;
const MUTATION_DEBOUNCE_DELAY = 2000; // Increased: Existing debounce for mutations

const combinedObserver = new MutationObserver((mutationsList) => {
    let significantChange = false;
    // Simplified significance check for brevity, use your more detailed one
    if (document.title !== (activeProcessingToken ? (extractPageDataForStabilization().data.title) : document.title)) { // Compare against potentially tracked title
        significantChange = true;
    }
    if (!significantChange && mutationsList.some(m => m.type === 'childList' || m.type === 'characterData')) {
        significantChange = true;
    }

    if (significantChange) {
        console.log("Content.js: MutationObserver detected change. Debouncing before initiating stabilization.");
        clearTimeout(mutationDebounceTimer);
        mutationDebounceTimer = setTimeout(() => {
            console.log("Content.js: Mutation debounce finished. Initiating stabilization.");
            initiateStabilizationAndSend("mutation_event");
        }, MUTATION_DEBOUNCE_DELAY);
    }
});

function attachMutationObservers() {
    if (document.head) {
        combinedObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    }
    if (document.body) {
        combinedObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            if (document.head) combinedObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] });
            if (document.body) combinedObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        });
    }
    console.log("Content.js: Combined MutationObserver attached for stabilization.");
}
attachMutationObservers();

// Helper to extract full data for final send
function extractPageData() {
    let bodyTextForLLM = "";
    const readabilityArticle = getReadabilityArticle(document);

    if (readabilityArticle && readabilityArticle.textContent && readabilityArticle.textContent.trim().length > 100) { // Arbitrary length check
        // console.log("Content.js: Using Readability for LLM body text.");
        bodyTextForLLM = readabilityArticle.textContent.trim();
    } else {
        // Fallback to existing main/article/body logic if Readability fails or content is too short
        // console.log("Content.js: Readability failed or content too short, falling back for LLM body text.");
        const mainElementText = document.querySelector('main')?.innerText;
        const articleElementText = document.querySelector('article')?.innerText;
        const bodyElementText = document.body?.innerText;

        if (mainElementText && mainElementText.trim().length > 100) {
            bodyTextForLLM = mainElementText.trim();
        } else if (articleElementText && articleElementText.trim().length > 100) {
            bodyTextForLLM = articleElementText.trim();
        } else {
            bodyTextForLLM = (bodyElementText || "").trim();
        }
    }

    return {
        url: window.location.href,
        title: document.title,
        metaDescription: document.querySelector('meta[name="description"]')?.content || "",
        metaKeywords: document.querySelector('meta[name="keywords"]')?.content || "",
        bodyTextSnippet: bodyTextForLLM.substring(0, 2000) // Ensure it's still truncated to a reasonable length for the backend
    };
}