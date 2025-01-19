import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { slug } = req.query;

    if (!slug) {
        return res.status(400).json({ error: 'Slug is required' });
    }

    try {
        console.log('[API/FAQsByPage] 🔍 Fetching FAQs for slug:', slug);

        // First get the faq_file to confirm it exists and get its ID
        const { data: faqFile, error: faqFileError } = await supabase
            .from('faq_files')
            .select('*')
            .eq('slug', slug)
            .single();

        if (faqFileError || !faqFile) {
            console.error('[API/FAQsByPage] ❌ FAQ file not found:', faqFileError?.message);
            return res.status(404).json({ error: 'Page not found' });
        }

        // Then get all FAQs associated with this faq_file_id
        const { data: faqs, error: faqsError } = await supabase
            .from('raw_faqs')
            .select('*')
            .eq('faq_file_id', faqFile.id)
            .order('id');

        if (faqsError) {
            console.error('[API/FAQsByPage] ❌ Error fetching FAQs:', faqsError.message);
            throw faqsError;
        }

        const formattedFaqs = faqs.map(faq => ({
            id: faq.id,
            question: faq.question,
            answer: faq.answer,
            subheader: faq.subheader,
            cross_links: faq.cross_link ? faq.cross_link.split(',') : [],
            media_link: faq.media_link || '',
            additional_images: faq.image_urls ? faq.image_urls.split(',') : []
        }));

        const response = {
            page_info: {
                title: faqFile.human_readable_name,
                slug: faqFile.slug
            },
            faqs: formattedFaqs
        };

        console.log('[API/FAQsByPage] ✅ Returning FAQs:', {
            title: response.page_info.title,
            count: formattedFaqs.length
        });

        res.status(200).json(response);
    } catch (error) {
        console.error('[API/FAQsByPage] ❌ Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}