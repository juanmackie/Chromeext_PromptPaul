document.addEventListener('DOMContentLoaded', () => {
  const openChatPanelButton = document.getElementById('openChatPanel');

  if (openChatPanelButton) {
    openChatPanelButton.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    });
  }
});