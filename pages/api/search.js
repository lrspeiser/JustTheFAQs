// pages/api/search.js

import { createClient } from '@supabase/supabase-js'; // Might not even be needed now
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

// -- If you're no longer using Supabase for *anything* in this endpoint,
//    you can remove these lines entirely. But I'll leave the createClient here
//    in case you re-add something. For now, we'll just ignore it.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Pinecone client
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const indexName = 'faq-embeddings'; // Adjust if needed
const index = pc.index(indexName);

// Generate query embedding using OpenAI
async function generateEmbedding(text, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log('[API/Search] 🔄 Generating embedding for:', text);

      const embedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.replace(/\n/g, ' '), // recommended by OpenAI
        dimensions: 1536
      });

      const queryEmbedding = embedding.data[0].embedding;
      if (!queryEmbedding.length) {
        throw new Error('Empty embedding generated');
      }

      console.log('[API/Search] ✅ Query embedding generated');
      return queryEmbedding;
    } catch (error) {
      console.error(`[API/Search] ❌ Embedding generation attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Query Pinecone for similar FAQs
async function queryPinecone(queryEmbedding, topK = 10) {
  try {
    console.log('[API/Search] 🔍 Querying Pinecone for vector search...');
    const queryResult = await index.query({
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true
    });

    if (!queryResult.matches || queryResult.matches.length === 0) {
      console.log('[API/Search] ⚠️ No vector matches found in Pinecone.');
      return [];
    }

    console.log(`[API/Search] ✅ Found ${queryResult.matches.length} vector matches in Pinecone.`);

    // Return each match, merging match.score into "similarity" and
    // including all metadata fields at the top level (like slug, question, etc.)
    return queryResult.matches.map(match => ({
      id: match.id,
      similarity: match.score,
      ...match.metadata
    }));
  } catch (error) {
    console.error('[API/Search] ❌ Pinecone query failed:', error.message);
    return [];
  }
}

// API Handler (Pinecone-only)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    console.log('[API/Search] 🟢 Search initiated.');

    const { query } = req.body;
    if (!query || query.trim().length < 3) {
      return res
        .status(400)
        .json({ error: 'Query must be at least 3 characters long.' });
    }
    console.log('[API/Search] 🔎 User query:', query);

    // 1) Generate embedding
    const queryEmbedding = await generateEmbedding(query);

    // 2) Query Pinecone only
    const pineconeResults = await queryPinecone(queryEmbedding);

    // 3) Format results for frontend
    const formattedResults = pineconeResults.map(result => {
      // "slug" is stored as top-level in metadata
      // cross_link, question, answer, media_link, etc. also come from metadata
      return {
        id: result.id,
        question: result.question,
        answer: result.answer,
        similarity: result.similarity || 0,
        cross_links: Array.isArray(result.cross_link)
          ? result.cross_link
          : typeof result.cross_link === 'string'
          ? result.cross_link.split(',').map(link => link.trim())
          : [],
        media_link: result.media_link || '',
        additional_images: Array.isArray(result.image_urls)
          ? result.image_urls.map(url => url.trim())
          : [],
        human_readable_name: result.human_readable_name || '',
        page_slug: result.slug || '', // <--- we now use "slug" from Pinecone
        subheader: result.subheader || '',
        faq_file_id: result.faq_file_id
      };
    });

    console.log('[API/Search] ✅ Returning final Pinecone-only results:', 
      formattedResults.map(r => ({
        id: r.id,
        question: r.question,
        slug: r.page_slug,
        similarity: r.similarity
      }))
    );

    res.status(200).json(formattedResults);
  } catch (error) {
    console.error('[API/Search] ❌ Error during search:', error.message);
    res
      .status(500)
      .json({ error: 'Internal server error', details: error.message });
  }
}
