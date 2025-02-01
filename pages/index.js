import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DOMPurify from 'dompurify';
import Link from 'next/link';

const FAQEntry = ({ faq, existingFaqSlugs }) => {
  // Add debug logging
  console.log('[FAQEntry] Received FAQ data:', {
    id: faq.id,
    human_readable_name: faq.human_readable_name,
    page_slug: faq.page_slug,
    title: faq.title,
    question: faq.question,
    subheader: faq.subheader,
    faq_file_id: faq.faq_file_id
  });

  const getPageName = () => {
    console.log('[FAQEntry] getPageName called:', {
      human_readable_name: faq.human_readable_name,
      title: faq.title
    });
    return faq.human_readable_name || 'Uncategorized';
  };

  /**
   * Updated formatWikiSlug function:
   * • It now decodes the URL, strips the "/wiki/" prefix (if present),
   *   and converts it to lower-case.
   * • It does NOT replace underscores with dashes.
   */
  const formatWikiSlug = (url) => {
    if (!url) return '';
    try {
      let cleanUrl = decodeURIComponent(url);
      // Remove only the "/wiki/" prefix if present
      if (cleanUrl.startsWith('/wiki/')) {
        cleanUrl = cleanUrl.replace('/wiki/', '');
      }
      // Return the slug with its original casing
      return cleanUrl;
    } catch {
      return url;
    }
  };

  /**
   * Format a human-readable version of a wiki slug (if needed).
   * This function is used for display purposes only.
   */
  const formatHumanReadableName = (url) => {
    if (!url) return '';
    try {
      let name = url.replace(/^\/wiki\//, '');
      name = decodeURIComponent(name);
      return name
        .replace(/_/g, ' ')
        .replace(/\(.*?\)/g, '')
        .replace(/\u2013/g, '-')
        .replace(/\u2014/g, '-')
        .trim();
    } catch {
      return url.replace(/_/g, ' ').trim();
    }
  };

  // Convert cross_links to an array if stored as a string
  const getRelatedTopics = () => {
    if (!faq.cross_links) return [];
    try {
      if (typeof faq.cross_links === 'string') {
        return faq.cross_links
          .split(',')
          .map(link => link.trim())
          .filter(Boolean);
      }
      return faq.cross_links;
    } catch {
      return [];
    }
  };

  const relatedTopics = getRelatedTopics();

  // Debug log to show question before rendering
  console.log('[FAQEntry] 📝 Rendering question with HTML:', faq.question);

  return (
    <article className="faq-entry">
      <header className="entry-header">
        {faq.page_slug ? (
          // Use the updated formatWikiSlug function so that underscores are preserved
          <a href={`/${formatWikiSlug(faq.page_slug)}`} className="page-name">
            {faq.human_readable_name || formatHumanReadableName(faq.page_slug)}
          </a>
        ) : (
          <span className="page-name">{getPageName()}</span>
        )}
        {faq.similarity > 0 && (
          <div className="debug-info">
            <small>Match Score: {Math.round(faq.similarity * 100)}%</small>
          </div>
        )}
      </header>

      {/* Debug line to display the raw page_slug */}
      <div style={{ fontSize: '0.9em', color: '#999' }}>
        Debug Slug: {faq.page_slug || '(none)'}
      </div>

      {faq.subheader && <div className="subheader">{faq.subheader}</div>}

      <div className="question-with-image">
        <h2
          className="question"
          dangerouslySetInnerHTML={{
            __html: `Question: ${DOMPurify.sanitize(faq.question)}`
          }}
        />
        {faq.media_link && (
          <div className="image">
            <img src={faq.media_link} alt="FAQ Thumbnail" loading="lazy" />
          </div>
        )}
      </div>

      <div className="answer-container">
        <div
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(faq.answer)
          }}
        ></div>
      </div>

      {relatedTopics.length > 0 && (
        <div className="related-links">
          <span>Related Pages:</span>
          <ul>
            {relatedTopics.map((topic, index) => {
              const displayName = formatHumanReadableName(topic);
              const slug = formatWikiSlug(topic);

              // Use existingFaqSlugs to determine if the page exists
              const isPageAvailable = existingFaqSlugs?.includes(slug);

              return (
                <li key={index}>
                  {isPageAvailable ? (
                    <a href={`/${slug}`} className="related-topic-link">
                      {displayName}
                    </a>
                  ) : (
                    <a
                      className="related-topic-link"
                      style={{
                        color: '#808080',
                        cursor: 'default',
                        pointerEvents: 'none'
                      }}
                    >
                      {displayName}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
};

const TopicLink = ({ name }) => {
  // For topic links, keep underscores if that's how your slug is stored
  const slug = name.toLowerCase(); // If your stored slug has underscores, leave them as is.
  return (
    <a href={`/${slug}`} className="related-topic-link">
      {name}
    </a>
  );
};

export default function Home() {
  const router = useRouter();
  const [faqs, setFaqs] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [existingFaqSlugs, setExistingFaqSlugs] = useState([]);

  // Fetch existing FAQ slugs when the component mounts
  useEffect(() => {
    const fetchExistingFaqSlugs = async () => {
      try {
        console.log('[Home] Fetching existing FAQ slugs from /api/faq-slugs');
        const response = await fetch('/api/faq-slugs');
        if (!response.ok) {
          throw new Error('Failed to fetch FAQ slugs');
        }
        const data = await response.json();
        console.log('[Home] Slugs fetched:', data.slugs);
        setExistingFaqSlugs(data.slugs);
      } catch (error) {
        console.error('[Home] Error fetching FAQ slugs:', error);
        setExistingFaqSlugs([]);
      }
    };

    fetchExistingFaqSlugs();
  }, []);

  // Check the query string for a search term
  useEffect(() => {
    const query = router.query.q;
    if (query) {
      setSearchQuery(query);
      performSearch(query);
    }
  }, [router.query.q]);

  // Perform the search
  const performSearch = async (query) => {
    setSearching(true);
    try {
      console.log('[Home] 🔍 Sending search request for:', query);
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        throw new Error('Search failed. Please try again.');
      }

      const data = await response.json();
      console.log('[Home] [Search Results] Full response data:', data);
      data.forEach((faq, index) => {
        console.log(`[Home] FAQ ${index + 1}:`, {
          id: faq.id,
          human_readable_name: faq.human_readable_name,
          page_slug: faq.page_slug,
          faq_file_id: faq.faq_file_id
        });
      });
      setFaqs(data);

      // Update URL with the search term without reloading the page
      router.push(
        {
          pathname: router.pathname,
          query: { q: query }
        },
        undefined,
        { shallow: true }
      );
    } catch (error) {
      console.error('[Home] [Search Error]:', error.message);
      setError(error.message);
      setFaqs([]);
    } finally {
      setSearching(false);
    }
  };

  // Trigger search on button click or when pressing Enter
  const handleSearch = () => {
    if (searchQuery.trim().length < 3) {
      setError('Please enter at least 3 characters to search');
      return;
    }
    setError(null);
    performSearch(searchQuery);
  };

  return (
    <>
      <Head>
        <title>Just the FAQs!</title>
      </Head>
      <main className="container">
        <div
          className="header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <h1>Just the FAQs!</h1>
          <Link
            href="/util/all-pages"
            style={{
              color: 'blue',
              textDecoration: 'underline',
              fontSize: '1rem'
            }}
          >
            View All Pages
          </Link>
        </div>

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

        {faqs.length > 0 && (
          <div className="results">
            <h2>Search Results ({faqs.length})</h2>
            {faqs.map((faq) => (
              <FAQEntry
                key={faq.id}
                faq={faq}
                existingFaqSlugs={existingFaqSlugs}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}
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
