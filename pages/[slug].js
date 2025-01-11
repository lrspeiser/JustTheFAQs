import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DOMPurify from 'dompurify';

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
    return <div>Loading...</div>;
  }

  const { title, faqs, human_readable_name } = faqData;

  return (
    <>
      <Head>
        <title>{human_readable_name || title} - FAQ</title>
      </Head>
      <main className="container">
        <h1>{human_readable_name || title}</h1>
        <div>
          {faqs.map((faq, index) => (
            <div key={index} className="faq-entry">
              <h2>{faq.subheader || 'General'}</h2>
              <p><strong>Q:</strong> {faq.question}</p>
              <p><strong>A:</strong> {faq.answer}</p>
              {faq.media_links && faq.media_links.length > 0 && (
                <img src={faq.media_links[0]} alt={`Related to ${faq.question}`} />
              )}
              {faq.cross_links && faq.cross_links.length > 0 && (
                <p>
                  Related Links:{' '}
                  {faq.cross_links.map((link, idx) => (
                    <a key={idx} href={link} target="_blank" rel="noopener noreferrer">
                      {link}
                    </a>
                  ))}
                </p>
              )}
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
