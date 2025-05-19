## Privacy Policy for Focus Monitor Pro

**Last Updated:** 2025-05-19

Thank you for using Specific Focus (the "Extension"), provided by Oliver Daly ("we," "us," or "our"). This Privacy Policy explains how we handle information when you use our Extension.

We are committed to protecting your privacy and ensuring transparency. By using the Extension, you agree to the handling of your information as described in this policy.

### 1. Information We Handle

The Extension handles the following types of information to provide its core functionality:

*   **Web Page Content (Transmitted to Backend):**
    *   **URL of visited web pages:** To identify the page being assessed.
    *   **Title of visited web pages:** As part of the content for relevance assessment.
    *   **Meta Description of visited web pages:** As part of the content for relevance assessment.
    *   **Text Snippet of visited web pages:** A portion of the main text content of the page, extracted for relevance assessment.
    *   **User-Defined Session Focus:** The keyword or phrase you provide as your current focus.
*   **Authentication Information (Transmitted to Backend):**
    *   **OAuth 2.0 Token:** An authentication token is obtained using Chrome's `identity` API. This token is sent to our backend service (`https://specific-focus-backend-1056415616503.europe-west1.run.app`) solely to verify that requests are coming from an authentic instance of the Extension. We do not retrieve or store personal details from your Google account via this token beyond this verification purpose.
*   **Locally Stored Information (Not Transmitted Externally, except "Session Focus" as noted above):**
    *   **Session Focus:** Your current focus keyword/phrase.
    *   **Focus Whitelist:** A list of URLs you explicitly mark as always relevant.
    *   **Last Relevant URL:** The URL of the last page deemed relevant to your focus.
    *   **Last Assessment Result:** The most recent relevance assessment for a page (e.g., "Relevant," "Irrelevant").
    *   **Pomodoro Timer Settings:** Work duration, break duration, enabled status, and current cycle state.
    *   **Session Timer States:** Information related to tracking your active focus time, such as start times and paused durations.
    *   **Daily Focus Time:** Aggregated focus time for the day.

### 2. How We Use Information

The information handled by the Extension is used for the following purposes:

*   **To Provide Core Functionality:**
    *   The URL, title, meta description, text snippet of visited pages, and your session focus are sent to our secure backend service. This service processes the information to assess its relevance to your session focus.
    *   To display the relevance assessment (e.g., by changing the Extension icon).
    *   To trigger features like the "Off Focus" modal and the "Go Back to Focus" button.
*   **To Authenticate Requests:**
    *   The OAuth 2.0 token is used to ensure that only legitimate requests from the Extension reach our backend service.
*   **To Store Your Preferences and Session State Locally:**
    *   Your session focus, whitelist, Pomodoro settings, and other operational data are stored locally on your device using `chrome.storage.local` to maintain your settings and the Extension's state across browsing sessions.

### 3. Data Transmission and Backend Processing

*   Web page content (URL, title, meta description, text snippet) and your session focus, along with the authentication token, are transmitted securely via HTTPS to our backend service hosted on Google Cloud Run at `https://specific-focus-backend-1056415616503.europe-west1.run.app/classify`.
*   This data is processed by the backend *solely for the purpose of immediate relevance classification*.
*   **We do not store the content of the web pages you visit or your session focus on our backend servers after the classification request is completed.**

### 4. Data Storage and Retention

*   **Backend:** As stated above, data sent to the backend for classification is not stored long-term.
*   **Locally:** Information stored using `chrome.storage.local` (session focus, whitelist, settings, etc.) remains on your device until you clear your browser's extension data, uninstall the Extension, or the Extension itself modifies/clears it as part of its functionality (e.g., ending a session).

### 5. Data Sharing with Third Parties

We do not sell, trade, or otherwise transfer your information to outside third parties, except as described below:

*   **Backend Service Provider:** We use Google Cloud Run to host our backend service. Google Cloud's terms and privacy policies apply to the infrastructure they provide.
*   We will not share your data with any other third parties unless required by law.

### 6. Security

We take reasonable measures to protect the information handled by our Extension:

*   All communication with our backend service is encrypted using HTTPS.
*   Requests to our backend are authenticated to prevent unauthorized access.
*   Locally stored data is protected by your browser's security mechanisms.

However, no method of transmission over the Internet or electronic storage is 100% secure. Therefore, while we strive to use commercially acceptable means to protect your information, we cannot guarantee its absolute security.

### 7. Your Choices

*   You can manage your "session focus" directly within the Extension.
*   You can manage your "focus whitelist" through the modal provided by the Extension.
*   You can clear locally stored data by managing the Extension's data through your browser settings or by uninstalling the Extension.

### 8. Children's Privacy

The Extension is not intended for use by children under the age of 13. We do not knowingly collect any personally identifiable information from children under 13.

### 9. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy within the Extension or on its Chrome Web Store listing. You are advised to review this Privacy Policy periodically for any changes. Changes to this Privacy Policy are effective when they are posted.

### 10. Contact Us

If you have any questions about this Privacy Policy, please contact us at:
olliedaly1995@gmail.com 