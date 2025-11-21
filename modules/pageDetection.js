// ============================================================================
// PAGE DETECTION MODULE
// ============================================================================
// Detects page type and provides page-specific utilities

// Detect page type and adjust behavior accordingly
function detectPageType() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  
  if (hostname.includes('docs.google.com')) {
    return 'google-docs';
  } else if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) {
    return 'chatgpt';
  } else if (hostname.includes('gemini.google.com') || hostname.includes('bard.google.com')) {
    return 'gemini';
  } else if (hostname.includes('gmail.com')) {
    return 'gmail';
  } else {
    return 'general-web';
  }
}

// Export to global namespace
window.PIIExtension = window.PIIExtension || {};
window.PIIExtension.pageDetection = {
    detectPageType
};

