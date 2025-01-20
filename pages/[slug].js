import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Head from 'next/head';
import DOMPurify from 'dompurify';

export default function FAQPage() {
    const router = useRouter();
    const { slug, q } = router.query;  // Get search query if it exists
    const [pageData, setPageData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        // Initialize search query from URL if it exists
        if (q) {
            setSearchQuery(q);
        }
    }, [q]);

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

                                          // Ensure we're not prepending "/wiki/"
                                          if (displayName.startsWith("/wiki/")) {
                                              displayName = displayName.replace("/wiki/", "");
                                          }

                                          // Format slug properly for URL routing
                                          const linkSlug = displayName
                                              .replace(/_/g, '-') // Convert underscores to dashes
                                              .replace(/[^a-zA-Z0-9-]+/g, '') // Remove invalid characters
                                              .toLowerCase(); // Convert to lowercase

                                          return (
                                              <li key={index}>
                                                  <a
                                                      href={`/${linkSlug}`}
                                                      className="related-topic-link"
                                                  >
                                                      {displayName.replace(/-/g, ' ')} {/* Display readable name */}
                                                  </a>
                                              </li>
                                          );
                                      })}
                                  </ul>
                              </div>
                          )}

                        </article>
                    ))}
                </div>
            </main>
        </>
    );
}