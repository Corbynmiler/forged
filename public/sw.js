// Forged Service Worker — handles push notifications

self.addEventListener("push", function (event) {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: "Forged", body: event.data.text() };
  }

  const options = {
    body: data.body || "Time to log your habits \uD83D\uDD25",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    vibrate: [150, 80, 150],
    requireInteraction: false,
    tag: "forged-reminder", // replaces any previous unread reminder
    renotify: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Forged", options)
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
