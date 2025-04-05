// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showResponse') {
      // Display the response in the popup
      const responseElement = document.getElementById('response');
      responseElement.textContent = request.response;
      addActionButtons();
    }
  });
  
  // Request the latest response when the popup is opened
  chrome.runtime.sendMessage({ action: 'getResponse' }, (response) => {
    if (response) {
      const responseElement = document.getElementById('response');
      responseElement.textContent = response;
      addActionButtons();
    }
  });

  // Add edit and delete buttons
  function addActionButtons() {
    const container = document.getElementById('response-container');
    
    // Remove existing buttons if they exist
    const existingButtons = container.querySelectorAll('.action-button');
    existingButtons.forEach(button => button.remove());

    // Create edit button
    const editButton = document.createElement('button');
    editButton.textContent = 'Edit';
    editButton.className = 'action-button';
    editButton.addEventListener('click', () => {
      const responseElement = document.getElementById('response');
      const currentText = responseElement.textContent;
      const newText = prompt('Edit your message:', currentText);
      if (newText !== null) {
        responseElement.textContent = newText;
        chrome.runtime.sendMessage({ action: 'updateResponse', response: newText });
      }
    });

    // Create delete button
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.className = 'action-button';
    deleteButton.addEventListener('click', () => {
      if (confirm('Are you sure you want to delete this message?')) {
        const responseElement = document.getElementById('response');
        responseElement.textContent = '';
        chrome.runtime.sendMessage({ action: 'deleteResponse' });
      }
    });

    // Add buttons to container
    container.appendChild(editButton);
    container.appendChild(deleteButton);
  }