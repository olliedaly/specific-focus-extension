// In content.js

let currentUrl = window.location.href; // Tracked URL for comparison
let activeProcessingToken = null; // To manage concurrent stabilization attempts
let lastSentUrlTimestamp = {}; // Tracks when an update was last sent for a URL

const STABILIZATION_CHECK_INTERVAL = 500; // ms - INCREASED for less CPU usage
const STABILIZATION_MIN_QUIET_PERIOD = 800; // ms - DECREASED for faster response
const STABILIZATION_MAX_WAIT_TIME = 2000; // ms - DECREASED for faster response
const CONTENT_SCRIPT_SEND_COOLDOWN = 5000; // 5 seconds - REDUCED for faster updates
const HISTORY_DEBOUNCE_DELAY = 400; // ms - REDUCED for faster SPA detection
const MUTATION_DEBOUNCE_DELAY = 1500; // ms - REDUCED for faster DOM change detection

// PERFORMANCE: Throttle DOM operations
let lastDOMRead = 0;
const DOM_READ_THROTTLE = 200; // ms

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

// INTELLIGENT DOM MONITORING SYSTEM
// Adaptive timing based on website characteristics

// Base timing constants (starting points)
const BASE_STABILIZATION_CHECK_INTERVAL = 300;
const BASE_STABILIZATION_MIN_QUIET_PERIOD = 600;
const BASE_STABILIZATION_MAX_WAIT_TIME = 1500;

// Adaptive timing (will be calculated per site)
let adaptiveTimings = {
    checkInterval: BASE_STABILIZATION_CHECK_INTERVAL,
    quietPeriod: BASE_STABILIZATION_MIN_QUIET_PERIOD,
    maxWait: BASE_STABILIZATION_MAX_WAIT_TIME
};

// AGGRESSIVE TIMING: Optimized for fastest off-focus detection
const WEBSITE_PATTERNS = {
    FAST_STATIC: {
        patterns: [/github\.io/, /docs\./, /wikipedia\.org/, /stackoverflow\.com/, /\.md$/, /readme/i],
        timings: { checkInterval: 150, quietPeriod: 300, maxWait: 600 }
    },
    NEWS_MEDIA: {
        patterns: [/news/, /\.com\/article/, /blog/, /medium\.com/, /\.html$/, /post\//],
        timings: { checkInterval: 200, quietPeriod: 400, maxWait: 800 }
    },
    ECOMMERCE: {
        patterns: [/shop/, /store/, /product/, /amazon\.com/, /ebay\.com/, /buy/, /cart/],
        timings: { checkInterval: 250, quietPeriod: 500, maxWait: 1200 }
    },
    SOCIAL_MEDIA: {
        patterns: [/facebook\.com/, /twitter\.com/, /linkedin\.com/, /reddit\.com/, /social/],
        timings: { checkInterval: 300, quietPeriod: 600, maxWait: 1000 }
    },
    SPA_HEAVY: {
        patterns: [/app\./, /dashboard/, /admin/, /console/, /webapp/],
        timings: { checkInterval: 200, quietPeriod: 600, maxWait: 1500 }
    }
};

// Content classification for better timing
function classifyWebsite(url, document) {
    // Check URL patterns first
    for (const [category, config] of Object.entries(WEBSITE_PATTERNS)) {
        if (config.patterns.some(pattern => pattern.test(url))) {
            console.log(`Content.js: Classified as ${category} based on URL pattern`);
            return config.timings;
        }
    }
    
    // Analyze DOM characteristics
    const hasReactRoot = document.querySelector('#root, #app, [data-reactroot]');
    const hasAngularApp = document.querySelector('[ng-app], [data-ng-app], app-root');
    const hasVueApp = document.querySelector('[data-v-]') || document.querySelector('#app')?.__vue__;
    const hasInfiniteScroll = document.querySelector('[class*="infinite"], [class*="scroll"]');
    const hasAsyncContent = document.querySelectorAll('script[src*="async"], script[async]').length > 5;
    
    // Adaptive classification based on DOM
    if (hasReactRoot || hasAngularApp || hasVueApp) {
        console.log('Content.js: Detected SPA framework, using SPA timing');
        return WEBSITE_PATTERNS.SPA_HEAVY.timings;
    }
    
    if (hasInfiniteScroll) {
        console.log('Content.js: Detected infinite scroll, using social media timing');
        return WEBSITE_PATTERNS.SOCIAL_MEDIA.timings;
    }
    
    if (hasAsyncContent) {
        console.log('Content.js: Heavy async content detected, using ecommerce timing');
        return WEBSITE_PATTERNS.ECOMMERCE.timings;
    }
    
    // Default to news/media timing
    console.log('Content.js: Using default news/media timing');
    return WEBSITE_PATTERNS.NEWS_MEDIA.timings;
}

// Enhanced content analysis - focus on what matters for focus detection
function getContentPriority(element) {
    const tagName = element.tagName?.toLowerCase();
    const className = element.className || '';
    
    // High priority content for focus analysis
    if (['h1', 'h2', 'h3'].includes(tagName)) return 3;
    if (['title', 'meta'].includes(tagName)) return 3;
    if (className.includes('title') || className.includes('heading')) return 3;
    
    // Medium priority
    if (['main', 'article', 'section'].includes(tagName)) return 2;
    if (className.includes('content') || className.includes('article')) return 2;
    
    // Low priority (ads, sidebars, etc.)
    if (className.includes('ad') || className.includes('sidebar')) return 0;
    if (className.includes('cookie') || className.includes('banner')) return 0;
    
    return 1; // Default priority
}

function extractPageDataForStabilization() {
    // PERFORMANCE: Throttle DOM reads
    const now = Date.now();
    if (now - lastDOMRead < DOM_READ_THROTTLE) {
        return { data: null, signature: null }; // Skip this read cycle
    }
    lastDOMRead = now;
    
    const data = {
        url: window.location.href,
        title: document.title,
        metaDescription: document.querySelector('meta[name="description"]')?.content || "",
    };
    
    let contentToHash = "";
    const readabilityArticle = getReadabilityArticle(document);

    if (readabilityArticle && readabilityArticle.textContent && readabilityArticle.textContent.trim().length > 50) {
        // FOCUS OPTIMIZATION: Use only first portion for faster analysis
        contentToHash = readabilityArticle.textContent.substring(0, 500); // Reduced from 1000
    } else {
        // SPEED-OPTIMIZED fallback - get key content fast
        let mainContentText = "";
        
        // Aggressive prioritized extraction for fastest analysis
        const speedSelectors = [
            'h1',                    // Most important
            'h2',                    // Second most important  
            '.title, .headline',     // Common title classes
            'main article p:first-of-type', // First paragraph in main article
            'article p:first-of-type',       // First paragraph in article
            '.content p:first-of-type',      // First paragraph in content
            'main p:first-of-type',          // First paragraph in main
            'p'                      // Any paragraph as last resort
        ];
        
        // Quick extraction - take first meaningful content found
        for (const selector of speedSelectors) {
            const element = document.querySelector(selector);
            if (element && element.innerText?.trim().length > 20) {
                mainContentText += element.innerText.trim().substring(0, 150) + ' ';
                if (mainContentText.length > 200) break; // Stop when we have enough
            }
        }
        
        // Ultra-fast fallback if nothing found
        if (mainContentText.length < 50) {
            mainContentText = (document.body?.innerText || "").substring(0, 200);
        }
        
        contentToHash = mainContentText;
    }

    const normalizedContent = contentToHash.trim().replace(/\s+/g, ' ');
    const contentHash = simpleHash(normalizedContent);
    
    // Enhanced signature includes key page elements
    const keyElementsHash = simpleHash(
        data.title + 
        data.metaDescription + 
        (document.querySelector('h1')?.innerText || '') +
        (document.querySelector('h2')?.innerText || '')
    );
    
    const signature = `${data.title}::${data.metaDescription}::${data.url}::${contentHash}::${keyElementsHash}`;
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

// SMART STABILIZATION with progressive analysis
function initiateStabilizationAndSend(source, details = {}) {
    const currentFullUrl = window.location.href;

    // Check if we recently sent an update for this exact URL from content script
    if (lastSentUrlTimestamp[currentFullUrl] && 
        (Date.now() - lastSentUrlTimestamp[currentFullUrl] < CONTENT_SCRIPT_SEND_COOLDOWN)) {
        console.log(`Content.js: URL ${currentFullUrl.substring(0,70)} in content script send cooldown. Skipping new stabilization. Source: ${source}`);
        return;
    }

    // INTELLIGENT TIMING: Adapt to website characteristics
    adaptiveTimings = classifyWebsite(currentFullUrl, document);
    console.log(`Content.js: Using adaptive timings:`, adaptiveTimings);

    const uniqueRequestId = `CJS-Stab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`Content.js (ID: ${uniqueRequestId}): Initiating SMART stabilization. Source: ${source}. URL: ${currentFullUrl}`);

    // Cancel any previous ongoing stabilization process
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
        checkIntervalId: null,
        changeCount: 0  // Track how many changes we've seen
    };
    activeProcessingToken = currentToken;

    const performSend = (reason) => {
        if (activeProcessingToken !== currentToken) {
            console.log(`Content.js (ID: ${uniqueRequestId}): Stabilization for this token was cancelled or superseded. Not sending for reason: ${reason}.`);
            return;
        }
        
        // Clean up monitoring
        clearInterval(currentToken.checkIntervalId);
        clearTimeout(currentToken.maxWaitTimeoutId);
        activeProcessingToken = null;

        const finalExtraction = extractPageData();
        sendUpdateWithExtractedData(finalExtraction, `${source}_${reason}`, details, uniqueRequestId);
        lastSentUrlTimestamp[finalExtraction.url] = Date.now();
    };

    // FAST-TRACK ANALYSIS: Send as soon as we have minimal viable content
    const checkMinimalViableContent = () => {
        if (activeProcessingToken !== currentToken) return false;
        
        const quickCheck = extractPageDataForStabilization();
        if (!quickCheck.signature || !quickCheck.data) return false;
        
        const title = quickCheck.data.title || '';
        const description = quickCheck.data.metaDescription || '';
        const url = quickCheck.data.url || '';
        
        // Criteria for "good enough" analysis - optimized for speed
        const hasMeaningfulTitle = title.split(' ').filter(w => w.length > 2).length >= 2;
        const hasDescription = description.length > 15;
        const hasContentHash = quickCheck.signature.split('::')[3]?.length > 8;
        const isKnownPattern = url.match(/\.(html|php|jsp|asp)/) || url.includes('/article/') || url.includes('/post/');
        
        // Fast-track if we have enough signals for classification
        if ((hasMeaningfulTitle && hasDescription) || 
            (hasMeaningfulTitle && hasContentHash) ||
            (hasDescription && isKnownPattern)) {
            console.log(`Content.js (ID: ${uniqueRequestId}): Minimal viable content detected. Fast-tracking analysis.`);
            performSend('FAST_TRACK_VIABLE_CONTENT');
            return true;
        }
        
        return false;
    };

    // Aggressive early analysis check - optimized for off-focus detection speed
    setTimeout(() => {
        if (activeProcessingToken === currentToken) {
            checkMinimalViableContent();
        }
    }, Math.min(adaptiveTimings.quietPeriod * 0.4, 250)); // Much more aggressive timing

    // Maximum wait timeout with adaptive timing
    currentToken.maxWaitTimeoutId = setTimeout(() => {
        console.log(`Content.js (ID: ${uniqueRequestId}): Max wait time (${adaptiveTimings.maxWait}ms) reached. Sending current data.`);
        performSend('MAX_WAIT_ADAPTIVE');
    }, adaptiveTimings.maxWait);

    const checkStability = () => {
        if (activeProcessingToken !== currentToken) {
            clearInterval(currentToken.checkIntervalId);
            return;
        }

        const extractResult = extractPageDataForStabilization();
        if (!extractResult.signature) {
            return; // Throttled, skip this check
        }
        const newSignature = extractResult.signature;

        if (newSignature !== currentToken.lastSignature) {
            currentToken.changeCount++;
            currentToken.lastSignature = newSignature;
            currentToken.lastSignatureTime = Date.now();
            
            // ADAPTIVE BEHAVIOR: If content is changing rapidly, extend quiet period slightly
            if (currentToken.changeCount > 5) {
                const extendedQuietPeriod = Math.min(adaptiveTimings.quietPeriod * 1.3, 1500);
                console.log(`Content.js (ID: ${uniqueRequestId}): Rapid changes detected (${currentToken.changeCount}), extending quiet period to ${extendedQuietPeriod}ms`);
                adaptiveTimings.quietPeriod = extendedQuietPeriod;
            }
        } else {
            const quietDuration = Date.now() - currentToken.lastSignatureTime;
                         if (quietDuration >= adaptiveTimings.quietPeriod) {
                 console.log(`Content.js (ID: ${uniqueRequestId}): Content stable for ${quietDuration}ms (required: ${adaptiveTimings.quietPeriod}ms). Sending single analysis.`);
                 performSend('STABLE_ADAPTIVE');
             }
        }

        // Safety break for interval
        if (Date.now() - currentToken.startTime > adaptiveTimings.maxWait + adaptiveTimings.checkInterval * 2) {
            console.warn(`Content.js (ID: ${uniqueRequestId}): Interval overran max_wait_time. Clearing for ${currentToken.id}.`);
            clearInterval(currentToken.checkIntervalId);
        }
    };

    // Initial signature setup
    const initialExtract = extractPageDataForStabilization();
    currentToken.lastSignature = initialExtract.signature;
    currentToken.lastSignatureTime = Date.now();

    // Start monitoring with adaptive interval
    currentToken.checkIntervalId = setInterval(checkStability, adaptiveTimings.checkInterval);
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