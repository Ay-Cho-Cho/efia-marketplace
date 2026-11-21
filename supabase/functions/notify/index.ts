// Sends email (Resend) and SMS (Termii) when a row is inserted into `notifications`.
// Each channel only runs if its secret is set and the user consented in their profile.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const { record } = await req.json()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: p } = await sb.from('profiles').select('email,phone,notify_email,notify_sms').eq('id', record.user_id).single()
  if (!p) return new Response('no user')
  const msg = `${record.title}${record.body ? ': ' + record.body : ''}`
  const link = (Deno.env.get('SITE_URL') ?? '') + (record.link ?? '')
  const key = Deno.env.get('RESEND_API_KEY')
  if (key && p.notify_email && p.email) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: Deno.env.get('MAIL_FROM'), to: p.email, subject: `EFIA: ${record.title}`, text: `${msg}\n\n${link}` }),
    })
  }
  const tk = Deno.env.get('TERMII_API_KEY')
  if (tk && p.notify_sms && p.phone) {
    const to = p.phone.replace(/\D/g, '').replace(/^0/, '234')
    await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, from: Deno.env.get('TERMII_SENDER'), sms: `EFIA: ${msg}`.slice(0, 300), type: 'plain', channel: 'generic', api_key: tk }),
    })
  }
  return new Response('ok')
})
