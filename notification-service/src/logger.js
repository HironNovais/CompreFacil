export function log(level, action, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'notification-service', level, action, ...fields }));
}
