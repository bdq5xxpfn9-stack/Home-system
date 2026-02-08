self.addEventListener('push', (event) => {
  let data = { title: 'Familienplan', body: 'Neue Benachrichtigung.' };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch (err) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    data: data.data || {},
    icon: '/icon.svg',
    badge: '/icon.svg'
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Familienplan', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        const client = clientList[0];
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
