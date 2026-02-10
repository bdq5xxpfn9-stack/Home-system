const isProd = import.meta.env.PROD;
const API_BASE = isProd ? '' : import.meta.env.VITE_API_BASE || 'http://localhost:5174';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const data = await res.json();
  if (!res.ok) {
    const message = data?.error || 'Unbekannter Fehler.';
    throw new Error(message);
  }
  return data;
}

export function joinHousehold(payload) {
  return request('/api/households/join', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchMembers(householdId) {
  return request(`/api/households/${householdId}/members`);
}

export function addMember(householdId, payload) {
  return request(`/api/households/${householdId}/members`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function resetMemberColors(householdId) {
  return request(`/api/households/${householdId}/reset-colors`, {
    method: 'POST'
  });
}

export function deleteMember(memberId) {
  return request(`/api/members/${memberId}`, {
    method: 'DELETE'
  });
}

export function fetchTasks(householdId) {
  return request(`/api/households/${householdId}/tasks`);
}

export function createTask(householdId, payload) {
  return request(`/api/households/${householdId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateTask(taskId, payload) {
  return request(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function completeTask(taskId, payload) {
  return request(`/api/tasks/${taskId}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function deleteTask(taskId) {
  return request(`/api/tasks/${taskId}`, {
    method: 'DELETE'
  });
}

export function fetchLists(householdId) {
  return request(`/api/households/${householdId}/lists`);
}

export function createList(householdId, payload) {
  return request(`/api/households/${householdId}/lists`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function createListItem(listId, payload) {
  return request(`/api/lists/${listId}/items`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateListItem(itemId, payload) {
  return request(`/api/list-items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteListItem(itemId) {
  return request(`/api/list-items/${itemId}`, {
    method: 'DELETE'
  });
}

export function deleteList(listId) {
  return request(`/api/lists/${listId}`, {
    method: 'DELETE'
  });
}

export function fetchPushPublicKey() {
  return request('/api/push/public-key');
}

export function savePushSubscription(memberId, subscription) {
  return request(`/api/members/${memberId}/push-subscription`, {
    method: 'POST',
    body: JSON.stringify({ subscription })
  });
}

export function sendPushTest(memberId) {
  return request(`/api/members/${memberId}/push-test`, {
    method: 'POST'
  });
}

export { API_BASE };
