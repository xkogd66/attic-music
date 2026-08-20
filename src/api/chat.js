export async function fetchProviders() {
  const res = await fetch('/chat-api/providers')
  if (!res.ok) return []
  return res.json()
}

export async function askAI(message, provider) {
  const res = await fetch('/chat-api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, provider }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `chat request failed (${res.status})`)
  return res.json()
}
