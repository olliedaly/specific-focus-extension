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
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            z-index: 2147483647; /* Max z-index */
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: Arial, sans-serif;
        }
        .${FOCUS_MODAL_ID}-content {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 450px;
            width: 90%;
        }
        .${FOCUS_MODAL_ID}-content h2 {
            margin-top: 0;
            color: #333;
            font-size: 22px;
        }
        .${FOCUS_MODAL_ID}-content p {
            color: #555;
            font-size: 16px;
            margin: 15px 0;
        }
        .${FOCUS_MODAL_ID}-content .quote {
            font-style: italic;
            color: #777;
            margin-bottom: 25px;
            font-size: 15px;
        }
        .${FOCUS_MODAL_ID}-content button {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin: 5px;
            transition: background-color 0.3s ease;
        }
        .${FOCUS_MODAL_ID}-dismiss-btn {
            background-color: #f44336;
            color: white;
        }
        .${FOCUS_MODAL_ID}-dismiss-btn:hover {
            background-color: #d32f2f;
        }
        .${FOCUS_MODAL_ID}-whitelist-btn {
            background-color: #4CAF50;
            color: white;
        }
        .${FOCUS_MODAL_ID}-whitelist-btn:hover {
            background-color: #388E3C;
        }
        .${FOCUS_MODAL_ID}-goback-btn {
            background-color: #007bff;
            color: white;
        }
        .${FOCUS_MODAL_ID}-goback-btn:hover {
            background-color: #0056b3;
        }
    `;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
}

function removeOffFocusModal() {
    const existingModal = document.getElementById(FOCUS_MODAL_ID);
    if (existingModal) {
        existingModal.remove();
    }
}

function showOffFocusModal(lastRelevantUrl) {
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
    document.body.appendChild(overlay);
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