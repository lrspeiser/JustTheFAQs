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
                input: text.replace(/\n/g, ' '), // OpenAI recommends replacing newlines with spaces
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

        // Vector Search using match_documents function
        const { data: vectorResults, error: vectorError } = await supabase.rpc('match_documents', {
            query_embedding: queryEmbedding,
            match_threshold: 0.001,  // Lower threshold to see more results
            match_count: 10
        });

        console.log('[API/Search] Vector results:', vectorResults);

        if (vectorError) {
            console.error('[API/Search] ❌ Error in vector search:', vectorError.message);
            throw new Error(vectorError.message);
        }

        // Get full details for vector results
        let enrichedVectorResults = [];
        if (vectorResults && vectorResults.length > 0) {
            const { data: fullDetails, error: detailsError } = await supabase
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
                `)
                .in('id', vectorResults.map(r => r.id));

            if (detailsError) {
                console.error('[API/Search] ❌ Error getting vector result details:', detailsError);
            } else {
                enrichedVectorResults = fullDetails.map(detail => ({
                    ...detail,
                    similarity: vectorResults.find(r => r.id === detail.id)?.similarity || 0
                }));
            }
        }

        // Text Match Search with JOIN (as fallback)
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
            `)
            .or(`question.ilike.${textQuery},answer.ilike.${textQuery}`)
            .limit(10);

        console.log('[API/Search] Text search results:', textResults?.length || 0);

        if (textError) {
            console.error('[API/Search] ❌ Error in text search:', textError.message);
            throw new Error(textError.message);
        }

        // Prioritize vector results, use text results as fallback
        const mergedResults = [...(enrichedVectorResults || [])];

        // Only add text results if we don't have enough vector results
        if (mergedResults.length < 10) {
            const textOnly = (textResults || []).filter(
                tr => !mergedResults.find(vr => vr.id === tr.id)
            );
            mergedResults.push(...textOnly);
        }

        return mergedResults;
    } catch (error) {
        console.error('[API/Search] ❌ Supabase query failed:', error.message);
        throw error;
    }
}

// API Handler remains the same
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