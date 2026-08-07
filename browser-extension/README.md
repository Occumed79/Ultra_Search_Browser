# Ultra Search Browser Companion

This Chrome/Chromium extension is the retrieval transport for Ultra Search Browser.

Ultra Search **does not need search API keys** for its core workflow. The web app builds targeted Occu-Med procurement queries; this extension runs those queries as ordinary browser searches, reads the visible search-result cards, and returns the raw candidates to Ultra Search for filtering, ranking, validation, and feedback learning.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome, Edge, Brave, or another Chromium browser.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the `browser-extension` folder from this repository.
6. Open `https://ultra-search-browser.onrender.com` and search normally.

The extension does not store or require Serper, Tavily, Exa, Brave Search API, Gemini, SAM.gov, or OpenAI API keys.

## How it works

1. Ultra Search creates a deterministic Occu-Med search plan.
2. The extension opens ordinary search-result pages in background tabs.
3. It extracts only result titles, destination URLs, and visible snippets.
4. The background tabs are closed.
5. Raw result cards are returned to Ultra Search.
6. Ultra Search applies the Occu-Med intent gate, junk rejection, relevance filtering, feedback ranking, and deep destination-page validation.

Search APIs may remain in the repository as optional/legacy accelerators, but they are not part of the browser-fed default path.
