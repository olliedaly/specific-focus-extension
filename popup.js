const focusPromptInput = document.getElementById('focusPrompt');
const startSessionButton = document.getElementById('startSession');
const endSessionButton = document.getElementById('endSession');
const statusDiv = document.getElementById('status');
const relevanceDiv = document.getElementById('relevance');

function updatePopupUI(sessionFocus, lastAssessmentText) {
    if (sessionFocus) {
        focusPromptInput.value = sessionFocus;
        statusDiv.textContent = `Focus: ${sessionFocus}`;
        startSessionButton.style.display = 'none';
        endSessionButton.style.display = 'block';
        if (lastAssessmentText) {
            relevanceDiv.textContent = `Last page: ${lastAssessmentText}`;
        } else {
            relevanceDiv.textContent = 'Monitoring...';
        }
    } else {
        focusPromptInput.value = '';
        statusDiv.textContent = 'No active session.';
        relevanceDiv.textContent = '';
        startSessionButton.style.display = 'block';
        endSessionButton.style.display = 'none';
    }
}

// Load current focus from storage when popup opens
chrome.storage.local.get(['sessionFocus', 'lastAssessmentText'], (result) => {
    updatePopupUI(result.sessionFocus, result.lastAssessmentText);
});

startSessionButton.addEventListener('click', () => {
    const focus = focusPromptInput.value.trim();
    if (focus) {
        chrome.storage.local.set({ sessionFocus: focus, lastAssessmentText: null }, () => {
            updatePopupUI(focus, null);
            chrome.runtime.sendMessage({ type: "SESSION_STARTED", focus: focus });
        });
    } else {
        statusDiv.textContent = 'Please enter a focus.';
    }
});

endSessionButton.addEventListener('click', () => {
    chrome.storage.local.remove(['sessionFocus', 'lastAssessmentText'], () => {
        updatePopupUI(null, null);
        chrome.runtime.sendMessage({ type: "SESSION_ENDED" });
        chrome.action.setIcon({ path: "icons/icon48.png" }); // Reset icon
    });
});

// Listen for updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ASSESSMENT_RESULT_TEXT") {
        relevanceDiv.textContent = `Page: ${message.assessmentText}`;
        // Icon update is handled by background.js
        // Potentially update storage if needed, though background should be source of truth for lastAssessmentText
        chrome.storage.local.set({ lastAssessmentText: message.assessmentText });
    }
}); 