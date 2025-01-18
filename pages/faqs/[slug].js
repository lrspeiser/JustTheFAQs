import { createClient } from '@supabase/supabase-js';

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function FAQPage({ faq }) {
  if (!faq) return <div>FAQ not found</div>;

  return (
    <div>
      <h1>{faq.title}</h1>
      {/* Add your FAQ content here */}
    </div>
  );
}

export async function getStaticPaths() {
  try {
    // Fetch all FAQ slugs from Supabase
    const { data: faqs, error } = await supabase
      .from('faq_files')
      .select('slug');

    if (error) {
      console.error('Error fetching FAQ slugs:', error);
      return { paths: [], fallback: false };
    }

    // Create paths for each FAQ
    const paths = faqs.map((faq) => ({
      params: { slug: faq.slug },
    }));

    return {
      paths,
      fallback: false, // or 'blocking' if you want to enable ISR
    };
  } catch (error) {
    console.error('Error in getStaticPaths:', error);
    return { paths: [], fallback: false };
  }
}

export async function getStaticProps({ params }) {
  try {
    // Fetch FAQ data from Supabase using the slug
    const { data: faq, error } = await supabase
      .from('raw_faqs')
      .select('*')
      .eq('slug', params.slug)
      .single();

    if (error || !faq) {
      console.error('Error fetching FAQ:', error);
      return {
        notFound: true,
      };
    }

    return {
      props: {
        faq,
      },
      revalidate: 3600, // Revalidate every hour
    };
  } catch (error) {
    console.error('Error in getStaticProps:', error);
    return {
      notFound: true,
    };
  }
}