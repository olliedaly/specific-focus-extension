const focusPromptInput = document.getElementById('focusPrompt');
const startSessionButton = document.getElementById('startSession');
const endSessionButton = document.getElementById('endSession');
const statusDiv = document.getElementById('status');
const relevanceDiv = document.getElementById('relevance');
const sessionTimerDiv = document.getElementById('sessionTimer');
const pauseSessionButton = document.getElementById('pauseSessionButton');
const dailyTotalDisplayDiv = document.getElementById('dailyTotalDisplay');

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
        // console.log("popup.js - updatePomodoroTimerDisplay - Storage result:", result); // Debug log
        if (result.pomodoroEnabled && result.pomodoroCycleEndTime && result.pomodoroCurrentMode) {
            const now = Date.now();
            const timeLeftMs = result.pomodoroCycleEndTime - now;
            // console.log("popup.js - updatePomodoroTimerDisplay - now:", now, "endTime:", result.pomodoroCycleEndTime, "timeLeftMs:", timeLeftMs); // Debug log
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
        // console.log("popup.js - Pomodoro interval tick"); // Debug log
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
    // console.log("popup.js - updatePomodoroUI - Data:", pomodoroData); // Debug log

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
    // console.log("popup.js - updatePopupUI - Passed Pomodoro Data:", { pomodoroEnabled, pomodoroWorkDuration, pomodoroBreakDuration, pomodoroCurrentMode, pomodoroCycleEndTime }); // Debug Log

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
});

startSessionButton.addEventListener('click', () => {
    const focus = focusPromptInput.value.trim();
    if (focus) {
        const initialSessionState = {
            sessionFocus: focus,
            lastAssessmentText: null,
            sessionStartTime: Date.now(),
            isSessionPaused: false,
            pausedElapsedTime: 0,
            lastRelevantUrlForFocus: null // From previous logic
        };
        const pomodoroDefaults = {
            pomodoroEnabled: false,
            pomodoroWorkDuration: 25,
            pomodoroBreakDuration: 5,
            pomodoroCurrentMode: null,
            pomodoroCycleEndTime: null
        };
        const fullInitialState = {...initialSessionState, ...pomodoroDefaults };

        chrome.storage.local.set(fullInitialState, () => {
            updatePopupUI(fullInitialState);
            chrome.runtime.sendMessage({ type: "SESSION_STARTED", focus: focus });
        });
    } else {
        // Simple feedback, could be improved with a dedicated error message element
        focusPromptInput.placeholder = 'Please enter a focus first!';
        focusPromptInput.classList.add('input-error-temp'); // Add a class for temp error indication
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