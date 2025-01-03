import fs from "fs";
import path from "path";

export async function getStaticPaths() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("[DB] Fetching slugs for static paths.");

    const query = "SELECT slug FROM faq_files;";
    const result = await client.query(query);

    const paths = result.rows.map((row) => ({
      params: { slug: row.slug },
    }));

    return { paths, fallback: "blocking" }; // Enable fallback for dynamic generation
  } catch (error) {
    console.error("[DB] Error fetching slugs:", error.message);
    return { paths: [], fallback: "blocking" };
  } finally {
    await client.end();
  }
}

export async function getStaticProps({ params }) {
  const slug = params.slug;
  const filePath = path.join(process.cwd(), "public/faqs", `${slug}.html`);

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return { props: { content } };
  } catch (error) {
    console.error(`[getStaticProps] Error reading file for slug ${slug}:`, error.message);
    return { notFound: true };
  }
}

export default function FAQPage({ content }) {
  return <div dangerouslySetInnerHTML={{ __html: content }} />;
}
