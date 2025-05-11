const BACKEND_URL = "http://localhost:5001/classify";
let currentSessionFocus = null;
let lastProcessedUrlTimestamp = {};
const PROCESS_COOLDOWN = 3000; // ms
let currentlyProcessingUrl = {};
const FOCUS_WHITELIST_KEY = 'focusWhitelist';
const LAST_RELEVANT_URL_KEY = 'lastRelevantUrlForFocus';
let lastRelevantUrl = null;

const STICKY_RELEVANT_DURATION = 7000; // 7 seconds
let recentAssessmentsCache = {}; // In-memory cache: { url: { assessment: "Relevant", timestamp: Date.now() } }

console.log("Background.js: Script loaded/reloaded. Initializing...");

// Load initial lastRelevantUrl from storage
chrome.storage.local.get(LAST_RELEVANT_URL_KEY, (result) => {
    if (result[LAST_RELEVANT_URL_KEY]) {
        lastRelevantUrl = result[LAST_RELEVANT_URL_KEY];
        console.log("Background: Loaded lastRelevantUrl on init:", lastRelevantUrl);
    }
});

chrome.storage.local.get('sessionFocus', (result) => {
    if (result.sessionFocus) {
        currentSessionFocus = result.sessionFocus;
        console.log("Background: Session focus loaded on init:", currentSessionFocus);
    } else {
        console.log("Background: No session focus found on init.");
        // Ensure default icon is set if no focus
        try {
            chrome.action.setIcon({ path: "icons/icon48.png" });
        } catch (e) {
            console.error("Background.js: Error setting default icon on init:", e);
        }
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.sessionFocus) {
        currentSessionFocus = changes.sessionFocus.newValue;
        console.log("Background: Session focus changed via storage to:", currentSessionFocus);
        if (!currentSessionFocus) {
            console.log("Background: Session ended. Resetting icon and clearing processed URL cache.");
            try {
                chrome.action.setIcon({ path: "icons/icon48.png" });
            } catch (e) {
                console.error("Background.js: Error setting icon on session end:", e);
            }
            lastProcessedUrlTimestamp = {};
            currentlyProcessingUrl = {};
        } else {
            console.log("Background: Session started or focus changed. Triggering analysis for current tab.");
            triggerCurrentTabAnalysis("SESSION_RESTARTED_OR_FOCUS_CHANGED");
        }
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        const sourceDetail = `tabs.onUpdated_status_complete (tabId: ${tabId})`;
        console.log(`Background: Event - ${sourceDetail} for ${tab.url}`);
        handlePotentialNavigation(tabId, tab.url, tab.title, sourceDetail);
    }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId === 0 && details.url && (details.url.startsWith('http://') || details.url.startsWith('https://'))) {
        const sourceDetail = `webNav.onHistoryStateUpdated (url: ${details.url.substring(0, 70)}, transType: ${details.transitionType}, tabId: ${details.tabId})`;
        console.log(`Background: Event - ${sourceDetail}`);
        chrome.tabs.get(details.tabId, (tab) => {
            if (tab) handlePotentialNavigation(details.tabId, details.url, tab.title || "", sourceDetail);
            else console.warn(`Background: webNav.onHistoryStateUpdated - Tab ${details.tabId} not found for URL ${details.url}`);
        });
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
            const sourceDetail = `tabs.onActivated (tabId: ${activeInfo.tabId})`;
            console.log(`Background: Event - ${sourceDetail} for ${tab.url}`);
            handlePotentialNavigation(tab.id, tab.url, tab.title || "", sourceDetail);
        }
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CONTENT_UPDATED") {
        const sourceDetail = `contentJs[${message.triggeringSource}, ID:${message.contentJsRequestId || 'N/A'}]`;
        const tabId = sender.tab ? sender.tab.id : 'N/A_TabID';
        console.log(`Background: Message - CONTENT_UPDATED from ${sourceDetail} for URL: ${message.data.url} (tabId: ${tabId})`);
        if (sender.tab && sender.tab.id) {
             handlePageData(sender.tab.id, message.data, sourceDetail, message.triggeringDetails);
        } else {
            console.warn(`Background: CONTENT_UPDATED received without valid sender.tab. Source: ${sourceDetail}, Sender:`, sender);
        }
    } else if (message.type === "SESSION_STARTED") {
        console.log("Background: SESSION_STARTED message received from popup. Focus:", message.focus);
        triggerCurrentTabAnalysis("SESSION_STARTED_POPUP");
    } else if (message.type === "SESSION_ENDED") {
        console.log("Background: SESSION_ENDED message received from popup.");
        // State reset handled by storage.onChanged
    } else if (message.type === "ADD_TO_WHITELIST") {
        if (message.url) {
            console.log(`Background: ADD_TO_WHITELIST message received for URL: ${message.url}`);
            addToWhitelist(message.url);
        } else {
            console.warn("Background: ADD_TO_WHITELIST message received without URL.");
        }
    }
    return true; // Keep true if any path might use sendResponse asynchronously.
                 // For ADD_TO_WHITELIST, if we made addToWhitelist async and awaited it here,
                 // and then called sendResponse, it would be fine.
                 // If not using sendResponse for this new type, can be more selective.
});

// Helper function to get the whitelist
async function getWhitelist() {
    try {
        const result = await chrome.storage.local.get(FOCUS_WHITELIST_KEY);
        return result[FOCUS_WHITELIST_KEY] || [];
    } catch (error) {
        console.error("Background: Error getting whitelist:", error);
        return [];
    }
}

// Helper function to add a URL to the whitelist
async function addToWhitelist(urlToAdd) {
    if (!urlToAdd) return;
    try {
        let whitelist = await getWhitelist();
        if (!whitelist.includes(urlToAdd)) {
            whitelist.push(urlToAdd);
            await chrome.storage.local.set({ [FOCUS_WHITELIST_KEY]: whitelist });
            console.log(`Background: Added to whitelist: ${urlToAdd}. New whitelist:`, whitelist);
            
            // Force re-evaluation for the tab that was just whitelisted
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id && tabs[0].url === urlToAdd) {
                    delete lastProcessedUrlTimestamp[urlToAdd];
                    delete currentlyProcessingUrl[urlToAdd];
                    console.log(`Background: Triggering re-analysis for newly whitelisted URL: ${urlToAdd}`);
                    handlePotentialNavigation(tabs[0].id, tabs[0].url, tabs[0].title || "", "WHITELIST_ADD_REPROCESS");
                }
            });
        } else {
            console.log(`Background: URL already in whitelist: ${urlToAdd}`);
        }
    } catch (error) {
        console.error(`Background: Error adding to whitelist (URL: ${urlToAdd}):`, error);
    }
}

function handlePotentialNavigation(tabId, url, title, sourceOfRequest) {
    console.log(`Background: handlePotentialNavigation from ${sourceOfRequest} for ${url}. Requesting content update from content.js.`);
    if (tabId && (url.startsWith('http://') || url.startsWith('https://'))) {
        chrome.tabs.sendMessage(tabId, { type: "REQUEST_CONTENT_UPDATE", sourceOfRequest: sourceOfRequest })
            .catch(error => { // Add catch for the sendMessage promise itself
                // This error often means the content script isn't ready or on a page it can't access.
                // It's often logged by the callback anyway if one existed, but good to catch promise rejection.
                if (error.message && !error.message.includes("Receiving end does not exist")) {
                     // Log if it's not the common "Receiving end does not exist" which is already handled by lastError below
                    console.warn(`Background: Error sending REQUEST_CONTENT_UPDATE (from ${sourceOfRequest}) to tab ${tabId} (${url}): ${error.message}.`);
                }
            });
        // The original callback for sendMessage is removed, as content.js uses a separate message flow.
        // chrome.runtime.lastError will still be set if the message port closes before content script calls sendResponse (which it doesn't for this message type).
        // The warning below handles the "Receiving end does not exist" type errors more specifically.
        if (chrome.runtime.lastError) { // This check is synchronous and refers to the last error *set by an API call*.
             console.warn(`Background: Error (immediately after sending) for REQUEST_CONTENT_UPDATE (from ${sourceOfRequest}) to tab ${tabId} (${url}): ${chrome.runtime.lastError.message}.`);
        }
    }
}

async function handlePageData(tabId, pageData, receivedSource, receivedDetails = {}) {
    if (!currentSessionFocus) {
        console.log(`Background: No active session. Skipping handlePageData for ${pageData.url} (Source: ${receivedSource})`);
        return;
    }
    if (!pageData || !pageData.url) {
        console.warn(`Background: handlePageData called with invalid pageData. Source: ${receivedSource}, Data:`, pageData);
        return;
    }

    const url = pageData.url;
    const processingAttemptId = `BJS_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // --- Whitelist Check ---
    const whitelist = await getWhitelist();
    if (whitelist.includes(url)) {
        console.log(`%cBackground (ID: ${processingAttemptId}): URL ${url.substring(0,70)} is WHITELISTED. Skipping further processing.`, "color: green; font-weight: bold;");
        lastProcessedUrlTimestamp[url] = Date.now(); 
        
        lastRelevantUrl = url; 
        const whitelistedAssessment = "Relevant";
        recentAssessmentsCache[url] = { assessment: whitelistedAssessment, timestamp: Date.now() }; // Update cache

        await chrome.storage.local.set({ 
            [LAST_RELEVANT_URL_KEY]: lastRelevantUrl, 
            lastAssessmentText: whitelistedAssessment 
        });

        // Notify other parts of the extension
        chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: whitelistedAssessment })
            .catch(e => console.warn(`Background (ID: ${processingAttemptId}): Error sending ASSESSMENT_RESULT_TEXT for whitelisted URL: ${e.message}`));
        
        try {
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            if (tab) {
                await chrome.action.setIcon({ path: "icons/icon_relevant48.png", tabId: tabId });
            } else {
                 console.warn(`Background (ID: ${processingAttemptId}): Tab ${tabId} not found for whitelisted icon update. Setting global icon.`);
                await chrome.action.setIcon({ path: "icons/icon_relevant48.png" });
            }
        } catch (iconError) {
            console.error(`Background (ID: ${processingAttemptId}): Failed to set icon for whitelisted URL ${url}:`, iconError);
        }
        return; 
    }
    // --- End Whitelist Check ---

    console.log(`%cBackground (ID: ${processingAttemptId}): ENTER handlePageData for ${url.substring(0,70)}. Source: ${receivedSource}. Details: ${JSON.stringify(receivedDetails).substring(0,100)}`, "color: orange;");

    if (currentlyProcessingUrl[url]) {
        console.log(`%cBackground (ID: ${processingAttemptId}): URL ${url.substring(0,70)} ALREADY IN FLIGHT (locked). Skipping. Current trigger: ${receivedSource}.`, "color: red;");
        return;
    }

    const now = Date.now();
    const lastTimestamp = lastProcessedUrlTimestamp[url] || 0;

    if ((now - lastTimestamp) < PROCESS_COOLDOWN) {
        console.log(`%cBackground (ID: ${processingAttemptId}): URL ${url.substring(0,70)} IN COOLDOWN (${(now - lastTimestamp)}ms < ${PROCESS_COOLDOWN}ms). Skipping. Current trigger: ${receivedSource}.`, "color: red;");
        const { lastAssessmentText } = await chrome.storage.local.get('lastAssessmentText');
        const currentTab = await chrome.tabs.get(tabId).catch(() => null);
        if (lastAssessmentText && currentTab && currentTab.active) {
             chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: lastAssessmentText })
                .catch(e => console.warn(`Background (ID: ${processingAttemptId}): Error sending ASSESSMENT_RESULT_TEXT during cooldown: ${e.message}`));
        }
        return;
    }

    console.log(`Background (ID: ${processingAttemptId}): Pre-lock checks PASSED for ${url.substring(0,70)}. Trigger: ${receivedSource}. Locking and proceeding.`);
    
    currentlyProcessingUrl[url] = true;
    lastProcessedUrlTimestamp[url] = now;

    try {
        console.log(`Background (ID: ${processingAttemptId}): Calling sendToBackend for ${url.substring(0,70)}. Trigger: ${receivedSource}.`);
        // For diagnosing incorrect classification, log the exact data sent:
        console.log(`Background (ID: ${processingAttemptId}): Data being sent to backend for ${url.substring(0,70)}:`, JSON.stringify(pageData, null, 2));

        await sendToBackend(pageData, currentSessionFocus, tabId, receivedSource, processingAttemptId);
    } catch (error) {
        console.error(`Background (ID: ${processingAttemptId}): Error in handlePageData's sendToBackend call for ${url.substring(0,70)} (Trigger: ${receivedSource}):`, error);
    } finally {
        currentlyProcessingUrl[url] = false;
        console.log(`Background (ID: ${processingAttemptId}): Released processing lock for ${url.substring(0,70)}. Trigger was: ${receivedSource}.`);
    }
}

async function sendToBackend(pageContent, sessionFocus, tabId, originalTriggerSource = "unknown_bjs_trigger", bjsProcessingId = "N/A_bjs_id") {
    console.log(`Background (ID: ${bjsProcessingId}): sendToBackend executing for ${pageContent.url.substring(0,70)}. Original Trigger: ${originalTriggerSource}`);
    let iconPathToSet = "icons/icon_error48.png"; // Default to error icon
    let assessmentTextToStore = "Error";

    try {
        const payload = {
            url: pageContent.url,
            title: pageContent.title || "",
            meta_description: pageContent.metaDescription || "",
            meta_keywords: pageContent.metaKeywords || "",
            page_text_snippet: pageContent.bodyTextSnippet || "",
            session_focus: sessionFocus,
        };
        
        console.log(`%cBackground (ID: ${bjsProcessingId}): ----> MAKING ACTUAL BACKEND CALL for ${pageContent.url.substring(0,70)}. Trigger: ${originalTriggerSource}. Focus: "${sessionFocus}". Title: "${payload.title.substring(0,50)}". MetaDesc: "${(payload.meta_description || '').substring(0,50)}". Snippet: "${(payload.page_text_snippet || '').substring(0,50)}"`, "color: blue; font-weight: bold;");

        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Background (ID: ${bjsProcessingId}): Backend error for ${pageContent.url.substring(0,70)}: ${response.status} ${response.statusText} - ${errorText}`);
            throw new Error(`Backend error: ${response.status} ${response.statusText}`);
        }

        const assessmentResult = await response.json();
        let rawBackendAssessment = assessmentResult.assessment;
        console.log(`Background (ID: ${bjsProcessingId}): Raw backend assessment for ${pageContent.url.substring(0,70)}: ${rawBackendAssessment}. (Trigger: ${originalTriggerSource})`);

        assessmentTextToStore = rawBackendAssessment; // Default to backend assessment

        // --- Apply Sticky Relevant Logic ---
        const cachedAssessment = recentAssessmentsCache[pageContent.url];
        if (cachedAssessment && 
            cachedAssessment.assessment === "Relevant" && 
            (Date.now() - cachedAssessment.timestamp < STICKY_RELEVANT_DURATION) &&
            rawBackendAssessment === "Irrelevant") {
            
            console.log(`%cBackground (ID: ${bjsProcessingId}): OVERRIDING to 'Relevant'. Raw backend assessment was 'Irrelevant' for ${pageContent.url.substring(0,70)}, but was 'Relevant' ${((Date.now() - cachedAssessment.timestamp)/1000).toFixed(1)}s ago.`, "color: purple; font-weight: bold;");
            assessmentTextToStore = "Relevant"; // Override to Relevant
        }
        // --- End Sticky Relevant Logic ---

        console.log(`Background (ID: ${bjsProcessingId}): Final assessment for ${pageContent.url.substring(0,70)} after sticky logic: ${assessmentTextToStore}.`);

        // Update the cache with the final assessment determined (could be overridden or direct from backend)
        recentAssessmentsCache[pageContent.url] = { assessment: assessmentTextToStore, timestamp: Date.now() };

        if (assessmentTextToStore === "Relevant") {
            lastRelevantUrl = pageContent.url; 
            await chrome.storage.local.set({ 
                [LAST_RELEVANT_URL_KEY]: lastRelevantUrl, 
                lastAssessmentText: assessmentTextToStore 
            });
        } else {
            await chrome.storage.local.set({ lastAssessmentText: assessmentTextToStore });
        }
        
        // Send assessment result to other parts of the extension (e.g., popup)
        chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: assessmentTextToStore })
            .catch(e => console.warn(`Background (ID: ${bjsProcessingId}): Error sending ASSESSMENT_RESULT_TEXT post backend call: ${e.message}`));

        iconPathToSet = assessmentTextToStore === "Relevant" ? "icons/icon_relevant48.png" : (assessmentTextToStore === "Irrelevant" ? "icons/icon_irrelevant48.png" : "icons/icon_error48.png" );
        
        // --- Trigger "Off Focus" Modal ---
        if (assessmentTextToStore === "Irrelevant") {
            // We already checked whitelist in handlePageData, so if it's irrelevant here, it's not whitelisted.
            console.log(`Background (ID: ${bjsProcessingId}): Page assessed as Irrelevant. Sending SHOW_OFF_FOCUS_MODAL to tab ${tabId} for ${pageContent.url.substring(0,70)}.`);
            chrome.tabs.sendMessage(tabId, { type: "SHOW_OFF_FOCUS_MODAL", lastRelevantUrl: lastRelevantUrl })
                .catch(e => console.warn(`Background (ID: ${bjsProcessingId}): Error sending SHOW_OFF_FOCUS_MODAL to tab ${tabId}: ${e.message}. Content script might not be ready or on an invalid page.`));
        }
        // --- End Trigger "Off Focus" Modal ---

    } catch (error) {
        console.error(`Background (ID: ${bjsProcessingId}): Error in sendToBackend for ${pageContent.url.substring(0,70)} (Trigger: ${originalTriggerSource}):`, error);
        // assessmentTextToStore is already "Error"
        await chrome.storage.local.set({ lastAssessmentText: assessmentTextToStore }); // Store "Error"
        chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: assessmentTextToStore })
             .catch(e => console.warn(`Background (ID: ${bjsProcessingId}): Error sending ASSESSMENT_RESULT_TEXT after backend error: ${e.message}`));
    } finally {
        try {
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            if (tab) {
                await chrome.action.setIcon({ path: iconPathToSet, tabId: tabId });
            } else {
                console.warn(`Background (ID: ${bjsProcessingId}): Tab ${tabId} not found for icon update. Setting global icon.`);
                await chrome.action.setIcon({ path: iconPathToSet });
            }
        } catch (iconError) {
            console.error(`Background (ID: ${bjsProcessingId}): Failed to set icon ${iconPathToSet} for tab ${tabId}:`, iconError);
        }
    }
}

function triggerCurrentTabAnalysis(reasonForAnalysis) {
    console.log(`Background: triggerCurrentTabAnalysis, reason: ${reasonForAnalysis}`);
    if (!currentSessionFocus) {
        console.log("Background: No session focus, not triggering analysis for reason:", reasonForAnalysis);
        return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id && tabs[0].url && (tabs[0].url.startsWith('http://') || tabs[0].url.startsWith('https://'))) {
            const tab = tabs[0];
            console.log(`Background: Requesting content update from active tab ${tab.id} (${tab.url.substring(0,70)}) due to ${reasonForAnalysis}`);
            handlePotentialNavigation(tab.id, tab.url, tab.title || "", `triggerCurrentTabAnalysis:${reasonForAnalysis}`);
        } else {
            console.log("Background: No active HTTP/S tab found to trigger analysis for reason:", reasonForAnalysis);
        }
    });
}

if (currentSessionFocus) {
    console.log("Background: Current session focus active on init. Triggering analysis for current tab.");
    triggerCurrentTabAnalysis("BACKGROUND_SCRIPT_INIT_WITH_FOCUS");
} else {
    console.log("Background: No session focus on init. Waiting for session to start.");
}