// Applies the saved theme before first paint (external file so it passes a strict CSP).
try {
  var t = localStorage.getItem('as-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
