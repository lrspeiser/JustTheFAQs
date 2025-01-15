import { pipeline } from '@xenova/transformers';
import { querySearchResults } from '../../lib/db';

// Embedder initialization
let embedder = null;
async function initEmbedder() {
  if (!embedder) {
    console.log('[API/Search] Initializing embedder...');
    try {
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('[API/Search] Embedder initialized.');
    } catch (error) {
      console.error('[API/Search] Embedder initialization failed:', error);
      throw error;
    }
  }
  return embedder;
}

// Generate embeddings for the query
async function generateEmbedding(embedder, text) {
  try {
    console.log('[API/Search] Generating embedding...');
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  } catch (error) {
    console.error('[API/Search] Embedding generation failed:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[API/Search] Search initiated.');

    const { query } = req.body;
    if (!query || query.trim().length < 3) {
      return res.status(400).json({ error: 'Query must be at least 3 characters long.' });
    }
    console.log('[API/Search] User query:', query);

    // Generate embedding for the query
    const localEmbedder = await initEmbedder();
    const queryEmbedding = await generateEmbedding(localEmbedder, query);

    console.log('[API/Search] Query embedding generated.');

    // Query search results via Supabase RPC
    const searchResults = await querySearchResults(queryEmbedding, `%${query}%`);

    console.log('[API/Search] Search results received.');

    // Format the response for the frontend
    const formattedResults = searchResults.map((result) => ({
      id: result.id,
      question: result.question,
      answer: result.answer,
      similarity: result.similarity,
      cross_links: result.cross_links ? result.cross_links.split(',') : [],
      media_link: result.media_link || '',
    }));

    res.status(200).json(formattedResults);
  } catch (error) {
    console.error('[API/Search] Error during search:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
