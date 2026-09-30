// IEC Suite sign-out — Vercel Edge Function.
// Clears the `desk_session` cookie and sends the browser to the sign-in page.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  return new Response(null, {
    status: 302,
    headers: {
      'set-cookie': 'desk_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
      location: '/desk/login.html'
    }
  });
}
