// Admin auth: one shared secret in the ADMIN_TOKEN worker secret, sent as a Bearer header.

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function isAdmin(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return Boolean(env.ADMIN_TOKEN) && token.length > 0 && timingSafeEqual(token, env.ADMIN_TOKEN);
}
