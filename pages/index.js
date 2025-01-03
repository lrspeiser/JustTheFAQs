import pkg from "pg";
const { Client } = pkg;
import { useState } from "react";


export async function getStaticProps() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL, // Replit provides this automatically
  });

  try {
    await client.connect();
    console.log("[DB] Connected to the database.");

    // Fetch `slug`, `file_path`, and `human_readable_name`
    const query = `
      SELECT slug, file_path, human_readable_name 
      FROM faq_files 
      ORDER BY id DESC;
    `;
    const result = await client.query(query);
    console.log("[DB] Fetched rows:", result.rows);

    const faqs = result.rows.map((row) => ({
      slug: row.slug,
      url: row.file_path,
      name: row.human_readable_name || row.slug.replace(/-/g, " "), // Fallback to slug if name is missing
    }));

    return { props: { faqs } };
  } catch (error) {
    console.error("[DB] Error fetching data:", error.message);
    return { props: { faqs: [] } };
  } finally {
    await client.end();
  }
}

// Place `Home` component in `index.js` for the main page
export default function Home({ faqs }) {
  const [loading, setLoading] = useState(false);

  const handleGenerateClick = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/fetchAndGenerate", { method: "POST" });
      const data = await response.json();
      alert(data.message);
    } catch (error) {
      console.error("Error triggering fetchAndGenerate:", error);
      alert("Failed to trigger the fetchAndGenerate script.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>FAQs Generated from Wikipedia</h1>
      {faqs.length === 0 ? (
        <p>No FAQs available. Please try again later.</p>
      ) : (
        <table className="faq-table">
          <tbody>
            {faqs.map((faq) => (
              <tr key={faq.slug}>
                <td className="faq-link">
                  <a href={faq.url} target="_blank" rel="noopener noreferrer">
                    {faq.name}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={handleGenerateClick} disabled={loading}>
        {loading ? "Generating..." : "Generate 50 More Articles"}
      </button>
      <style jsx>{`
        .container {
          font-family: Arial, sans-serif;
          margin: 0 auto;
          padding: 16px;
          max-width: 800px;
        }
        h1 {
          text-align: center;
          margin-bottom: 24px;
        }
        .faq-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 16px;
        }
        .faq-table td {
          padding: 12px;
          border-bottom: 1px solid #ddd;
        }
        .faq-link a {
          text-decoration: none;
          color: #007bff;
          font-weight: bold;
        }
        .faq-link a:hover {
          text-decoration: underline;
        }
        button {
          display: block;
          margin: 16px auto;
          padding: 12px 24px;
          font-size: 16px;
          color: white;
          background-color: #007bff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        button:disabled {
          background-color: #aaa;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}