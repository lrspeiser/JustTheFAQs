import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Head from 'next/head';
import DOMPurify from 'dompurify';
import { supabase } from '../lib/db';  // Import supabase client directly

export default function FAQPage() {
    const router = useRouter();
    const { slug, q } = router.query;
    const [pageData, setPageData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [existingFaqSlugs, setExistingFaqSlugs] = useState([]);

    useEffect(() => {
        if (q) {
            setSearchQuery(q);
        }
    }, [q]);

    useEffect(() => {
        async function loadFaqSlugs() {
            try {
                const { data, error } = await supabase
                    .from('faq_files')
                    .select('slug');

                if (error) throw error;
                setExistingFaqSlugs(data.map(item => item.slug) || []);
            } catch (error) {
                console.error("Error fetching existing FAQ slugs:", error);
            }
        }
        loadFaqSlugs();
    }, []);

    useEffect(() => {
        if (!slug) return;

        const fetchFAQs = async () => {
            try {
                const response = await fetch(`/api/faqs-by-page?slug=${slug}`);
                if (!response.ok) {
                    if (response.status === 404) {
                        setError('No FAQs found for this topic.');
                    } else {
                        throw new Error('Failed to fetch FAQs');
                    }
                    return;
                }

                const data = await response.json();
                setPageData(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchFAQs();
    }, [slug]);

    const handleSearch = () => {
        if (searchQuery.trim().length < 3) {
            setError('Please enter at least 3 characters to search');
            return;
        }

        // Navigate back to homepage with search query
        router.push({
            pathname: '/',
            query: { q: searchQuery }
        });
    };

    if (loading) return <div>Loading...</div>;
    if (error) return <div className="error-message">{error}</div>;
    if (!pageData) return null;

    return (
        <>
            <Head>
                <title>{pageData.page_info.title} - FAQs</title>
            </Head>
            <main className="container">
                <div className="header">
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
                </div>

                <div className="page-header">
                    <h2>{pageData.page_info.title}</h2>
                </div>

                <div className="faqs">
                    {pageData.faqs.map((faq) => (
                        <article key={faq.id} className="faq-entry">
                            {faq.subheader && (
                                <div className="subheader">{faq.subheader}</div>
                            )}

                            <div className="question-with-image">
                                <h2 className="question">Question: {faq.question}</h2>
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
                                <div dangerouslySetInnerHTML={{ 
                                    __html: DOMPurify.sanitize(faq.answer) 
                                }}></div>
                            </div>

                            {faq.cross_links.length > 0 && (
                                <div className="related-links">
                                    <span>Related Pages:</span>
                                    <ul>
                                        {faq.cross_links.map((link, index) => {
                                            let displayName = link.trim();
                                            if (displayName.startsWith("/wiki/")) {
                                                displayName = displayName.replace("/wiki/", "");
                                            }

                                            // Preserve slug format for URL routing
                                            const linkSlug = displayName
                                                .replace(/_/g, '-') // Ensure URL uses dashes
                                                .replace(/[^a-zA-Z0-9-]+/g, '') // Remove invalid characters
                                                .toLowerCase();

                                            // Format display name (keep original formatting but replace underscores)
                                            const formattedDisplayName = displayName.replace(/_/g, ' ');

                                            const isPageAvailable = existingFaqSlugs.includes(linkSlug);

                                            return (
                                                <li key={index}>
                                                    {isPageAvailable ? (
                                                        <a
                                                            href={`/${linkSlug}`} // ✅ Keep URL with dashes
                                                            className="related-topic-link"
                                                        >
                                                            {formattedDisplayName} {/* ✅ Display with spaces */}
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
                    ))}
                </div>
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