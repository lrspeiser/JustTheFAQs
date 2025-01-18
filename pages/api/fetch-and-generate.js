// pages/api/fetch-and-generate.js

import { main as generateFAQs } from './scripts/fetchAndGenerate';

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
    maxDuration: 60,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[FetchAndGenerate API] Starting FAQ generation process...');

    // Get target from request body or use default
    const target = req.body?.target || 2;

    // Call the main function directly instead of executing as a script
    await generateFAQs(target);

    console.log('[FetchAndGenerate API] Generation completed successfully');
    return res.status(200).json({ 
      success: true, 
      message: 'FAQ generation completed successfully'
    });

  } catch (error) {
    console.error('[FetchAndGenerate API] Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error'
    });
  }
}