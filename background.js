const BACKEND_URL = "https://specific-focus-backend-1056415616503.europe-west1.run.app/classify?model=gemini-2.5-flash-lite";
let currentSessionFocus = null;
let lastProcessedUrlTimestamp = {};
const PROCESS_COOLDOWN = 1500; // ms - REDUCED from 3000ms for faster responsiveness
let currentlyProcessingUrl = {};
const FOCUS_WHITELIST_KEY = 'focusWhitelist';
const LAST_RELEVANT_URL_KEY = 'lastRelevantUrlForFocus';
let lastRelevantUrl = null;

const PREMIUM_SKU_ID = "premium_focus_unlimited";

// ENHANCED CACHING SYSTEM
const STICKY_RELEVANT_DURATION = 15000; // 15 seconds - INCREASED from 7s for better UX
const GLOBAL_CACHE_DURATION = 300000; // 5 minutes - Cache assessments across focus sessions
let recentAssessmentsCache = {}; // Enhanced cache
let globalAssessmentCache = {}; // Persistent cache across sessions

// SMART REQUEST MANAGEMENT  
let pendingRequests = new Map(); // Deduplicate identical requests
let requestQueue = []; // Queue for managing API call rate
const MAX_CONCURRENT_REQUESTS = 2;
let activeRequestCount = 0;

// Session Timer State Keys
const SESSION_START_TIME_KEY = 'sessionStartTime';
const IS_SESSION_PAUSED_KEY = 'isSessionPaused';
const PAUSED_ELAPSED_TIME_KEY = 'pausedElapsedTime';
const DAILY_TOTAL_FOCUS_KEY_PREFIX = 'dailyTotalFocusTime_'; // New

// Pomodoro State Keys
const POMODORO_ENABLED_KEY = 'pomodoroEnabled';
const POMODORO_WORK_DURATION_KEY = 'pomodoroWorkDuration';
const POMODORO_BREAK_DURATION_KEY = 'pomodoroBreakDuration';
const POMODORO_CURRENT_MODE_KEY = 'pomodoroCurrentMode'; // "work" | "break"
const POMODORO_CYCLE_END_TIME_KEY = 'pomodoroCycleEndTime';
const POMODORO_ALARM_NAME_WORK = 'pomodoroWorkAlarm';
const POMODORO_ALARM_NAME_BREAK = 'pomodoroBreakAlarm';

// Icon dimensions
// Generate proper size per context for crisp icons (16, 24, 32, 48, 128)
const ICON_SIZES = [16, 24, 32, 48, 128];

console.log("Background.js: Script loaded/reloaded. Initializing...");

// Helper function to get today's date string for storage key
function getTodayDateString() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

// Function to update daily total focus time
async function updateDailyTotalFocusTime(durationToAdd) {
    if (durationToAdd <= 0) return;

    const todayKey = DAILY_TOTAL_FOCUS_KEY_PREFIX + getTodayDateString();
    try {
        const result = await chrome.storage.local.get(todayKey);
        const currentDailyTotal = result[todayKey] || 0;
        const newDailyTotal = currentDailyTotal + durationToAdd;
        await chrome.storage.local.set({ [todayKey]: newDailyTotal });
        console.log(`Background: Updated daily total focus time. Added ${durationToAdd/1000}s. New total for ${todayKey}: ${newDailyTotal/1000}s`);
    } catch (e) {
        console.error("Background: Error updating daily total focus time:", e);
    }
}

// Load initial states from storage
chrome.storage.local.get([LAST_RELEVANT_URL_KEY, 'sessionFocus', SESSION_START_TIME_KEY, IS_SESSION_PAUSED_KEY, PAUSED_ELAPSED_TIME_KEY], (result) => {
    if (result[LAST_RELEVANT_URL_KEY]) {
        lastRelevantUrl = result[LAST_RELEVANT_URL_KEY];
        console.log("Background: Loaded lastRelevantUrl on init:", lastRelevantUrl);
    }
    if (result.sessionFocus) {
        currentSessionFocus = result.sessionFocus;
        console.log("Background: Session focus loaded on init:", currentSessionFocus);
        // If session was active, also load timer states - popup will handle display
        // console.log("Background: Active session detected on init, timer states from storage:", 
        //     result[SESSION_START_TIME_KEY], result[IS_SESSION_PAUSED_KEY], result[PAUSED_ELAPSED_TIME_KEY]);
    } else {
        console.log("Background: No session focus found on init.");
        try {
            chrome.action.setIcon({ path: "icons/icon48.png" });
        } catch (e) {
            console.error("Background.js: Error setting default icon on init:", e);
        }
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.sessionFocus) {
        currentSessionFocus = changes.sessionFocus.newValue;
        console.log("Background: Session focus changed via storage to:", currentSessionFocus);
        if (!currentSessionFocus) {
                console.log("Background: Session ended (detected by sessionFocus change). Clearing related states.");
            try {
                chrome.action.setIcon({ path: "icons/icon48.png" });
            } catch (e) {
                console.error("Background.js: Error setting icon on session end:", e);
            }
            lastProcessedUrlTimestamp = {};
            currentlyProcessingUrl = {};
                lastRelevantUrl = null; // Clear in-memory last relevant URL
                recentAssessmentsCache = {}; // Clear sticky cache
                // Timer states are primarily managed via messages, but good to ensure consistency if needed
        } else {
            console.log("Background: Session started or focus changed. Triggering analysis for current tab.");
            triggerCurrentTabAnalysis("SESSION_RESTARTED_OR_FOCUS_CHANGED");
            }
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
    const popupMessageTypes = [
        'START_POMODORO_CYCLE',
        'SESSION_STARTED',
        'SESSION_ENDED',
        'PAUSE_SESSION',
        'RESUME_SESSION',
        'STOP_POMODORO_CYCLE',
        'ADD_TO_WHITELIST'
    ];
    if (!sender.tab && !popupMessageTypes.includes(message.type)) return;
    if (message.type === "CONTENT_UPDATED") {
        const sourceDetail = `contentJs[${message.triggeringSource}, ID:${message.contentJsRequestId || 'N/A'}]`;
        const tabId = sender.tab.id;
        console.log(`Background: Message - CONTENT_UPDATED from ${sourceDetail} for URL: ${message.data.url} (tabId: ${tabId})`);
        if (sender.tab && sender.tab.id) {
             handlePageData(sender.tab.id, message.data, sourceDetail, message.triggeringDetails);
        } else {
            console.warn(`Background: CONTENT_UPDATED received without valid sender.tab. Source: ${sourceDetail}, Sender:`, sender);
        }
    } else if (message.type === "SESSION_STARTED") {
        console.log("Background: SESSION_STARTED message received from popup. Focus:", message.focus);
        const todayKey = DAILY_TOTAL_FOCUS_KEY_PREFIX + getTodayDateString();
        
        // Check if it's a new day compared to the last stored daily total to reset if necessary
        // This part is optional if we only care about accumulating for the current day string
        // For simplicity, we just start or continue today's count.

        chrome.storage.local.set({
            [SESSION_START_TIME_KEY]: Date.now(),
            [IS_SESSION_PAUSED_KEY]: false,
            [PAUSED_ELAPSED_TIME_KEY]: 0,
            sessionFocus: message.focus, 
            lastAssessmentText: null, 
            [LAST_RELEVANT_URL_KEY]: null 
            // Today's total time will be updated on pause/end
        }, () => {
            console.log("Background: Session timer states initialized for focus:", message.focus);
        triggerCurrentTabAnalysis("SESSION_STARTED_POPUP");
        });
    } else if (message.type === "SESSION_ENDED") {
        console.log("Background: SESSION_ENDED message received from popup.");
        // Calculate final segment duration and add to daily total before clearing states
        chrome.storage.local.get([SESSION_START_TIME_KEY, IS_SESSION_PAUSED_KEY, PAUSED_ELAPSED_TIME_KEY], (result) => {
            if (!result[IS_SESSION_PAUSED_KEY] && result[SESSION_START_TIME_KEY]) {
                const finalSegmentDuration = Date.now() - result[SESSION_START_TIME_KEY];
                updateDailyTotalFocusTime(finalSegmentDuration); // Update daily total
            }
            // else if it was paused, the last segment was already added by PAUSE_SESSION
            
            // Clear in-memory states
            currentSessionFocus = null;
            lastRelevantUrl = null;
            recentAssessmentsCache = {};
            // Popup.js handles removing sessionFocus, lastAssessmentText, lastRelevantUrlForFocus, focusWhitelist,
            // sessionStartTime, isSessionPaused, pausedElapsedTime from storage.
            // When main session ends, also ensure Pomodoro is stopped and its icon overlays are cleared.
            chrome.alarms.clear(POMODORO_ALARM_NAME_WORK);
            chrome.alarms.clear(POMODORO_ALARM_NAME_BREAK);
            chrome.storage.local.set({
                [POMODORO_ENABLED_KEY]: false,
                [POMODORO_CURRENT_MODE_KEY]: null,
                [POMODORO_CYCLE_END_TIME_KEY]: null
            }, () => {
                console.log("Background: Pomodoro cycle explicitly stopped due to session end.");
                // Attempt to update icon for the active tab to remove Pomodoro overlay
                chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                    if (activeTabs && activeTabs.length > 0 && activeTabs[0].id) {
                        refreshIconForTab(activeTabs[0].id);
                    }
                });
            });
        });
    } else if (message.type === "ADD_TO_WHITELIST") {
        if (message.url) {
            console.log(`Background: ADD_TO_WHITELIST message received for URL: ${message.url}`);
            addToWhitelist(message.url);
        } else {
            console.warn("Background: ADD_TO_WHITELIST message received without URL.");
        }
    } else if (message.type === "PAUSE_SESSION") {
        console.log("Background: PAUSE_SESSION message received.");
        chrome.storage.local.get([SESSION_START_TIME_KEY, PAUSED_ELAPSED_TIME_KEY, IS_SESSION_PAUSED_KEY], (result) => {
            if (!result[IS_SESSION_PAUSED_KEY] && result[SESSION_START_TIME_KEY]) { 
                const currentSegmentElapsed = Date.now() - result[SESSION_START_TIME_KEY];
                const newPausedElapsedTime = (result[PAUSED_ELAPSED_TIME_KEY] || 0) + currentSegmentElapsed;
                
                updateDailyTotalFocusTime(currentSegmentElapsed); // Update daily total for the segment just ended

                chrome.storage.local.set({
                    [IS_SESSION_PAUSED_KEY]: true,
                    [PAUSED_ELAPSED_TIME_KEY]: newPausedElapsedTime
                }, () => {
                    console.log("Background: Session paused. Total elapsed so far:", newPausedElapsedTime / 1000, "seconds.");
                    if (sendResponse) sendResponse({status: "paused", pausedTime: newPausedElapsedTime});
                });
            } else {
                if (sendResponse) sendResponse({status: "already_paused_or_no_session"});
            }
        });
        return true; 
    } else if (message.type === "RESUME_SESSION") {
        console.log("Background: RESUME_SESSION message received.");
        chrome.storage.local.get(IS_SESSION_PAUSED_KEY, (result) => {
            if (result[IS_SESSION_PAUSED_KEY]) { // Only resume if paused
                chrome.storage.local.set({
                    [IS_SESSION_PAUSED_KEY]: false,
                    [SESSION_START_TIME_KEY]: Date.now() // Reset start time for the new active segment
                }, () => {
                    console.log("Background: Session resumed.");
                    if (sendResponse) sendResponse({status: "resumed"});
                });
            } else {
                 if (sendResponse) sendResponse({status: "not_paused"});
            }
        });
        return true; // Indicate async response
    } else if (message.type === "START_POMODORO_CYCLE") {
        console.log("Background: START_POMODORO_CYCLE received", message);
        const { workDuration, breakDuration } = message;
        chrome.storage.local.set({
            [POMODORO_ENABLED_KEY]: true,
            [POMODORO_WORK_DURATION_KEY]: workDuration,
            [POMODORO_BREAK_DURATION_KEY]: breakDuration,
            [POMODORO_CURRENT_MODE_KEY]: "work",
            [POMODORO_CYCLE_END_TIME_KEY]: Date.now() + (workDuration * 60000)
        }, () => {
            chrome.alarms.create(POMODORO_ALARM_NAME_WORK, { delayInMinutes: workDuration });
            console.log(`Background: Pomodoro work cycle started for ${workDuration} min.`);
            if (sendResponse) sendResponse({status: "pomodoro_started", mode: "work", endTime: Date.now() + (workDuration * 60000) });
            // Update icon for current tab
            chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                if (activeTabs && activeTabs.length > 0 && activeTabs[0].id) {
                    refreshIconForTab(activeTabs[0].id);
                }
            });
        });
        return true; // Indicate async response
    } else if (message.type === "STOP_POMODORO_CYCLE") {
        console.log("Background: STOP_POMODORO_CYCLE received");
        chrome.alarms.clear(POMODORO_ALARM_NAME_WORK);
        chrome.alarms.clear(POMODORO_ALARM_NAME_BREAK);
        chrome.storage.local.set({
            [POMODORO_ENABLED_KEY]: false,
            [POMODORO_CURRENT_MODE_KEY]: null,
            [POMODORO_CYCLE_END_TIME_KEY]: null
            // Keep durations for next time user enables it
        }, () => {
            console.log("Background: Pomodoro cycle stopped.");
            if (sendResponse) sendResponse({status: "pomodoro_stopped"});
            // Update icon for current tab to remove Pomodoro overlay
            chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                if (activeTabs && activeTabs.length > 0 && activeTabs[0].id) {
                    refreshIconForTab(activeTabs[0].id);
                }
            });
        });
        return true; // Indicate async response
    }
    return true; 
});

// Pomodoro Alarm Handler
chrome.alarms.onAlarm.addListener((alarm) => {
    console.log("Background: Pomodoro alarm fired!", alarm);
    chrome.storage.local.get([
        POMODORO_ENABLED_KEY, 
        POMODORO_WORK_DURATION_KEY, 
        POMODORO_BREAK_DURATION_KEY, 
        POMODORO_CURRENT_MODE_KEY
    ], (result) => {
        if (!result[POMODORO_ENABLED_KEY]) {
            console.log("Background: Pomodoro alarm fired but Pomodoro is not enabled. Clearing alarms.");
            chrome.alarms.clear(POMODORO_ALARM_NAME_WORK);
            chrome.alarms.clear(POMODORO_ALARM_NAME_BREAK);
            return;
        }

        let nextMode = null;
        let nextDuration = 0;
        let nextAlarmName = null;
        let notificationMessage = "";
        let messageToContentScript = null;

        if (alarm.name === POMODORO_ALARM_NAME_WORK && result[POMODORO_CURRENT_MODE_KEY] === "work") {
            nextMode = "break";
            nextDuration = result[POMODORO_BREAK_DURATION_KEY];
            nextAlarmName = POMODORO_ALARM_NAME_BREAK;
            notificationMessage = `Work cycle finished! Time for a ${nextDuration}-minute break.`;
            messageToContentScript = { type: "SHOW_POMODORO_BREAK_MODAL", breakDuration: nextDuration };
        } else if (alarm.name === POMODORO_ALARM_NAME_BREAK && result[POMODORO_CURRENT_MODE_KEY] === "break") {
            nextMode = "work";
            nextDuration = result[POMODORO_WORK_DURATION_KEY];
            nextAlarmName = POMODORO_ALARM_NAME_WORK;
            notificationMessage = `Break finished! Time for a ${nextDuration}-minute work session.`;
            messageToContentScript = { type: "SHOW_POMODORO_WORK_MODAL" };
        }

        if (nextMode && nextAlarmName && nextDuration > 0) {
            console.log(`Background: Pomodoro transitioning to ${nextMode} for ${nextDuration} min.`);
            chrome.storage.local.set({
                [POMODORO_CURRENT_MODE_KEY]: nextMode,
                [POMODORO_CYCLE_END_TIME_KEY]: Date.now() + (nextDuration * 60000)
            }, () => {
                chrome.alarms.create(nextAlarmName, { delayInMinutes: nextDuration });
                
                chrome.runtime.sendMessage({
                    type: "POMODORO_MODE_CHANGED", 
                    mode: nextMode, 
                    endTime: Date.now() + (nextDuration * 60000)
                }).catch(e => console.log("Error sending POMODORO_MODE_CHANGED to popup:", e.message));

                // Update icon and send message to content script for active tab
                chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                    if (activeTabs && activeTabs.length > 0 && activeTabs[0].id) {
                        const activeTabId = activeTabs[0].id;
                        refreshIconForTab(activeTabId); // Update icon (will show brain/coffee)
                        
                        if (messageToContentScript && activeTabs[0].url && (activeTabs[0].url.startsWith('http://') || activeTabs[0].url.startsWith('https://'))) {
                            console.log(`Background: Sending ${messageToContentScript.type} to tab ${activeTabId}`);
                            chrome.tabs.sendMessage(activeTabId, messageToContentScript)
                                .catch(e => console.warn(`Background: Error sending ${messageToContentScript.type} to tab ${activeTabId}: ${e.message}`));
                        }
                    }
                });

                // Simple notification (requires "notifications" permission in manifest)
                chrome.notifications.create({
                    type: "basic",
                    iconUrl: "icons/icon128.png",
                    title: nextMode === 'break' ? 'Time to Rest!' : 'Time to Work!',
                    message: nextMode === 'break' ? `Work cycle finished! Time for a ${nextDuration}-minute break.` : `Break finished! Time for a ${nextDuration}-minute work session.`
                });
            });
        } else {
            console.log("Background: Pomodoro alarm fired but state is inconsistent or duration is zero. Stopping cycle.");
            chrome.alarms.clear(POMODORO_ALARM_NAME_WORK);
            chrome.alarms.clear(POMODORO_ALARM_NAME_BREAK);
            chrome.storage.local.set({
                [POMODORO_ENABLED_KEY]: false,
                [POMODORO_CURRENT_MODE_KEY]: null,
                [POMODORO_CYCLE_END_TIME_KEY]: null
            }, () => {
                // Update icon for active tab if Pomodoro is forcibly stopped due to error
                chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                    if (activeTabs && activeTabs.length > 0 && activeTabs[0].id) {
                        refreshIconForTab(activeTabs[0].id);
                    }
                });
            });
        }
    });
});

// --- Icon Management with Pomodoro Overlays ---

async function loadImageBitmap(path) {
    try {
        const response = await fetch(chrome.runtime.getURL(path));
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        return await createImageBitmap(blob);
    } catch (e) {
        console.error(`Error loading image ${path}:`, e);
        return null;
    }
}

async function generateDynamicIcon(tabId, baseIconPath, overlayIconPath = null) {
    try {
        // Produce a map of size -> ImageData for crisp rendering at all DPRs
        const imagesBySize = {};
        const baseImage = await loadImageBitmap(baseIconPath);
        const overlayImage = overlayIconPath ? await loadImageBitmap(overlayIconPath) : null;

        for (const size of ICON_SIZES) {
            const canvas = new OffscreenCanvas(size, size);
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            if (baseImage) ctx.drawImage(baseImage, 0, 0, size, size);
            if (overlayImage) ctx.drawImage(overlayImage, 0, 0, size, size);
            imagesBySize[size] = ctx.getImageData(0, 0, size, size);
        }
        if (Object.keys(imagesBySize).length > 0) {
            chrome.action.setIcon({ imageData: imagesBySize, tabId });
        } else if (baseIconPath) {
            chrome.action.setIcon({ path: baseIconPath, tabId });
        }
 
    } catch (e) {
        console.error("Error generating dynamic icon:", e);
        // Fallback if canvas operations fail
        if (baseIconPath) {
            chrome.action.setIcon({ path: baseIconPath, tabId });
        }
    }
}

async function refreshIconForTab(tabId, forceAssessmentText = null) {
    if (!tabId) return;

    // Determine the base icon based on current assessment and session focus
    chrome.storage.local.get(['lastAssessmentText', 'sessionFocus', POMODORO_CURRENT_MODE_KEY], async (storage) => {
        let baseIconPath = "icons/icon48.png"; // Default icon
        let currentAssessment = forceAssessmentText || storage.lastAssessmentText;

        if (storage.sessionFocus) {
            if (currentAssessment === "Relevant") {
                baseIconPath = "icons/icon_relevant48.png";
            } else if (currentAssessment === "Irrelevant") {
                baseIconPath = "icons/icon_irrelevant48.png";
            } else if (currentAssessment === "Error") {
                baseIconPath = "icons/icon_error48.png";
            }
            // If no assessment yet, but session active, could use a specific "monitoring" icon or default
        }

        let overlayIconPath = null;
        if (storage.sessionFocus && storage[POMODORO_CURRENT_MODE_KEY]) {
            if (storage[POMODORO_CURRENT_MODE_KEY] === 'work') {
                overlayIconPath = 'icons/brain.png';
            } else if (storage[POMODORO_CURRENT_MODE_KEY] === 'break') {
                overlayIconPath = 'icons/coffee.png';
            }
        }
        
        // console.log(`Background: Refreshing icon for tab ${tabId}. Base: ${baseIconPath}, Overlay: ${overlayIconPath}, Assessment: ${currentAssessment}`);
        await generateDynamicIcon(tabId, baseIconPath, overlayIconPath);
    });
}

// --- End Icon Management ---

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
    
    if (url.includes('checkout.stripe.com') || url.endsWith('/payment-success.html') || url.endsWith('/upgrade.html')) {
        console.log(`Background: Upgrade-related URL detected: ${url}. Treating as Relevant.`);
        const upgradeAssessment = 'Relevant';
        recentAssessmentsCache[url] = { assessment: upgradeAssessment, timestamp: Date.now() };
        await chrome.storage.local.set({ lastAssessmentText: upgradeAssessment });
        refreshIconForTab(tabId, upgradeAssessment);
        return;
    }

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

        chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: whitelistedAssessment })
            .catch(e => console.warn(`Background (ID: ${processingAttemptId}): Error sending ASSESSMENT_RESULT_TEXT for whitelisted URL: ${e.message}`));
        
        refreshIconForTab(tabId, whitelistedAssessment); // Update icon
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

// Smart request deduplication and caching
function getCacheKey(url, sessionFocus) {
    return `${url}|${sessionFocus}`;
}

function checkGlobalCache(url, sessionFocus) {
    const cacheKey = getCacheKey(url, sessionFocus);
    const cached = globalAssessmentCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < GLOBAL_CACHE_DURATION)) {
        console.log(`%cBackground: Global cache HIT for ${url.substring(0, 50)}... (${cached.assessment})`, "color: green; font-weight: bold;");
        return cached.assessment;
    }
    return null;
}

function updateGlobalCache(url, sessionFocus, assessment) {
    const cacheKey = getCacheKey(url, sessionFocus);
    globalAssessmentCache[cacheKey] = {
        assessment,
        timestamp: Date.now()
    };
    
    // Cleanup old cache entries periodically
    if (Object.keys(globalAssessmentCache).length > 1000) {
        const entries = Object.entries(globalAssessmentCache);
        const cutoff = Date.now() - GLOBAL_CACHE_DURATION;
        entries.forEach(([key, data]) => {
            if (data.timestamp < cutoff) {
                delete globalAssessmentCache[key];
            }
        });
    }
}

async function sendToBackend(pageContent, sessionFocus, tabId, originalTriggerSource = "unknown_bjs_trigger", bjsProcessingId = "N/A_bjs_id") {
    console.log(`Background (ID: ${bjsProcessingId}): sendToBackend executing for ${pageContent.url.substring(0,70)}. Original Trigger: ${originalTriggerSource}`);
    
    const { freeLimitReached, limitHash } = await chrome.storage.local.get(['freeLimitReached', 'limitHash']);
    if (simpleHash(freeLimitReached.toString()) !== limitHash) {
        console.warn('Tamper detected - resyncing limit.');
        await syncFreeLimit();
    }

    if (freeLimitReached) {
        console.log(`Background: Free limit reached - skipping backend send for ${pageContent.url}.`);
        assessmentTextToStore = "Limit Reached";
        await chrome.storage.local.set({ lastAssessmentText: assessmentTextToStore });
        refreshIconForTab(tabId, assessmentTextToStore);
        return;
    }

    // FAST PATH: Check global cache first
    const cachedAssessment = checkGlobalCache(pageContent.url, sessionFocus);
    if (cachedAssessment) {
        console.log(`%cBackground (ID: ${bjsProcessingId}): Returning cached assessment: ${cachedAssessment}`, "color: green; font-weight: bold;");
        
        // Update local structures and UI immediately
        recentAssessmentsCache[pageContent.url] = { assessment: cachedAssessment, timestamp: Date.now() };
        await chrome.storage.local.set({ lastAssessmentText: cachedAssessment });
        
        if (cachedAssessment === "Relevant") {
            lastRelevantUrl = pageContent.url;
            await chrome.storage.local.set({ [LAST_RELEVANT_URL_KEY]: lastRelevantUrl });
        }
        
        refreshIconForTab(tabId, cachedAssessment);
        chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: cachedAssessment })
            .catch(e => console.warn(`Background: Error sending cached result: ${e.message}`));
        
        delete currentlyProcessingUrl[pageContent.url];
        return;
    }

    // REQUEST DEDUPLICATION: Check if same request is already in progress
    const requestKey = `${pageContent.url}|${sessionFocus}`;
    if (pendingRequests.has(requestKey)) {
        console.log(`%cBackground (ID: ${bjsProcessingId}): Duplicate request detected, waiting for existing request...`, "color: orange;");
        try {
            const result = await pendingRequests.get(requestKey);
            console.log(`%cBackground (ID: ${bjsProcessingId}): Received result from deduplicated request: ${result}`, "color: orange;");
            delete currentlyProcessingUrl[pageContent.url];
            return;
        } catch (error) {
            console.error(`Background (ID: ${bjsProcessingId}): Error waiting for deduplicated request:`, error);
        }
    }

    // RATE LIMITING: Queue request if too many concurrent requests
    if (activeRequestCount >= MAX_CONCURRENT_REQUESTS) {
        console.log(`%cBackground (ID: ${bjsProcessingId}): Rate limiting - queuing request`, "color: yellow;");
        return new Promise((resolve) => {
            requestQueue.push(() => {
                resolve(sendToBackend(pageContent, sessionFocus, tabId, originalTriggerSource, bjsProcessingId));
            });
        });
    }

    let assessmentTextToStore = "Error";
    const requestPromise = (async () => {
        activeRequestCount++;
        
        try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(token);
                }
            });
        });

        if (!token) {
            console.error(`Background (ID: ${bjsProcessingId}): OAuth token is null or undefined. Cannot send to backend for ${pageContent.url}.`);
            assessmentTextToStore = "Auth Error";
            await chrome.storage.local.set({ lastAssessmentText: assessmentTextToStore });
            await refreshIconForTab(tabId, assessmentTextToStore);
            delete currentlyProcessingUrl[pageContent.url];
            return;
        }

        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                url: pageContent.url,
                title: pageContent.title,
                meta_description: pageContent.metaDescription,
                page_text_snippet: (pageContent.pageText || '').substring(0, 1000),
                session_focus: sessionFocus
            })
        });

        if (!response.ok) {
            let errorDetail = `HTTP error! Status: ${response.status}`;
            try {
                const errorJson = await response.json();
                errorDetail = errorJson.detail || errorJson; // Use detail if present, otherwise the whole object
                 if (response.status === 402) { // Payment Required
                    await chrome.storage.local.set({ freeLimitReached: true });
                    console.warn(`Background (ID: ${bjsProcessingId}): API limit reached for ${pageContent.url}. Status 402. Detail:`, errorDetail);
                    // Call handlePaymentRequired, potentially passing tabId or other relevant info
                    handlePaymentRequired(tabId, errorDetail); // Pass tabId if needed for context post-payment
                    assessmentTextToStore = "Limit Reached"; // Or a more user-friendly message
                    // We might not want to set currentlyProcessingUrl to false immediately,
                    // as the payment flow is now active. Or we might want to allow other tabs to process.
                    // For now, let's clear it, assuming one payment flow at a time.
                    // delete currentlyProcessingUrl[pageContent.url]; 
                    // return; // Stop further processing for this page for now
                }
            } catch (e) {
                // Failed to parse JSON, use the status text or basic detail
                errorDetail = `HTTP error! Status: ${response.status}. Response not JSON or JSON parse error.`;
                console.error(`Background (ID: ${bjsProcessingId}): Backend response error for ${pageContent.url}. ${errorDetail}`, e);
            }
            // assessmentTextToStore = `Error: ${response.status}`; // Set earlier if 402
            if (response.status !== 402) { // Don't overwrite "Limit Reached"
                 assessmentTextToStore = `Error: ${response.status}`;
            }
            await chrome.storage.local.set({ lastAssessmentText: assessmentTextToStore });
            await refreshIconForTab(tabId, assessmentTextToStore);
            delete currentlyProcessingUrl[pageContent.url];
            // No throw here if it's a 402, as it's a specific flow.
            // For other errors, if we want to propagate, we might throw here.
            if (response.status !== 402) {
                 console.error(`Background (ID: ${bjsProcessingId}): Throwing for non-402 error: ${errorDetail}`);
                 // Consider if throwing is the best approach or just logging and returning.
                 // throw new Error(typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail));
            }
            return; // Important to return after handling error
        }

        const data = await response.json();
        let rawBackendAssessment = data.assessment;
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
        
        // Update global cache for cross-session persistence
        updateGlobalCache(pageContent.url, sessionFocus, assessmentTextToStore);

        if (assessmentTextToStore === "Relevant") {
            lastRelevantUrl = pageContent.url; 
            await chrome.storage.local.set({ 
                [LAST_RELEVANT_URL_KEY]: lastRelevantUrl, 
                lastAssessmentText: assessmentTextToStore 
            });
        } else {
            await chrome.storage.local.set({ lastAssessmentText: assessmentTextToStore });
        }
        
        chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: assessmentTextToStore })
            .catch(e => console.warn(`Background (ID: ${bjsProcessingId}): Error sending ASSESSMENT_RESULT_TEXT post backend call: ${e.message}`));

        // iconPathToSet is determined by assessmentTextToStore, then passed to refreshIconForTab implicitly
        refreshIconForTab(tabId, assessmentTextToStore);
        
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
        // assessmentTextToStore is already "Error" or "AuthError" if token failed
        if (error.message.includes("token")) { // more specific error for token issues
            assessmentTextToStore = "AuthError";
        }
        await chrome.storage.local.set({ lastAssessmentText: assessmentTextToStore }); // Store appropriate error
        chrome.runtime.sendMessage({ type: "ASSESSMENT_RESULT_TEXT", assessmentText: assessmentTextToStore })
             .catch(e => console.warn(`Background (ID: ${bjsProcessingId}): Error sending ASSESSMENT_RESULT_TEXT after backend error: ${e.message}`));
        refreshIconForTab(tabId, assessmentTextToStore); // Update icon on error too
        } finally {
            // Clean up request tracking
            activeRequestCount--;
            pendingRequests.delete(requestKey);
            delete currentlyProcessingUrl[pageContent.url];
            
            // Process queued requests
            if (requestQueue.length > 0 && activeRequestCount < MAX_CONCURRENT_REQUESTS) {
                const nextRequest = requestQueue.shift();
                nextRequest();
            }
        }
    })();

    // Store the promise for deduplication
    pendingRequests.set(requestKey, requestPromise);
    
    return requestPromise;
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
            refreshIconForTab(tab.id); // Refresh icon when analysis is triggered for current tab
        } else {
            console.log("Background: No active HTTP/S tab found to trigger analysis for reason:", reasonForAnalysis);
        }
    });
}

async function handlePaymentRequired(tabId, errorPayload) {
    console.log(`Background: Payment required. Details:`, errorPayload);
    // Open the same upgrade flow as the popup, passing token and userId
    try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (tok) => {
                if (chrome.runtime.lastError || !tok) return reject(chrome.runtime.lastError || new Error('Token not available'));
                resolve(tok);
            });
        });
        const tokenInfoUrl = `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`;
        const response = await fetch(tokenInfoUrl);
        const tokenInfo = await response.json();
        if (tokenInfo.error) throw new Error('Invalid token');
        const userId = tokenInfo.sub;
        const { backendUrl } = await chrome.storage.local.get('backendUrl');
        const base = backendUrl || 'https://specific-focus-backend-1056415616503.europe-west1.run.app';
        const upgradeUrl = `${base}/upgrade?token=${token}&user_id=${userId}`;
        chrome.tabs.create({ url: upgradeUrl });
    } catch (e) {
        console.error('Background: Error opening upgrade page after limit:', e);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Specific Focus - Upgrade Needed',
            message: 'We hit the free limit. Please open the popup and tap Upgrade to continue.'
        });
    }
}

async function syncFreeLimit() {
    try {
        const token = await new Promise(resolve => chrome.identity.getAuthToken({interactive: false}, resolve));
        if (token) {
            const response = await fetch('https://specific-focus-backend-1056415616503.europe-west1.run.app/user-status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const status = await response.json();
                const limitReached = !status.is_premium && status.api_request_count >= 50;
                await chrome.storage.local.set({ freeLimitReached: limitReached, limitHash: simpleHash(limitReached.toString()) });
            }
        }
    } catch (e) { console.warn('Sync failed:', e); }
}

function simpleHash(str) { let hash = 0; for (let i = 0; i < str.length; i++) { hash = (hash << 5) - hash + str.charCodeAt(i); hash |= 0; } return hash.toString(); }

if (currentSessionFocus) {
    console.log("Background: Current session focus active on init. Triggering analysis for current tab.");
    triggerCurrentTabAnalysis("BACKGROUND_SCRIPT_INIT_WITH_FOCUS");
} else {
    console.log("Background: No session focus on init. Waiting for session to start.");
}

syncFreeLimit();
setInterval(syncFreeLimit, 60000); // 1min