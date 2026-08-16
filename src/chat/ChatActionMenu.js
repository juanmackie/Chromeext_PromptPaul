/**
 * @fileoverview Accessible overflow menu behavior for the chat action dock.
 * @module ChatActionMenu
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

function getFocusableElements(container) {
  return Array.from(container?.querySelectorAll(FOCUSABLE_SELECTOR) || []).filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Initialize the compact chat action overflow menu.
 *
 * @param {HTMLElement} sidebar - Chat action dock root.
 * @returns {{open: Function, close: Function, destroy: Function}|null} Menu controls.
 */
export function initQuickActionsMenu(sidebar) {
  const trigger = sidebar?.querySelector('#quick-actions-more');
  const menu = sidebar?.querySelector('#quick-actions-menu');
  const closeButton = sidebar?.querySelector('#quick-actions-close');
  const indicator = sidebar?.querySelector('#quick-actions-indicator');
  const pinnedContainer = sidebar?.querySelector('#pinned-actions-container');
  if (!trigger || !menu) return null;

  let isOpen = false;

  function syncIndicator() {
    const hasActiveToggle = Boolean(menu.querySelector('[aria-pressed="true"]'));
    const hasPinnedAction = Boolean(pinnedContainer?.querySelector('button'));
    const isActive = hasActiveToggle || hasPinnedAction;

    if (indicator) indicator.hidden = !isActive;
    trigger.dataset.active = String(isActive);
  }

  function setOpen(nextOpen, { restoreFocus = true } = {}) {
    isOpen = Boolean(nextOpen);
    menu.hidden = !isOpen;
    trigger.setAttribute('aria-expanded', String(isOpen));

    if (isOpen) {
      const firstFocusable = getFocusableElements(menu)[0];
      firstFocusable?.focus();
    } else if (restoreFocus) {
      trigger.focus();
    }
  }

  function open() {
    setOpen(true);
  }

  function close(options) {
    setOpen(false, options);
  }

  function handleTriggerKeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  }

  function handleMenuKeydown(event) {
    const focusable = getFocusableElements(menu);
    const currentIndex = focusable.indexOf(document.activeElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'Tab') {
      close({ restoreFocus: false });
      return;
    }

    if (!focusable.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % focusable.length;
    if (event.key === 'ArrowUp')
      nextIndex = (currentIndex - 1 + focusable.length) % focusable.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = focusable.length - 1;
    focusable[nextIndex]?.focus();
  }

  function handleDocumentClick(event) {
    const target = event.target;
    if (!isOpen || !(target instanceof Element)) return;
    if (menu.contains(target) || trigger.contains(target)) return;
    close();
  }

  function handleMenuAction(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const shouldClose =
      target.closest('[data-close-quick-actions]') ||
      target.closest('#pinned-actions-container button');
    if (shouldClose) setTimeout(() => close(), 0);
  }

  trigger.addEventListener('click', () => (isOpen ? close() : open()));
  trigger.addEventListener('keydown', handleTriggerKeydown);
  closeButton?.addEventListener('click', () => close());
  menu.addEventListener('keydown', handleMenuKeydown);
  menu.addEventListener('click', handleMenuAction);
  document.addEventListener('click', handleDocumentClick);

  const observer = new MutationObserver(syncIndicator);
  observer.observe(menu, {
    attributes: true,
    attributeFilter: ['aria-pressed'],
    childList: true,
    subtree: true,
  });
  syncIndicator();

  return {
    open,
    close,
    destroy() {
      observer.disconnect();
      trigger.removeEventListener('keydown', handleTriggerKeydown);
      menu.removeEventListener('keydown', handleMenuKeydown);
      menu.removeEventListener('click', handleMenuAction);
      document.removeEventListener('click', handleDocumentClick);
    },
  };
}
