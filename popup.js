const focusPromptInput = document.getElementById('focusPrompt');
const startSessionButton = document.getElementById('startSession');
const endSessionButton = document.getElementById('endSession');
const statusDiv = document.getElementById('status');
const relevanceDiv = document.getElementById('relevance');
const sessionTimerDiv = document.getElementById('sessionTimer');
const pauseSessionButton = document.getElementById('pauseSessionButton');
const dailyTotalDisplayDiv = document.getElementById('dailyTotalDisplay');

// Subscription UI Elements
const remainingCallsSpan = document.getElementById('remainingCalls');
const upgradeSection = document.getElementById('upgradeSection');
const premiumStatus = document.getElementById('premiumStatus');
const upgradeButton = document.getElementById('upgradeButton');
const upgradeButtonSmall = document.getElementById('upgradeButtonSmall');
const freeUsageDisplay = document.getElementById('freeUsageDisplay');

// Pomodoro UI Elements
const pomodoroControlSection = document.querySelector('.pomodoro-control');
const workDurationInput = document.getElementById('workDuration');
const breakDurationInput = document.getElementById('breakDuration');
const startPomodoroButton = document.getElementById('startPomodoro');
const stopPomodoroButton = document.getElementById('stopPomodoro');
const pomodoroStatusDiv = document.getElementById('pomodoroStatus');
const pomodoroTimerDisplayDiv = document.getElementById('pomodoroTimerDisplay');
let pomodoroInterval = null;

// Get the section views
const sessionControlView = document.querySelector('.session-control');
const sessionActiveView = document.querySelector('.session-active-view');

let timerInterval = null;

function formatTime(ms) {
    if (ms === null || typeof ms === 'undefined' || ms < 0) ms = 0;
    let totalSeconds = Math.floor(ms / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;

    return [
        hours.toString().padStart(2, '0'),
        minutes.toString().padStart(2, '0'),
        seconds.toString().padStart(2, '0')
    ].join(':');
}

function updateTimerDisplay() {
    chrome.storage.local.get(['sessionStartTime', 'isSessionPaused', 'pausedElapsedTime'], (result) => {
        if (result.sessionStartTime) {
            let elapsedMs;
            if (result.isSessionPaused) {
                elapsedMs = result.pausedElapsedTime || 0;
            } else {
                elapsedMs = (result.pausedElapsedTime || 0) + (Date.now() - result.sessionStartTime);
            }
            sessionTimerDiv.textContent = formatTime(elapsedMs);
        } else {
            sessionTimerDiv.textContent = formatTime(0);
        }
    });
}

function startTimerInterval() {
    if (timerInterval) clearInterval(timerInterval);
    updateTimerDisplay(); // Initial display
    timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimerInterval() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    // final update for paused state
    updateTimerDisplay(); 
}

function getTodayDateStringForStorage() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function updateDailyTotalDisplay() {
    const todayKey = 'dailyTotalFocusTime_' + getTodayDateStringForStorage();
    chrome.storage.local.get(todayKey, (result) => {
        const totalMs = result[todayKey] || 0;
        dailyTotalDisplayDiv.textContent = `Time focused today: ${formatTime(totalMs)}`;
    });
}

// Payment and Subscription Functions
async function updateSubscriptionStatus() {
    try {
        const token = await new Promise((resolve) => {
            chrome.identity.getAuthToken({interactive: false}, (token) => {
                resolve(token);
            });
        });

        if (token) {
            const response = await fetch('https://specific-focus-backend-1056415616503.europe-west1.run.app/user-status', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const userStatus = await response.json();
                const remainingCalls = Math.max(0, 50 - userStatus.api_request_count);
                
                remainingCallsSpan.textContent = remainingCalls;

                if (userStatus.is_premium) {
                    // Premium user
                    freeUsageDisplay.style.display = 'none';
                    upgradeSection.style.display = 'none';
                    premiumStatus.style.display = 'block';
                } else if (remainingCalls <= 0) {
                    // Free user, no calls left - show big upgrade section
                    freeUsageDisplay.style.display = 'none';
                    upgradeSection.style.display = 'block';
                    premiumStatus.style.display = 'none';
                } else {
                    // Free user with calls remaining - show small upgrade button
                    freeUsageDisplay.style.display = 'block';
                    upgradeSection.style.display = 'none';
                    premiumStatus.style.display = 'none';
                }
            }
        }
    } catch (error) {
        console.error('Error updating subscription status:', error);
        // Show fallback state - assume free user with small upgrade button
        remainingCallsSpan.textContent = '--';
        freeUsageDisplay.style.display = 'block';
        upgradeSection.style.display = 'none';
        premiumStatus.style.display = 'none';
    }
}

async function handleUpgradeClick() {
    try {
        const token = await new Promise((resolve) => {
            chrome.identity.getAuthToken({interactive: false}, (token) => {
                resolve(token);
            });
        });

        const user = await new Promise((resolve) => {
            chrome.identity.getProfileUserInfo((userInfo) => {
                resolve(userInfo);
            });
        });

        // Open upgrade page in new tab
        const upgradeUrl = `https://specific-focus-backend-1056415616503.europe-west1.run.app/upgrade?token=${token}&user_id=${user.id}`;
        chrome.tabs.create({ url: upgradeUrl });
        
    } catch (error) {
        console.error('Error opening upgrade page:', error);
        alert('Error opening upgrade page. Please try again.');
    }
}

function setRelevanceAppearance(assessmentText) {
    relevanceDiv.classList.remove('relevant', 'irrelevant', 'error'); // Clear existing classes
    if (!assessmentText || assessmentText.toLowerCase() === 'monitoring...') {
        relevanceDiv.textContent = 'Monitoring...';
        // Keep neutral appearance (default or add a .neutral class if defined)
    } else {
        relevanceDiv.textContent = `Page: ${assessmentText}`;
        if (assessmentText.toLowerCase() === 'relevant') {
            relevanceDiv.classList.add('relevant');
        } else if (assessmentText.toLowerCase() === 'irrelevant') {
            relevanceDiv.classList.add('irrelevant');
        } else if (assessmentText.toLowerCase() === 'error') {
            relevanceDiv.classList.add('error');
        }
        // Else, it will have the default neutral appearance
    }
}

function updatePomodoroTimerDisplay() {
    chrome.storage.local.get(['pomodoroCycleEndTime', 'pomodoroCurrentMode', 'pomodoroEnabled'], (result) => {
        console.log("popup.js - updatePomodoroTimerDisplay - Storage result:", result); // Debug log - UNCOMMENTED
        if (result.pomodoroEnabled && result.pomodoroCycleEndTime && result.pomodoroCurrentMode) {
            const now = Date.now();
            const timeLeftMs = result.pomodoroCycleEndTime - now;
            console.log("popup.js - updatePomodoroTimerDisplay - now:", now, "endTime:", result.pomodoroCycleEndTime, "timeLeftMs:", timeLeftMs); // Debug log - UNCOMMENTED
            if (timeLeftMs <= 0) {
                pomodoroTimerDisplayDiv.textContent = "00:00";
                // Background alarm should handle mode switch
            } else {
                // Pomodoro usually shows MM:SS
                let totalSeconds = Math.floor(timeLeftMs / 1000);
                let minutes = Math.floor(totalSeconds / 60);
                let seconds = totalSeconds % 60;
                pomodoroTimerDisplayDiv.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        } else {
            pomodoroTimerDisplayDiv.textContent = "00:00";
        }
    });
}

function startPomodoroInterval() {
    if (pomodoroInterval) clearInterval(pomodoroInterval);
    updatePomodoroTimerDisplay(); // Initial display
    pomodoroInterval = setInterval(() => {
        console.log("popup.js - Pomodoro interval tick"); // Debug log - UNCOMMENTED
        updatePomodoroTimerDisplay();
    }, 1000);
}

function stopPomodoroInterval() {
    if (pomodoroInterval) clearInterval(pomodoroInterval);
    pomodoroInterval = null;
    pomodoroTimerDisplayDiv.textContent = "00:00";
    pomodoroStatusDiv.textContent = "";
}

function updatePomodoroUI(pomodoroData) {
    const { pomodoroEnabled, pomodoroWorkDuration, pomodoroBreakDuration, pomodoroCurrentMode, pomodoroCycleEndTime } = pomodoroData;
    console.log("popup.js - updatePomodoroUI - Data:", pomodoroData); // Debug log - UNCOMMENTED

    if (pomodoroEnabled && pomodoroCurrentMode) {
        pomodoroControlSection.style.display = 'block'; // Should be managed by session active state
        startPomodoroButton.style.display = 'none';
        stopPomodoroButton.style.display = 'block';
        workDurationInput.disabled = true;
        breakDurationInput.disabled = true;
        pomodoroStatusDiv.textContent = pomodoroCurrentMode === 'work' ? "Work Cycle" : "Break Time";
        startPomodoroInterval();
    } else {
        // Show setup if session is active but pomodoro not running
        // Visibility of pomodoroControlSection itself is tied to main session being active
        startPomodoroButton.style.display = 'block';
        stopPomodoroButton.style.display = 'none';
        workDurationInput.disabled = false;
        breakDurationInput.disabled = false;
        pomodoroStatusDiv.textContent = "Start a Pomodoro cycle?";
        stopPomodoroInterval();
        if (pomodoroWorkDuration) workDurationInput.value = pomodoroWorkDuration;
        if (pomodoroBreakDuration) breakDurationInput.value = pomodoroBreakDuration;
    }
}

function updatePopupUI(sessionData) {
    const { sessionFocus, lastAssessmentText, sessionStartTime, isSessionPaused, pausedElapsedTime,
            pomodoroEnabled, pomodoroWorkDuration, pomodoroBreakDuration, pomodoroCurrentMode, pomodoroCycleEndTime } = sessionData;

    updateDailyTotalDisplay(); // Update daily total display whenever UI is refreshed
    console.log("popup.js - updatePopupUI - Passed Pomodoro Data:", { pomodoroEnabled, pomodoroWorkDuration, pomodoroBreakDuration, pomodoroCurrentMode, pomodoroCycleEndTime }); // Debug Log - UNCOMMENTED

    if (sessionFocus) {
        focusPromptInput.value = sessionFocus;
        statusDiv.textContent = isSessionPaused ? `Focus: ${sessionFocus} (Paused)` : `Focus: ${sessionFocus}`;
        sessionControlView.style.display = 'none';
        sessionActiveView.style.display = 'block';
        setRelevanceAppearance(lastAssessmentText || 'Monitoring...');
        
        pauseSessionButton.textContent = isSessionPaused ? "Resume Session" : "Pause Session";

        if (isSessionPaused) {
            stopTimerInterval(); // Stops interval and does a final update
            sessionTimerDiv.textContent = formatTime(pausedElapsedTime || 0);
            pomodoroControlSection.style.display = 'none'; // Hide Pomodoro controls when main session is paused
            stopPomodoroInterval();
        } else {
            startTimerInterval();
            pomodoroControlSection.style.display = 'block'; // Show Pomodoro controls if session is active & not paused
            updatePomodoroUI({ pomodoroEnabled, pomodoroWorkDuration, pomodoroBreakDuration, pomodoroCurrentMode, pomodoroCycleEndTime });
        }

    } else {
        focusPromptInput.value = '';
        statusDiv.textContent = 'No active session.';
        sessionControlView.style.display = 'block';
        sessionActiveView.style.display = 'none';
        pomodoroControlSection.style.display = 'none'; // Hide Pomodoro on no session
        setRelevanceAppearance(null);
        relevanceDiv.textContent = '';
        sessionTimerDiv.textContent = formatTime(0);
        stopTimerInterval();
        stopPomodoroInterval();
    }
}

// Load current session state from storage when popup opens
const keysToFetch = [
    'sessionFocus', 'lastAssessmentText', 'sessionStartTime', 
    'isSessionPaused', 'pausedElapsedTime',
    'pomodoroEnabled', 'pomodoroWorkDuration', 'pomodoroBreakDuration', 'pomodoroCurrentMode', 'pomodoroCycleEndTime'
];
chrome.storage.local.get(keysToFetch, (result) => {
    updatePopupUI(result);
    // Initialize subscription status
    updateSubscriptionStatus();
});

startPomodoroButton.addEventListener('click', () => {
    console.log("popup.js: Start Pomodoro button CLICKED!");
    const workMin = parseInt(workDurationInput.value, 10);
    const breakMin = parseInt(breakDurationInput.value, 10);
    console.log(`popup.js: Start Pomodoro clicked. Work: ${workMin}, Break: ${breakMin}`);

    if (isNaN(workMin) || workMin < 1 || isNaN(breakMin) || breakMin < 1) {
        pomodoroStatusDiv.textContent = "Please set valid durations (min. 1 minute).";
        // Temporarily style the input fields to show error
        workDurationInput.classList.add('input-error-temp');
        breakDurationInput.classList.add('input-error-temp');
        setTimeout(() => {
            workDurationInput.classList.remove('input-error-temp');
            breakDurationInput.classList.remove('input-error-temp');
        }, 2000);
        return;
    }

    chrome.runtime.sendMessage({
        type: "START_POMODORO_CYCLE",
        workDuration: workMin,
        breakDuration: breakMin
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Popup.js: Error sending/receiving START_POMODORO_CYCLE message:", chrome.runtime.lastError.message);
            pomodoroStatusDiv.textContent = "Error starting. Check console.";
            return;
        }

        console.log("popup.js: Response from START_POMODORO_CYCLE:", response);
        if (response && response.status === 'pomodoro_started') {
            chrome.storage.local.get(keysToFetch, updatePopupUI);
        } else {
            console.warn("popup.js: START_POMODORO_CYCLE - Unexpected or no response:", response);
            pomodoroStatusDiv.textContent = "Failed to start. Try again.";
        }
    });
});

// This is the original startSessionButton listener that should have been preserved.
startSessionButton.addEventListener('click', () => {
    const focus = focusPromptInput.value.trim();
    if (focus) {
        const initialSessionState = {
            sessionFocus: focus,
            lastAssessmentText: null,
            sessionStartTime: Date.now(),
            isSessionPaused: false,
            pausedElapsedTime: 0,
            lastRelevantUrlForFocus: null 
        };
        const pomodoroDefaults = {
            pomodoroEnabled: false,
            pomodoroWorkDuration: 25, // Default value
            pomodoroBreakDuration: 5,  // Default value
            pomodoroCurrentMode: null,
            pomodoroCycleEndTime: null
        };
        const fullInitialState = {...initialSessionState, ...pomodoroDefaults };

        chrome.storage.local.set(fullInitialState, () => {
            updatePopupUI(fullInitialState);
            chrome.runtime.sendMessage({ type: "SESSION_STARTED", focus: focus });
        });
    } else {
        focusPromptInput.placeholder = 'Please enter a focus first!';
        focusPromptInput.classList.add('input-error-temp'); 
        setTimeout(() => {
            focusPromptInput.placeholder = "What's your focus today?";
            focusPromptInput.classList.remove('input-error-temp');
        }, 2000);
    }
});

pauseSessionButton.addEventListener('click', () => {
    chrome.storage.local.get(['isSessionPaused', 'sessionFocus'], (result) => {
        if (!result.sessionFocus) return; // No active session

        if (result.isSessionPaused) {
            // Currently Paused, so Resume
            chrome.runtime.sendMessage({ type: "RESUME_SESSION" }, (response) => {
                console.log("popup.js: Response from RESUME_SESSION:", response); // Debug log
                if (response && response.status === 'resumed') {
                    chrome.storage.local.get(keysToFetch, updatePopupUI);
                }
            });
        } else {
            // Currently Active, so Pause
            chrome.runtime.sendMessage({ type: "PAUSE_SESSION" }, (response) => {
                console.log("popup.js: Response from PAUSE_SESSION:", response); // Debug log
                if (response && response.status === 'paused') {
                    chrome.storage.local.get(keysToFetch, updatePopupUI);
                }
            });
        }
    });
});

endSessionButton.addEventListener('click', () => {
    stopTimerInterval();
    // Clear all session related keys including timer and whitelist
    const keysToRemove = [
        'sessionFocus', 'lastAssessmentText', 'lastRelevantUrlForFocus', 
        'focusWhitelist', 'sessionStartTime', 'isSessionPaused', 'pausedElapsedTime',
        'pomodoroEnabled', 'pomodoroWorkDuration', 'pomodoroBreakDuration', 'pomodoroCurrentMode', 'pomodoroCycleEndTime' // Clear pomodoro state
    ];
    chrome.alarms.clearAll(); // Clear any pending pomodoro alarms
    chrome.storage.local.remove(keysToRemove, () => {
        updatePopupUI({}); // Pass empty object to signify no session
        chrome.runtime.sendMessage({ type: "SESSION_ENDED" });
        chrome.action.setIcon({ path: "icons/icon48.png" }); 
    });
});

stopPomodoroButton.addEventListener('click', () => {
    console.log("popup.js: Stop Pomodoro button CLICKED!");
    chrome.runtime.sendMessage({ type: "STOP_POMODORO_CYCLE" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Popup.js: Error sending/receiving STOP_POMODORO_CYCLE message:", chrome.runtime.lastError.message);
            pomodoroStatusDiv.textContent = "Error stopping. Check console.";
            return;
        }
        console.log("popup.js: Response from STOP_POMODORO_CYCLE:", response);
        if (response && response.status === 'pomodoro_stopped') {
            chrome.storage.local.get(keysToFetch, updatePopupUI);
        } else {
            console.warn("popup.js: STOP_POMODORO_CYCLE - Unexpected or no response:", response);
            pomodoroStatusDiv.textContent = "Failed to stop. Try again.";
        }
    });
});

// Upgrade button event listeners - both buttons use the same handler
upgradeButton.addEventListener('click', handleUpgradeClick);
upgradeButtonSmall.addEventListener('click', handleUpgradeClick);

// Listen for updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ASSESSMENT_RESULT_TEXT") {
        setRelevanceAppearance(message.assessmentText);
        chrome.storage.local.set({ lastAssessmentText: message.assessmentText });
        updateDailyTotalDisplay(); // Refresh daily total display as session activity might have changed it
    } else if (message.type === "POMODORO_MODE_CHANGED") {
        console.log("Popup: Received POMODORO_MODE_CHANGED", message);
        // Update storage based on message from background and refresh UI
        chrome.storage.local.set({
            pomodoroCurrentMode: message.mode,
            pomodoroCycleEndTime: message.endTime,
            pomodoroEnabled: true // ensure it stays enabled
        }, () => {
            chrome.storage.local.get(keysToFetch, updatePopupUI);
        });
    }
    // We might want to add listeners for PAUSED/RESUMED confirmation if background needs to update popup directly
    // But for now, popup re-fetches state after sending PAUSE/RESUME request.
}); 