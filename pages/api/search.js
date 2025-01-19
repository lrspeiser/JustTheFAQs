import { pipeline } from '@xenova/transformers';
import { createClient } from '@supabase/supabase-js';

// 🔹 Initialize Supabase Client
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 🔹 Embedder Initialization
let embedder = null;
async function initEmbedder() {
    if (!embedder) {
        console.log('[API/Search] Initializing embedder...');
        try {
            embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            console.log('[API/Search] ✅ Embedder initialized.');
        } catch (error) {
            console.error('[API/Search] ❌ Embedder initialization failed:', error);
            throw error;
        }
    }
    return embedder;
}

// 🔹 Generate query embedding
async function generateEmbedding(text) {
    try {
        console.log('[API/Search] 🔄 Generating embedding...');
        const localEmbedder = await initEmbedder();
        const result = await localEmbedder(text, { pooling: 'mean', normalize: true });
        const queryEmbedding = Array.from(result.data);

        if (queryEmbedding.length !== 384) {
            throw new Error(`Invalid embedding length: ${queryEmbedding.length}`);
        }

        console.log('[API/Search] ✅ Query embedding generated:', queryEmbedding.slice(0, 10));
        return queryEmbedding;
    } catch (error) {
        console.error('[API/Search] ❌ Embedding generation failed:', error);
        throw error;
    }
}

// 🔹 Query Supabase for combined text + vector search
async function queryCombinedSearch(queryEmbedding, textQuery) {
    try {
        console.log('[API/Search] 🔍 Querying Supabase for search results...');

        // 🔹 Text Match Search with JOIN
        const { data: textResults, error: textError } = await supabase
            .from('raw_faqs')
            .select(`
                *,
                faq_files (
                    id,
                    slug,
                    human_readable_name
                )
            `)
            .or(`question.ilike.${textQuery},answer.ilike.${textQuery}`)
            .limit(10);

        console.log('[API/Search] Raw text search results:', textResults);

        if (textError) {
            console.error('[API/Search] ❌ Error in text search:', textError.message);
            throw new Error(textError.message);
        }

        // 🔹 Vector Search
        const { data: vectorResults, error: vectorError } = await supabase.rpc('search_faqs', {
            query_embedding: queryEmbedding,
            text_query: textQuery
        });

        if (vectorError) {
            console.error('[API/Search] ❌ Error in vector search:', vectorError.message);
            throw new Error(vectorError.message);
        }

        // 🔹 Merge Results
        const mergedResults = [...textResults, ...vectorResults]
            .reduce((acc, curr) => {
                if (!acc.find((item) => item.id === curr.id)) {
                    console.log('[API/Search] Processing result:', {
                        id: curr.id,
                        faq_files: curr.faq_files,
                        title: curr.title,
                        human_readable_name: curr.human_readable_name
                    });

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

// 🔹 API Handler
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

        // 🔹 Generate embedding
        const queryEmbedding = await generateEmbedding(query);

        // 🔹 Query Supabase for both text & vector search
        const searchResults = await queryCombinedSearch(queryEmbedding, `%${query}%`);

        // 🔹 Format response for frontend
        const formattedResults = searchResults.map((result) => {
            console.log('[API/Search] Formatting result:', {
                id: result.id,
                faq_files: result.faq_files,
                human_readable_name: result.faq_files?.human_readable_name || result.human_readable_name
            });

            return {
                id: result.id,
                question: result.question,
                answer: result.answer,
                similarity: result.similarity || 0,
                cross_links: result.cross_link ? result.cross_link.split(',') : [],
                media_link: result.media_link || '',
                additional_images: result.image_urls ? result.image_urls.split(',') : [],
                human_readable_name: result.faq_files?.human_readable_name || result.human_readable_name,
                page_slug: result.faq_files?.slug || '',
                subheader: result.subheader,
                faq_file_id: result.faq_file_id
            };
        });

        console.log('[API/Search] ✅ Returning formatted results:', formattedResults);
        res.status(200).json(formattedResults);
    } catch (error) {
        console.error('[API/Search] ❌ Error during search:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}