export async function askAI(message) {
  const res = await fetch('/chat-api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `chat request failed (${res.status})`)
  return res.json()
}
