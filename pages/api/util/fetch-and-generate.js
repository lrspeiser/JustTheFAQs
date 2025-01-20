// pages/api/util/fetch-and-generate.js
import { startProcess } from '../../../scripts/fetchAndGenerate';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[API] Starting fetch and generate process...');

    // Start the fetch and generate process
    const process = await startProcess();

    console.log('[API] Process completed successfully');
    return res.status(200).json({ 
      success: true, 
      message: 'Fetch and generate process started successfully.' 
    });
  } catch (error) {
    console.error('[API] Error in fetch and generate process:', error);
    return res.status(500).json({ 
      error: 'Failed to start fetch and generate process',
      details: error.message 
    });
  }
}