// pages/api/start-worker.js
import { spawn } from 'child_process';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Spawn a new detached process running your worker.js
    const worker = spawn('node', ['lib/worker.js'], {
      detached: true,
      stdio: 'ignore'
    });
    worker.unref();
    console.log('[start-worker] Worker process started.');
    return res.status(200).json({ message: 'Worker started successfully' });
  } catch (error) {
    // Log the full error details
    console.error('[start-worker] Error starting worker:', error);
    // Return a detailed error message using JSON.stringify to capture all properties
    return res.status(500).json({ error: JSON.stringify(error) });
  }
}
