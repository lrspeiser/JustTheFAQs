import fs from "fs";
import path from "path";

export async function getStaticPaths() {
  const faqDir = path.join(process.cwd(), "public/data/faqs");
  const files = fs.readdirSync(faqDir);

  const paths = files.map((file) => ({
    params: { slug: file.replace(/\.html$/, "") },
  }));

  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const filePath = path.join(process.cwd(), "public/data/faqs", `${params.slug}.html`);
  const content = fs.readFileSync(filePath, "utf8");

  return { props: { content } };
}

export default function FAQPage({ content }) {
  return (
    <div dangerouslySetInnerHTML={{ __html: content }} />
  );
}
