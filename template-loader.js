// Template loader for options page
// Loads template sections dynamically to avoid inline scripts

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Load instructions section
    const instructionsResponse = await fetch('templates/options-instructions.html');
    const instructionsHtml = await instructionsResponse.text();
    document.getElementById('instructions-section').innerHTML = instructionsHtml;
    
    // Load tools section
    const toolsResponse = await fetch('templates/options-tools.html');
    const toolsHtml = await toolsResponse.text();
    document.getElementById('tools-section').innerHTML = toolsHtml;
    
    // Dispatch event to notify that templates are loaded
    document.dispatchEvent(new CustomEvent('templatesLoaded'));
    
  } catch (error) {
    console.error('Error loading templates:', error);
  }
});