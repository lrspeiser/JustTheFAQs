import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DOMPurify from 'dompurify';

const FAQEntry = ({ faq }) => {
  const getCategory = () => {
    if (!faq.human_readable_name) return 'General';
    return faq.human_readable_name.split('/')[0];
  };

  // Updated function to properly handle cross-links
  const getRelatedTopics = () => {
    if (!faq.cross_links) return [];
    try {
      if (typeof faq.cross_links === 'string') {
        return faq.cross_links.split(',')
          .map(link => link.trim())
          .map(link => {
            // Remove /wiki/ prefix if present
            const cleanLink = link.replace(/^\/wiki\//, '');
            // Decode URL-encoded characters
            return decodeURIComponent(cleanLink);
          })
          .filter(Boolean); // Remove empty links
      }
      return faq.cross_links;
    } catch {
      return [];
    }
  };

  const category = getCategory();
  const relatedTopics = getRelatedTopics();
  const categorySlug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Updated function to better handle encoded URLs and special characters
  const formatHumanReadableName = (url) => {
    try {
      // Remove any remaining URL encoding and clean up the name
      const decoded = decodeURIComponent(url);
      return decoded
        .replace(/_/g, ' ')
        .replace(/\(.*?\)/g, '') // Remove parentheses and their contents
        .trim();
    } catch {
      return url.replace(/_/g, ' ').trim();
    }
  };

  return (
    <article className="faq-entry">
      <header className="entry-header">
        <a href={`/${categorySlug}`} className="page-name">
          {category}
        </a>
        {faq.debug_info && process.env.NODE_ENV === 'development' && (
          <div className="debug-info">
            <small>
              Match: {faq.debug_info.has_text_match ? 'Text' : 'Semantic'} (
              Score: {Math.round(faq.debug_info.final_score * 100)}%)
            </small>
          </div>
        )}
      </header>

      {faq.subheader && <div className="subheader">{faq.subheader}</div>}

      <div className="question-with-image">
        <h2 className="question">Question: {faq.question}</h2>
        {faq.media_link && (
          <div className="image">
            <img src={faq.media_link} alt="FAQ Thumbnail" loading="lazy" />
          </div>
        )}
      </div>

      <div className="answer-container">
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(faq.answer) }}></div>
      </div>

      {(relatedTopics.length > 0 || category) && (
        <div className="related-links">
          <span>Related Pages:</span>
          <ul>
            {relatedTopics.map((topic, index) => {
              const formattedName = formatHumanReadableName(topic);
              if (!formattedName) return null;

              const slug = topic.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
                .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

              return (
                <li key={index}>
                  <a
                    href={`/${slug}`}
                    className="related-topic-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {formattedName}
                  </a>
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

  useEffect(() => {
    const query = router.query.q;
    if (query) {
      setSearchQuery(query);
      performSearch(query);
    }
  }, [router.query.q]);

  const performSearch = async (query) => {
    setSearching(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error('Search failed. Please try again.');
      }

      const data = await response.json();
      console.log('[Search Results] Data received:', data);
      setFaqs(data);

      router.push(
        {
          pathname: router.pathname,
          query: { q: query },
        },
        undefined,
        { shallow: true }
      );
    } catch (error) {
      console.error('[Search Error]:', error.message);
      setError(error.message);
      setFaqs([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = () => {
    if (searchQuery.trim().length < 3) {
      setError('Please enter at least 3 characters to search');
      return;
    }
    setError(null);
    performSearch(searchQuery);
  };

  useEffect(() => {
    console.log('[FAQ Component] Current FAQs:', faqs);
  }, [faqs]);

  return (
    <>
      <Head>
        <title>Just the FAQs!</title>
        <link rel="stylesheet" type="text/css" href="/styles.css" />
      </Head>
      <main className="container">
        {/* Header */}
        <div className="header">
          <h1>Just the FAQs!</h1>
        </div>

        {/* Search Box */}
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

        {/* Results */}
        {faqs.length > 0 ? (
          <div className="results">
            <h2>Search Results ({faqs.length})</h2>
            {faqs.map((faq) => (
              <FAQEntry key={faq.id} faq={faq} />
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
