// Admin auth: one shared secret in the ADMIN_TOKEN worker secret, sent as a Bearer header.

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// A token shorter than 24 characters is refused even if it matches, so a weak ADMIN_TOKEN cannot be used at all.
export const MIN_TOKEN_LENGTH = 24;
export function isAdmin(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const secret = String(env.ADMIN_TOKEN || '');
  if (secret.length < MIN_TOKEN_LENGTH) return false;
  return token.length > 0 && timingSafeEqual(token, secret);
}
