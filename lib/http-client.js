export async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) throw new Error(`The server returned an empty response (HTTP ${response.status}). Check the Netlify function logs and database settings.`);
  try { return JSON.parse(text); }
  catch { throw new Error(`The server returned a non-JSON response (HTTP ${response.status}). Check the deployment and Netlify function logs.`); }
}
