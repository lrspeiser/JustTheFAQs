import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('faq_files')
      .select('slug');

    if (error) {
      throw error;
    }

    const slugs = data.map(item => item.slug);
    return res.status(200).json({ slugs });
  } catch (error) {
    console.error('Error fetching FAQ slugs:', error);
    return res.status(500).json({ error: 'Failed to fetch FAQ slugs' });
  }
}