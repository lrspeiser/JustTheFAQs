import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DOMPurify from 'dompurify';

const FAQEntry = ({ faq }) => {
  const getCategory = () => {
    if (!faq.human_readable_name) return 'General';
    return faq.human_readable_name.split('/')[0];
  };

  const getRelatedTopics = () => {
    if (!faq.cross_links) return [];
    try {
      if (typeof faq.cross_links === 'string') {
        return faq.cross_links.split(',').map((link) => link.trim());
      }
      return faq.cross_links;
    } catch {
      return [];
    }
  };

  const category = getCategory();
  const relatedTopics = getRelatedTopics();
  const categorySlug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Format the human-readable name for each related topic
  const formatHumanReadableName = (url) => {
    const parts = url.split('/');
    return parts[parts.length - 1].replace(/_/g, ' ');
  };

  return (
    <article className="faq-entry">
      {/* Page Name */}
      <header className="entry-header">
        <a href={`/${categorySlug}`} className="page-name">
          {category}
        </a>
      </header>

      {/* Subheader */}
      {faq.subheader && <div className="subheader">{faq.subheader}</div>}

      {/* Question */}
      <h2 className="question">Question: {faq.question}</h2>

      {/* Answer and Image Table */}
      <div className="answer-container">
        <table>
          <tbody>
            <tr>
              {/* Answer Cell */}
              <td className="answer">
                <div dangerouslySetInnerHTML={{ __html: faq.answer }}></div>
              </td>

              {/* Image Cell */}
              {faq.media_link && (
                <td className="image">
                  <img src={faq.media_link} alt="FAQ Thumbnail" loading="lazy" />
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Related Topics */}
      {(relatedTopics.length > 0 || category) && (
        <div className="related-links">
          <span>Related Pages:</span>
          <ul>
            {relatedTopics.map((topic, index) => (
              <li key={index}>
                <a
                  href={topic}
                  className="related-topic-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {formatHumanReadableName(topic)}
                </a>
              </li>
            ))}
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
        <title>FAQ Search</title>
        <link rel="stylesheet" type="text/css" href="/styles.css" />
      </Head>
      <main className="container">
        {/* Header with Main Page Link */}
        <div className="header">
          <h1>FAQ Search</h1>
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
