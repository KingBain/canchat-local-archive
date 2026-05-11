(() => {
  chrome.runtime.sendMessage({ type: "canchat-page-loaded", href: location.href });
})();