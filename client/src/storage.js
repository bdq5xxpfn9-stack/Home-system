const KEY = 'familySession';

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
