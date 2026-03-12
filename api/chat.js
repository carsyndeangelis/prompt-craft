export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Go to Vercel → Settings → Environment Variables and add your ANTHROPIC_API_KEY.' });
  }

  try {
    const { system, messages, max_tokens } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1000,
        system: system,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', response.status, err);
      if (response.status === 429) {
        return res.status(429).json({ error: 'Rate limited. Please wait a moment and try again.' });
      }
      if (response.status === 401) {
        return res.status(401).json({ error: 'Invalid API key. Check your ANTHROPIC_API_KEY in Vercel environment variables.' });
      }
      return res.status(response.status).json({ error: `AI service error (${response.status}). Please try again.` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error. Please try again in a moment.' });
  }
}
