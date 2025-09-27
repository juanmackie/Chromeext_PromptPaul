// ===== Chat UI Rendering =====

import { loadingManager } from './loadingManager.js';

class ChatUIRenderer {
  constructor(chatArea) {
    this.chatArea = chatArea;
  }

  showToast(message) {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentNode === toastContainer) {
          toastContainer.removeChild(toast);
        }
        if (toastContainer.children.length === 0 && toastContainer.parentNode) {
          toastContainer.parentNode.removeChild(toastContainer);
        }
      }, 500);
    }, 2500);
  }

  // This method is now deprecated as event listeners are attached directly in addCopyIcons
  // Keeping for backward compatibility
  // However, the event listeners should not be added again if they already exist
  attachCopyListeners(rawMessage, contentElement, copyIconElement, copyFormattedIconElement) {
    if (copyIconElement) {
      // Remove any existing click listeners to avoid duplicates
      const newCopyIcon = copyIconElement.cloneNode(true);
      if (copyIconElement.parentNode) {
        copyIconElement.parentNode.replaceChild(newCopyIcon, copyIconElement);
      }
      // Add the new icon with listener to copy raw text
      newCopyIcon.addEventListener('click', (event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(rawMessage)
          .then(() => this.showToast('Copied raw text to clipboard'))
          .catch(err => {
            console.error('Failed to copy raw text: ', err);
            this.showToast('Error copying raw text.');
          });
      });
    }
    
    if (copyFormattedIconElement) {
      // Remove any existing click listeners to avoid duplicates
      const newFormattedCopyIcon = copyFormattedIconElement.cloneNode(true);
      if (copyFormattedIconElement.parentNode) {
        copyFormattedIconElement.parentNode.replaceChild(newFormattedCopyIcon, copyFormattedIconElement);
      }
      // Add the new icon with listener to copy formatted text
      newFormattedCopyIcon.addEventListener('click', (event) => {
        event.stopPropagation();
        const htmlContent = contentElement.innerHTML;
        navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlContent], { type: 'text/html' }),
            'text/plain': new Blob([rawMessage], { type: 'text/plain' })
          })
        ]).then(() => this.showToast('Copied formatted text to clipboard'))
          .catch(err => {
            console.error('Failed to copy formatted text: ', err);
            navigator.clipboard.writeText(rawMessage)
              .then(() => this.showToast('Copied (plain text fallback) to clipboard'))
              .catch(errFallback => {
                console.error('Failed to copy plain text fallback: ', errFallback);
                this.showToast('Error copying text.');
              });
          });
      });
    }
  }

  addMessage(sender, message) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    let contentElement = messageDiv;
    let uniqueIdString = '';

    if (sender === 'User') {
      messageDiv.classList.add('user-message');
      messageDiv.textContent = 'You: ' + message;
    } else if (sender === 'System') {
      messageDiv.classList.add('system-message');
      messageDiv.textContent = 'System: ' + message;
    } else if (sender === 'LLM') {
      messageDiv.classList.add('llm-message');
      const llmContentSpan = document.createElement('span');
      llmContentSpan.classList.add('llm-content-area');
      
      // Ensure marked.parse is available or handle potential errors
      if (typeof marked !== 'undefined') {
        llmContentSpan.innerHTML = marked.parse(message || "");
      } else {
        llmContentSpan.textContent = message || "";
      }
      
      messageDiv.appendChild(llmContentSpan);
      contentElement = llmContentSpan;
      uniqueIdString = Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // Add copy icons for LLM messages
      this.addCopyIcons(messageDiv, uniqueIdString, message, contentElement);
    } else {
      messageDiv.textContent = message;
    }
    
    this.chatArea.appendChild(messageDiv);
    this.scrollToBottom();
    
    return { messageDiv, contentElement, uniqueIdString };
  }

  addCopyIcons(messageDiv, uniqueIdString, message, contentElement) {
    // Raw text copy icon
    const copyIcon = document.createElement('img');
    copyIcon.id = `copy-icon-${uniqueIdString}`;
    copyIcon.src = document.body.classList.contains('dark-theme') 
      ? 'icons/light_copy markdown.png' 
      : 'icons/copy markdown.png';
    copyIcon.alt = "Copy Raw";
    copyIcon.style.cssText = "cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";

    // Formatted text copy icon
    const copyFormattedIcon = document.createElement('img');
    copyFormattedIcon.id = `copy-formatted-icon-${uniqueIdString}`;
    const formattedIconSrc = document.body.classList.contains('dark-theme') 
      ? 'icons/light_copy formatted.png' 
      : 'icons/copy formatted.png';
    copyFormattedIcon.src = formattedIconSrc;
    copyFormattedIcon.alt = "Copy Formatted";
    copyFormattedIcon.style.cssText = "cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";

    // Add icons to a container to maintain consistent order
    const copyIconsContainer = document.createElement('div');
    copyIconsContainer.classList.add('copy-icons-container');
    copyIconsContainer.style.cssText = "display: flex; gap: 5px; margin-top: 5px;";

    copyIconsContainer.appendChild(copyIcon);
    copyIconsContainer.appendChild(copyFormattedIcon);
    messageDiv.appendChild(copyIconsContainer);

    if (message) {
      // Directly attach listeners to the created elements instead of cloning
      copyIcon.addEventListener('click', (event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(message)
          .then(() => this.showToast('Copied raw text to clipboard'))
          .catch(err => {
            console.error('Failed to copy raw text: ', err);
            this.showToast('Error copying raw text.');
          });
      });
      
      copyFormattedIcon.addEventListener('click', (event) => {
        event.stopPropagation();
        const htmlContent = contentElement.innerHTML;
        navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlContent], { type: 'text/html' }),
            'text/plain': new Blob([message], { type: 'text/plain' })
          })
        ]).then(() => this.showToast('Copied formatted text to clipboard'))
          .catch(err => {
            console.error('Failed to copy formatted text: ', err);
            navigator.clipboard.writeText(message)
              .then(() => this.showToast('Copied (plain text fallback) to clipboard'))
              .catch(errFallback => {
                console.error('Failed to copy plain text fallback: ', errFallback);
                this.showToast('Error copying text.');
              });
          });
      });
    }
  }

  addMediaPreview(mediaData) {
    const previewDiv = document.createElement('div');
    previewDiv.classList.add('media-preview');
    previewDiv.style.cssText = `
      margin: 10px 0;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background-color: #f9f9f9;
    `;

    if (mediaData.type === 'image') {
      const img = document.createElement('img');
      img.src = `data:${mediaData.mimeType};base64,${mediaData.base64}`;
      img.style.cssText = `
        max-width: 300px;
        max-height: 200px;
        border-radius: 4px;
        display: block;
        margin-bottom: 5px;
      `;
      previewDiv.appendChild(img);
    }

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'font-size: 12px; color: #666;';
    infoDiv.textContent = `📎 ${mediaData.type.toUpperCase()} - ${mediaData.url || 'Unknown source'}`;
    previewDiv.appendChild(infoDiv);

    this.chatArea.appendChild(previewDiv);
    this.scrollToBottom();
  }

  updateStreamingContent(content, isComplete = false) {
    // This method would be called by streaming handlers
    // Implementation depends on current streaming state
  }

  enableInputs(userInput, sendButton) {
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }

  disableInputs(userInput, sendButton) {
    userInput.disabled = true;
    sendButton.disabled = true;
  }

  updateClearButton(clearButton, text = 'Clear') {
    if (clearButton) {
      clearButton.textContent = text;
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    }, 10);
  }

  switchToMainArea(chatMainArea, oneoffInstructionArea) {
    chatMainArea.style.display = 'block';
    oneoffInstructionArea.style.display = 'none';
  }

  switchToOneoffArea(chatMainArea, oneoffInstructionArea) {
    chatMainArea.style.display = 'none';
    oneoffInstructionArea.style.display = 'block';
  }

  clearChat() {
    this.chatArea.innerHTML = '';
  }
}

export { ChatUIRenderer };