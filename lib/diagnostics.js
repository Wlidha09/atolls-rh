export function describeError(error, env = process.env) {
  let message = String(error.message || error.name || 'Unknown error');
  for (const [key, value] of Object.entries(env)) {
    if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|PASS$/i.test(key) && value && value.length >= 4) message = message.replaceAll(value, '[REDACTED]');
  }
  return `${error.code || error.name || 'Error'}: ${message}`;
}
