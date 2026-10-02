// App Health browser logs. Public, origin-pinned key; nothing here is secret.
// Logs form submits, clicks on [data-log] elements, and client errors to the
// Logs tab at health.sassmaker.com. window.appHealthLog(event, options) is
// available for custom events. Source: app-health/examples/dropin-log-client.
(function () {
  var KEY = 'ahk_pub_5fd468bae12640af79faa6aa53f76cc7e453914551888aed55e73f0a7d762417',
    ENV = 'production',
    URL = 'https://ingest.sassmaker.com/v1/logs';
  // No-op until a browser public key (ahk_pub_...) is provisioned above.
  if (KEY.indexOf('ahk_pub_') !== 0) return;
  function id() {
    return crypto.randomUUID();
  }
  function send(event, o) {
    o = o || {};
    var props = {},
      src = o.props || {};
    for (var k in src)
      if (src[k] !== undefined)
        props[k] = typeof src[k] === 'string' ? src[k].slice(0, 500) : src[k];
    var body = JSON.stringify({
      public_key: KEY,
      batch_id: id(),
      schema_version: 'v1',
      environment: ENV,
      logs: [
        {
          log_id: id(),
          timestamp: Date.now(),
          event: event,
          level: o.level || 'info',
          title: o.title,
          description: o.description,
          icon: o.icon,
          props: props,
        },
      ],
    });
    if (document.visibilityState === 'hidden' && navigator.sendBeacon) {
      navigator.sendBeacon(URL, new Blob([body], { type: 'text/plain' }));
      return;
    }
    fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: body,
      keepalive: true,
    }).catch(function () {});
  }
  window.appHealthLog = send;
  function track(name) {
    if (window.appHealth && typeof window.appHealth.track === 'function') window.appHealth.track(name);
  }
  document.addEventListener(
    'submit',
    function (e) {
      var f = e.target;
      if (!f || f.tagName !== 'FORM') return;
      var eventName = f.getAttribute('data-app-health-event');
      if (eventName && (!f.querySelector('[type="search"]') || f.querySelector('[type="search"]').value.trim())) track(eventName);
      send('form.submitted', {
        title: f.id || f.getAttribute('name') || f.getAttribute('action') || 'form',
        props: { page: location.pathname },
      });
    },
    true,
  );
  document.addEventListener(
    'click',
    function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-log]') : null;
      var name = t && t.getAttribute('data-log');
      if (name)
        send(name, {
          title: (t.textContent || '').trim().slice(0, 120) || name,
          props: { page: location.pathname },
        });
      var action = e.target && e.target.closest ? e.target.closest('[data-app-health-event]') : null;
      var actionName = action && action.getAttribute('data-app-health-event');
      if (actionName === 'source_thread_opened' && action.href && /^https:\/\/(?:www\.)?reddit\.com\//i.test(action.href)) track(actionName);
      else if (actionName === 'research_view_changed' && action.matches('button[data-community]')) track(actionName);
    },
    true,
  );
  window.addEventListener('error', function (e) {
    send('client.error', {
      level: 'error',
      title: String(e.message || 'error').slice(0, 200),
      props: { page: location.pathname },
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    send('client.error', {
      level: 'error',
      title: r.slice(0, 200),
      props: { page: location.pathname, kind: 'rejection' },
    });
  });
})();
