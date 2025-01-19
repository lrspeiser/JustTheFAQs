import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";

// Initialize Supabase Client
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Generate query embedding using OpenAI
async function generateEmbedding(text, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log('[API/Search] 🔄 Generating embedding for:', text);

            const embedding = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: text,
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

// Query Supabase for combined text + vector search
async function queryCombinedSearch(queryEmbedding, textQuery) {
    try {
        console.log('[API/Search] 🔍 Querying Supabase for search results...');

        // Text Match Search with JOIN
        const { data: textResults, error: textError } = await supabase
            .from('raw_faqs')
            .select(`
                id,
                faq_file_id,
                url,
                title,
                question,
                answer,
                media_link,
                human_readable_name,
                last_updated,
                subheader,
                cross_link,
                image_urls,
                faq_files (
                    id,
                    slug,
                    human_readable_name
                )
            `)  // Removed timestamp field
            .or(`question.ilike.${textQuery},answer.ilike.${textQuery}`)
            .limit(10);

        if (textError) {
            console.error('[API/Search] ❌ Error in text search:', textError.message);
            throw new Error(textError.message);
        }

        // Vector Search
        const { data: vectorResults, error: vectorError } = await supabase.rpc('search_faqs', {
            query_embedding: queryEmbedding,
            text_query: textQuery,
            match_threshold: 0.7
        });

        if (vectorError) {
            console.error('[API/Search] ❌ Error in vector search:', vectorError.message);
            throw new Error(vectorError.message);
        }

        // Merge and Deduplicate Results
        const mergedResults = [...(textResults || []), ...(vectorResults || [])]
            .reduce((acc, curr) => {
                if (!acc.find((item) => item.id === curr.id)) {
                    acc.push(curr);
                }
                return acc;
            }, []);

        // Sort by similarity if available
        mergedResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

        return mergedResults;
    } catch (error) {
        console.error('[API/Search] ❌ Supabase query failed:', error.message);
        throw error;
    }
}

// API Handler
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    }

    try {
        console.log('[API/Search] 🟢 Search initiated.');

        const { query } = req.body;
        if (!query || query.trim().length < 3) {
            return res.status(400).json({ error: 'Query must be at least 3 characters long.' });
        }
        console.log('[API/Search] 🔎 User query:', query);

        // Generate embedding
        const queryEmbedding = await generateEmbedding(query);

        // Query Supabase for both text & vector search
        const searchResults = await queryCombinedSearch(queryEmbedding, `%${query}%`);

        // Format response for frontend
        const formattedResults = searchResults.map((result) => ({
            id: result.id,
            question: result.question,
            answer: result.answer,
            similarity: result.similarity || 0,
            cross_links: result.cross_link ? result.cross_link.split(',').map(link => link.trim()) : [],
            media_link: result.media_link || '',
            additional_images: result.image_urls ? result.image_urls.split(',').map(url => url.trim()) : [],
            human_readable_name: result.faq_files?.human_readable_name || result.human_readable_name,
            page_slug: result.faq_files?.slug || '',
            subheader: result.subheader,
            faq_file_id: result.faq_file_id
        }));

        console.log('[API/Search] ✅ Returning formatted results:', 
            formattedResults.map(r => ({ id: r.id, question: r.question, similarity: r.similarity }))
        );
        res.status(200).json(formattedResults);
    } catch (error) {
        console.error('[API/Search] ❌ Error during search:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}