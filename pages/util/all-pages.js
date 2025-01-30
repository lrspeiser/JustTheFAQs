// pages/util/all-pages.js

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

export default function AllPages() {
  // State for the slice of page data (e.g. 200 items) we fetched
  const [pageSlice, setPageSlice] = useState([]);
  // Keep track of total row count so we can compute how many pages exist
  const [totalCount, setTotalCount] = useState(0);
  // If there's an error, store the message here
  const [error, setError] = useState(null);
  // Are we currently loading (fetch in progress)?
  const [loading, setLoading] = useState(true);

  const router = useRouter();

  // Current page number from ?paged=2, defaults to 1
  const currentPage = parseInt(router.query.paged, 10) || 1;

  // We want 200 entries per page
  const PAGE_SIZE = 200;

  // Helper: total pages
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  useEffect(() => {
    async function fetchPageSlice(pageNum) {
      try {
        setLoading(true);
        setError(null);

        console.log(`[AllPages] Fetching /api/page-names?page=${pageNum} ...`);
        const resp = await fetch(`/api/page-names?page=${pageNum}`);
        if (!resp.ok) {
          throw new Error(`Failed to fetch page ${pageNum}.`);
        }
        const data = await resp.json();
        console.log('[AllPages] Received data:', data);

        // data.pages -> array of { name, slug }
        // data.totalCount -> total rows in DB
        setPageSlice(data.pages || []);
        setTotalCount(data.totalCount || 0);
      } catch (err) {
        console.error('[AllPages] Error in fetchPageSlice:', err);
        setError(err.message);
        setPageSlice([]);
      } finally {
        setLoading(false);
      }
    }

    // On mount or if user changes ?paged=, we fetch that slice
    fetchPageSlice(currentPage);
  }, [currentPage]);

  // Helper: navigate to a specific page
  const goToPage = (pageNumber) => {
    router.push({
      pathname: '/util/all-pages',
      query: { paged: pageNumber },
    });
  };

  if (error) {
    return (
      <div style={{ padding: '1rem' }}>
        <h1>Oops, something went wrong!</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '1rem' }}>
        <h1>Loading pages (page {currentPage}) ...</h1>
      </div>
    );
  }

  // If we have data and not loading, let's render the list
return (
  <>
    <Head>
      <title>All Pages - Paginated (Server-Side)</title>
    </Head>

    <main style={{ maxWidth: '600px', margin: '0 auto', padding: '1rem' }}>
      <h1>All FAQs</h1>

      <div style={{ marginBottom: '1rem' }}>
        <h2>Page {currentPage} of {totalPages || 1}</h2>
      </div>
      <div style={{ marginTop: '2rem', fontSize: '1.1rem' }}>
        {/* Previous Link - only show if currentPage > 1 */}
        {currentPage > 1 ? (
          <Link
            href={{
              pathname: '/util/all-pages',
              query: { paged: currentPage - 1 }
            }}
            style={{
              marginRight: '2rem',
              textDecoration: 'underline',
              color: 'blue'
            }}
          >
            ← Previous
          </Link>
        ) : (
          <span style={{ marginRight: '2rem', color: '#999' }}>
            ← Previous
          </span>
        )}

        {/* Next Link - only show if currentPage < totalPages */}
        {currentPage < totalPages ? (
          <Link
            href={{
              pathname: '/util/all-pages',
              query: { paged: currentPage + 1 }
            }}
            style={{
              textDecoration: 'underline',
              color: 'blue'
            }}
          >
            Next →
          </Link>
        ) : (
          <span style={{ color: '#999' }}>Next →</span>
        )}
      </div>
      {/* List of items on this page */}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {pageSlice.map((item, idx) => (
          <li key={idx} style={{ margin: '0.5rem 0' }}>
            <Link
              href={`/${item.slug}`}
              style={{
                textDecoration: 'underline',
                color: 'blue'
              }}
            >
              {item.name}
            </Link>
          </li>
        ))}
      </ul>

      {/* 
        Pagination with <Link> instead of buttons.
        We'll conditionally disable/hide them if at the boundary pages.
      */}
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