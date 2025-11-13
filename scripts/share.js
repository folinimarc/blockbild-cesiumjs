import { URL_PARAM_SHARE } from './config.js';
import { isValidExtent, normalizeExtent } from './extent.js';

/**
 * Creates the share overlay controller responsible for link generation and challenge mode.
 * @param {{ dom: ReturnType<typeof import('./dom.js').queryDom>, state: typeof import('./state.js').state }} context
 */
export function createShareController({ dom, state }) {
  let shareOverlayReturnFocus = null;

  function initialize() {
    dom.mapPlaceholder.addEventListener('click', handleMapPlaceholderClick);
    dom.shareButton.addEventListener('click', openShareOverlay);
    dom.shareOverlay.addEventListener('click', handleShareOverlayClick);
    dom.shareOverlay.setAttribute('aria-hidden', 'true');
    dom.shareCheckbox.addEventListener('change', handleShareHideMapChange);
    dom.shareCopyButton.addEventListener('click', handleShareCopy);
    dom.shareUrlInput.value = '';

    document.addEventListener('keydown', handleShareKeyDown);
    updateShareAvailability();
  }

  function handleBlockGenerated(extent) {
    state.currentExtent = extent;
    updateShareAvailability();

    if (isShareOverlayOpen()) {
      updateShareUrlPreview();
    }
  }

  function applyChallengeMode(hideMap) {
    state.isChallengeMode = Boolean(hideMap);
    state.shareOverlayOptions.hideMap = Boolean(hideMap);

    dom.mapPanel.classList.toggle('map-panel--hidden', state.isChallengeMode);
    dom.mapPlaceholder.classList.toggle('is-hidden', !state.isChallengeMode);

    updateShareAvailability();
  }

  function getShareConfigFromUrl() {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(URL_PARAM_SHARE);

    if (!raw) {
      return null;
    }

    const payload = decodeShareToken(raw);
    if (!payload || !isValidExtent(payload.extent)) {
      return null;
    }

    state.shareOverlayOptions.hideMap = Boolean(payload.hideMap);

    return {
      extent: normalizeExtent(payload.extent),
      hideMap: Boolean(payload.hideMap),
    };
  }

  function openShareOverlay(event) {
    if (dom.shareButton.disabled) {
      event?.preventDefault();
      return;
    }

    if (!state.currentExtent) {
      return;
    }

    shareOverlayReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    dom.shareCheckbox.checked = state.shareOverlayOptions.hideMap;

    clearShareFeedback();
    updateShareUrlPreview();

    dom.shareOverlay.classList.add('is-open');
    dom.shareOverlay.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
      dom.shareUrlInput.select();
      dom.shareUrlInput.focus();
    });
  }

  function closeShareOverlay() {
    dom.shareOverlay.classList.remove('is-open');
    dom.shareOverlay.setAttribute('aria-hidden', 'true');
    clearShareFeedback();

    if (shareOverlayReturnFocus && typeof shareOverlayReturnFocus.focus === 'function') {
      shareOverlayReturnFocus.focus();
    }

    shareOverlayReturnFocus = null;
  }

  function handleShareOverlayClick(event) {
    if (!isShareOverlayOpen()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.shareDismiss !== undefined) {
      event.preventDefault();
      closeShareOverlay();
    }
  }

  function handleShareKeyDown(event) {
    if (event.key !== 'Escape' || !isShareOverlayOpen()) {
      return;
    }

    event.preventDefault();
    closeShareOverlay();
  }

  function handleShareHideMapChange() {
    state.shareOverlayOptions.hideMap = dom.shareCheckbox.checked;
    updateShareUrlPreview();
  }

  async function handleShareCopy() {
    const value = dom.shareUrlInput.value.trim();
    if (!value) {
      showShareFeedback('Generate a block first to share.');
      return;
    }

    try {
      await copyTextToClipboard(value);
      showShareFeedback('Link copied to clipboard.');
    } catch (error) {
      console.error('Error copying share link:', error);
      showShareFeedback('Copy failed. Select and copy manually.');
    }
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      dom.shareUrlInput.select();
      const successful = document.execCommand('copy');
      dom.shareUrlInput.setSelectionRange(0, 0);

      if (successful) {
        resolve();
      } else {
        reject(new Error('execCommand copy failed.'));
      }
    });
  }

  function handleMapPlaceholderClick() {
    const url = new URL(window.location.href);
    window.location.assign(`${url.origin}${url.pathname}`);
  }

  function updateShareAvailability() {
    const shouldEnable = Boolean(state.currentExtent) && !state.isChallengeMode;
    setShareButtonEnabled(shouldEnable);
  }

  function setShareButtonEnabled(enabled) {
    dom.shareButton.disabled = !enabled;
    dom.shareButton.setAttribute('aria-disabled', String(!enabled));
  }

  function isShareOverlayOpen() {
    return dom.shareOverlay.classList.contains('is-open');
  }

  function updateShareUrlPreview() {
    if (!state.currentExtent) {
      dom.shareUrlInput.value = '';
      return;
    }

    const hideMap = dom.shareCheckbox.checked;
    const shareUrl = buildShareUrl({ hideMap });
    dom.shareUrlInput.value = shareUrl ?? '';
  }

  function buildShareUrl({ hideMap }) {
    if (!state.currentExtent) {
      return null;
    }

    const payload = {
      extent: state.currentExtent,
      hideMap: Boolean(hideMap),
    };

    const token = encodeShareToken(payload);
    if (!token) {
      return null;
    }

    const url = new URL(window.location.href);
    url.searchParams.set(URL_PARAM_SHARE, token);
    return url.toString();
  }

  function encodeShareToken(payload) {
    try {
      const serialized = JSON.stringify(payload);
      const reversed = serialized.split('').reverse().join('');
      return btoa(reversed).replace(/=+$/u, '');
    } catch (error) {
      console.error('Error encoding share token:', error);
      return null;
    }
  }

  function decodeShareToken(token) {
    try {
      const padded = padBase64(token);
      const reversed = atob(padded);
      const restored = reversed.split('').reverse().join('');
      return JSON.parse(restored);
    } catch (error) {
      console.error('Error decoding share token:', error);
      return null;
    }
  }

  function padBase64(value) {
    const remainder = value.length % 4;
    if (remainder === 0) {
      return value;
    }

    return `${value}${'='.repeat(4 - remainder)}`;
  }

  function showShareFeedback(message) {
    dom.shareFeedback.textContent = message;
  }

  function clearShareFeedback() {
    showShareFeedback('');
  }

  function clearShareUrlParam() {
    const url = new URL(window.location.href);

    if (!url.searchParams.has(URL_PARAM_SHARE)) {
      return;
    }

    url.searchParams.delete(URL_PARAM_SHARE);
    const nextUrl = `${url.origin}${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }

  return {
    initialize,
    handleBlockGenerated,
    applyChallengeMode,
    getShareConfigFromUrl,
    clearShareUrlParam,
  };
}
