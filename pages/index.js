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

  const formatWikiSlug = (url) => {
    if (!url) return '';
    try {
      let cleanUrl = decodeURIComponent(url);

      // Ensure we only strip the "/wiki/" prefix and nothing else
      if (cleanUrl.startsWith('/wiki/')) {
        cleanUrl = cleanUrl.replace('/wiki/', '');
      }

      // Replace underscores with dashes
      return cleanUrl.replace(/_/g, '-').toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  };

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

  // If cross_links is stored as a string, we convert it to an array
  // If it's an array, we just return it as-is
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

      {/* Add this debug line to see the raw page_slug in the UI */}
      <div style={{ fontSize: '0.9em', color: '#999' }}>
        Debug Slug: {faq.page_slug || '(none)'}
      </div>

      {faq.subheader && <div className="subheader">{faq.subheader}</div>}

      <div className="question-with-image">
        {/* 
          IMPORTANT: We now render the question using dangerouslySetInnerHTML
          so that stored HTML, e.g. <i>Agent Elvis</i>, will actually display as italic text.
        */}
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
        {/* The answer was already using dangerouslySetInnerHTML */}
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

              // Now using the passed-down existingFaqSlugs
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
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
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

  // Fetch existing FAQ slugs when component mounts
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

  // Perform the actual search
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

      // Update URL with the search term, but don't do a full page reload
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

  // Button click or pressing Enter triggers this
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
        <div className="header">
          <h1>Just the FAQs!</h1>
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

        {faqs.length > 0 ? (
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
        ) : (
          !searching &&
          searchQuery && (
            <div className="no-results">
              No results found. Try a different search term.
            </div>
          )
        )}

        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}
      </main>
    </>
  );
}
