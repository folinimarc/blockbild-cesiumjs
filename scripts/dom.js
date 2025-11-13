/**
 * Collects DOM references used across the application.
 * @returns {{
 *   header: HTMLElement,
 *   infoPanel: HTMLElement,
 *   mapPanel: HTMLElement,
 *   mapResizer: HTMLElement,
 *   viewer: HTMLElement,
 *   shareButton: HTMLButtonElement,
 *   shareOverlay: HTMLElement,
 *   shareUrlInput: HTMLInputElement,
 *   shareCopyButton: HTMLButtonElement,
 *   shareCheckbox: HTMLInputElement,
 *   shareFeedback: HTMLOutputElement,
 *   mapPlaceholder: HTMLButtonElement
 * }}
 */
export function queryDom() {
  return {
    header: document.getElementById('map-panel-header'),
    infoPanel: document.getElementById('info-panel'),
    mapPanel: document.getElementById('map-panel'),
    mapResizer: document.getElementById('map-panel-resizer'),
    viewer: document.getElementById('cesiumContainer'),
    shareButton: document.getElementById('share-button'),
    shareOverlay: document.getElementById('share-overlay'),
    shareUrlInput: document.getElementById('share-url-input'),
    shareCopyButton: document.getElementById('share-copy-button'),
    shareCheckbox: document.getElementById('share-hide-map'),
    shareFeedback: document.getElementById('share-feedback'),
    mapPlaceholder: document.getElementById('map-placeholder'),
  };
}

/**
 * Updates the instruction banner inside the map panel header.
 * @param {ReturnType<typeof queryDom>} dom
 * @param {Record<string, string>} messages
 * @param {string} type
 */
export function setPanelMessage(dom, messages, type) {
  const message = messages[type] ?? messages.idle;
  dom.header.innerHTML = message;
}

/**
 * Reveals the onboarding info panel overlay.
 * @param {ReturnType<typeof queryDom>} dom
 */
export function showInfoPanel(dom) {
  dom.infoPanel.classList.remove('is-hidden');
}

/**
 * Removes the onboarding info panel overlay from the DOM.
 * @param {ReturnType<typeof queryDom>} dom
 */
export function hideInfoPanel(dom) {
  dom.infoPanel.remove();
  dom.infoPanel = null;
}
