import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const fetchFAQData = async (slug) => {
  try {
    const response = await fetch(`/api/faq/${slug}`);
    if (!response.ok) throw new Error('Failed to fetch FAQ data');
    return await response.json();
  } catch (error) {
    console.error(`[fetchFAQData] Error fetching FAQ for slug "${slug}":`, error);
    return null;
  }
};

const FAQEntry = ({ faq }) => {
  // Format related page links to show human-readable names
  const formatHumanReadableName = (url) => {
    const parts = url.split('/');
    return parts[parts.length - 1].replace(/_/g, ' ');
  };

  return (
    <article className="faq-entry">
      {/* Subheader */}
      {faq.subheader && <div className="subheader">{faq.subheader}</div>}

      {/* Question with Image */}
      <div className="question-with-image">
        <h2 className="question">Question: {faq.question}</h2>
        {faq.media_links && faq.media_links.length > 0 && (
          <div className="image">
            <img
              src={faq.media_links[0]}
              alt="FAQ Thumbnail"
              loading="lazy"
            />
          </div>
        )}
      </div>

      {/* Answer */}
      <div className="answer-container">
        <div dangerouslySetInnerHTML={{ __html: faq.answer }}></div>
      </div>

      {/* Related Links */}
      {faq.cross_links && faq.cross_links.length > 0 && (
        <div className="related-links">
          <span>Related Pages:</span>
          <ul>
            {faq.cross_links.map((link, index) => (
              <li key={index}>
                <a
                  href={`/${link.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  className="related-topic-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {formatHumanReadableName(link)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
};

export default function FAQPage() {
  const router = useRouter();
  const { slug } = router.query;
  const [faqData, setFaqData] = useState(null);

  useEffect(() => {
    if (slug) {
      fetchFAQData(slug).then((data) => setFaqData(data));
    }
  }, [slug]);

  if (!faqData) {
    return <div>Loading or FAQ not found.</div>;
  }

  const { title, human_readable_name, faqs } = faqData;

  return (
    <>
      <Head>
        <title>{human_readable_name || title} - FAQ</title>
        <link rel="stylesheet" href="/styles.css" />
      </Head>
      <main className="container">
        <h1 className="page-name">{human_readable_name || title}</h1>
        <div>
          {faqs.map((faq, index) => (
            <FAQEntry key={index} faq={faq} />
          ))}
        </div>
      </main>
    </>
  );
}