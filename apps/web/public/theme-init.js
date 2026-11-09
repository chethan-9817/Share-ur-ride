// ArriveShare uses a single light theme. Clear any dark preference saved by older versions.
try {
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('as-theme');
} catch (e) {}
