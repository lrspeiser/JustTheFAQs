import { useRouter } from 'next/router';
import Head from 'next/head';
import createDOMPurify from 'dompurify';
import { supabase } from '../lib/db';
import { useState, useEffect } from 'react';

export async function getServerSideProps(context) {
    const { slug } = context.params;

    console.log(`🔍 Debug: Received slug in getServerSideProps -> ${slug}`);

    if (!slug) {
        return { notFound: true };
    }

    // Fetch page metadata from `faq_files`
    const { data: pageMeta, error: metaError } = await supabase
        .from('faq_files')
        .select('id, slug, human_readable_name, wiki_url')
        .eq('slug', slug)
        .single();

    if (metaError || !pageMeta) {
        console.error(`❌ Supabase Metadata Error:`, metaError);
        return { notFound: true };
    }

    // Fetch all FAQs for this page (including cross-links)
    const { data: faqData, error: faqError } = await supabase
        .from('raw_faqs')
        .select('question, answer, media_link, subheader, cross_link')
        .eq('faq_file_id', pageMeta.id);

    if (faqError) {
        console.error(`❌ Supabase FAQ Error:`, faqError);
    }

    // Fetch all existing FAQ slugs for cross-link verification
    const { data: faqSlugs } = await supabase.from('faq_files').select('slug');

    return {
        props: {
            pageData: {
                ...pageMeta,
                faqs: faqData || [],
            },
            existingFaqSlugs: faqSlugs?.map(item => item.slug) || [],
        },
    };
}

export default function FAQPage({ pageData, existingFaqSlugs }) {
    const router = useRouter();
    const { q } = router.query;

    const [searchQuery, setSearchQuery] = useState(q || '');
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState(null);
    const [sanitizedFaqs, setSanitizedFaqs] = useState([]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const DOMPurify = createDOMPurify(window);

            setSanitizedFaqs(
                pageData.faqs.map(faq => ({
                    ...faq,
                    question: DOMPurify.sanitize(faq.question || ''),
                    answer: DOMPurify.sanitize(faq.answer || ''),
                    crossLinks: faq.cross_link
                        ? faq.cross_link.split(',').map(link => link.trim()) // Convert CSV string to array
                        : []
                }))
            );
        }
    }, [pageData]);

    const handleSearch = () => {
        if (searchQuery.trim().length < 3) {
            setError('Please enter at least 3 characters to search');
            return;
        }
        router.push({ pathname: '/', query: { q: searchQuery } });
    };

    if (!pageData) {
        return <div>⚠️ No FAQ found. Please check the URL.</div>;
    }

    const pageTitle = pageData.human_readable_name || "FAQ Page";
    const pageDescription = `Find answers to frequently asked questions about ${pageTitle}.`;

    return (
        <>
            <Head>
                <title>{pageTitle} - FAQs</title>
                <meta name="description" content={pageDescription} />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta name="robots" content="index, follow" />
                <meta charSet="UTF-8" />
            </Head>
            <main className="container">
                <header className="header">
                    <h1>Just the FAQs!</h1>
                    <div className="search-box">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="Search FAQs..."
                        />
                        <button onClick={handleSearch} disabled={searching}>
                            {searching ? 'Searching...' : 'Search'}
                        </button>
                    </div>
                </header>

                <section className="page-header">
                    <h2>{pageTitle}</h2>
                </section>

                <section className="faqs">
                    {sanitizedFaqs.length === 0 ? (
                        <p>No FAQs available for this topic.</p>
                    ) : (
                        sanitizedFaqs.map((faq, index) => (
                            <article key={index} className="faq-entry">
                                {faq.subheader && <h3 className="subheader">{faq.subheader}</h3>}

                                <div className="question-with-image">
                                    <h2 className="question">
                                        Question: {faq.question}
                                    </h2>
                                    {faq.media_link && (
                                        <div className="image">
                                            <img 
                                                src={faq.media_link} 
                                                alt="FAQ Thumbnail" 
                                                loading="lazy" 
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="answer-container">
                                    <div dangerouslySetInnerHTML={{ __html: faq.answer }}></div>
                                </div>

                                {/* Related Links */}
                                {faq.crossLinks.length > 0 && (
                                    <div className="related-links">
                                        <span>Related Pages:</span>
                                        <ul>
                                            {faq.crossLinks.map((link, idx) => {
                                                let displayName = link.trim();
                                                if (displayName.startsWith("/wiki/")) {
                                                    displayName = displayName.replace("/wiki/", "");
                                                }

                                                const linkSlug = displayName
                                                    .replace(/_/g, '-') 
                                                    .replace(/[^a-zA-Z0-9-]+/g, '') 
                                                    .toLowerCase();

                                                const formattedDisplayName = displayName.replace(/_/g, ' ');

                                                const isPageAvailable = existingFaqSlugs.includes(linkSlug);

                                                return (
                                                    <li key={idx}>
                                                        {isPageAvailable ? (
                                                            <a href={`/${linkSlug}`} className="related-topic-link">
                                                                {formattedDisplayName}
                                                            </a>
                                                        ) : (
                                                            <span className="unavailable-topic">
                                                                {formattedDisplayName}
                                                            </span>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </article>
                        ))
                    )}
                </section>

                {/* Footer */}
                <footer
                    style={{
                      marginTop: '2rem',
                      padding: '1rem',
                      background: '#f0f0f0',
                      textAlign: 'center'
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
