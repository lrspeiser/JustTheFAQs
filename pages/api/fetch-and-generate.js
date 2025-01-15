import { exec } from 'child_process';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scriptPath = './scripts/fetchAndGenerate.js'; // Adjust the path as needed
  console.log('[FetchAndGenerate API] Starting the script:', scriptPath);

  exec(`node ${scriptPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error('[FetchAndGenerate API] Error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (stderr) {
      console.error('[FetchAndGenerate API] Stderr:', stderr);
      return res.status(500).json({ error: stderr });
    }

    console.log('[FetchAndGenerate API] Stdout:', stdout);
    res.status(200).json({ message: 'Script executed successfully.', details: stdout });
  });
}
