// Get error message from URL parameters and display it
const urlParams = new URLSearchParams(window.location.search);
const errorMessage = urlParams.get('message');
if (errorMessage) {
  // Decode the error message and display it
  const decodedErrorMessage = decodeURIComponent(errorMessage);
  document.getElementById('error-message').textContent = decodedErrorMessage;
} else {
  document.getElementById('error-message').textContent = 'No error message available.';
}
