import Link from 'next/link';
import Head from 'next/head';
import { supabase } from '../../lib/db';

export async function getServerSideProps(context) {
  const PAGE_SIZE = 200;
  const currentPage = parseInt(context.query.paged, 10) || 1;
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE - 1;

  console.log(`[AllPages] Fetching data for page ${currentPage}`);

  const { data, count, error } = await supabase
    .from('faq_files')
    .select('slug, human_readable_name', { count: 'exact' })
    .order('human_readable_name', { ascending: true })
    .range(startIndex, endIndex);

  if (error) {
    console.error('[AllPages] Supabase error:', error);
    return { props: { pages: [], totalCount: 0, currentPage } };
  }

  return {
    props: {
      pages: data || [],
      totalCount: count || 0,
      currentPage,
      totalPages: Math.ceil(count / PAGE_SIZE),
    },
  };
}

export default function AllPages({ pages, totalCount, currentPage, totalPages }) {
  return (
    <>
      <Head>
        <title>All FAQs - Page {currentPage}</title>
      </Head>

      <main style={{ maxWidth: '600px', margin: '0 auto', padding: '1rem' }}>
        <h1>All FAQs</h1>
        <div style={{ marginBottom: '1rem' }}>
          <h2>Page {currentPage} of {totalPages}</h2>
        </div>

        {/* Pagination Links */}
        <div style={{ marginTop: '2rem', fontSize: '1.1rem' }}>
          {currentPage > 1 ? (
            <Link href={`/util/all-pages?paged=${currentPage - 1}`}>
              ← Previous
            </Link>
          ) : (
            <span style={{ color: '#999' }}>← Previous</span>
          )}

          {' '}

          {currentPage < totalPages ? (
            <Link href={`/util/all-pages?paged=${currentPage + 1}`}>
              Next →
            </Link>
          ) : (
            <span style={{ color: '#999' }}>Next →</span>
          )}
        </div>

        {/* FAQ List */}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {pages.map((item, idx) => (
            <li key={idx} style={{ margin: '0.5rem 0' }}>
              <Link href={`/${item.slug}`}>
                {item.human_readable_name || item.slug}
              </Link>
            </li>
          ))}
        </ul>

        <footer
          style={{
            marginTop: '2rem',
            padding: '1rem',
            background: '#f0f0f0',
            textAlign: 'center',
          }}
        >
          <p>
            Read more about Just The FAQs on{' '}
            <a
              href="https://github.com/lrspeiser/JustTheFAQs"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'blue', textDecoration: 'underline' }}
            >
              GitHub
            </a>
          </p>
        </footer>
      </main>
    </>
  );
}
