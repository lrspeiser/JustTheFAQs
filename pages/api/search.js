import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import { Pinecone } from '@pinecone-database/pinecone';

// Initialize Supabase Client
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
const indexName = "faq-embeddings"; // Change if needed
const index = pc.index(indexName);

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

// Query Supabase for text-based fallback search
async function queryTextSearch(textQuery) {
    try {
        console.log('[API/Search] 🔍 Performing text-based search in Supabase...');

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
            .or(`question.ilike.%${textQuery}%,answer.ilike.%${textQuery}%`) // Ensure % wildcards are placed correctly
            .limit(10);

        if (textError) {
            console.error('[API/Search] ❌ Error in text search:', textError.message);
            return [];
        }

        console.log(`[API/Search] ✅ Found ${textResults.length} text search results in Supabase.`);
        return textResults;
    } catch (error) {
        console.error('[API/Search] ❌ Supabase text search failed:', error.message);
        return [];
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

        // Query Pinecone for vector search
        const vectorResults = await queryPinecone(queryEmbedding);

        // Query Supabase for text fallback
        const textResults = await queryTextSearch(query);

        // Merge results: Prioritize vector results, use text results as fallback
        const mergedResults = [...vectorResults];

        if (mergedResults.length < 10) {
            const textOnly = textResults.filter(tr => !mergedResults.find(vr => vr.id === tr.id));
            mergedResults.push(...textOnly);
        }

        // Format response for frontend
        const formattedResults = mergedResults.map((result) => ({
            id: result.id,
            question: result.question,
            answer: result.answer,
            similarity: result.similarity || 0,
            cross_links: Array.isArray(result.cross_link) 
                ? result.cross_link 
                : typeof result.cross_link === "string" 
                ? result.cross_link.split(",").map(link => link.trim()) 
                : [], // Ensure it's always an array
            media_link: result.media_link || '',
            additional_images: Array.isArray(result.image_urls) 
                ? result.image_urls.map(url => url.trim()) 
                : [], // Ensure it's always an array
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
