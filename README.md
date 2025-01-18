# JustTheFAQs

JustTheFAQs is a Node.js-based application designed to generate structured FAQ pages from Wikipedia content. By leveraging the Wikipedia API and OpenAI's GPT-4 API, the program extracts key information, organizes it into concise and engaging question-and-answer pairs, and stores them in a database for dynamic access through a Next.js frontend.

## Features

- **Wikipedia Integration**: Fetches top-viewed Wikipedia pages and their metadata
- **Content Processing**: Extracts content and images from Wikipedia articles
- **FAQ Generation**: Uses OpenAI's GPT-4 to create structured FAQs with questions, answers, and related links
- **Dynamic Page Rendering**: Serves FAQ content directly from the database through Next.js
- **Database Management**: Tracks processed pages to avoid duplication and streamline workflow
- **Semantic Search**: Enables natural language searching of FAQs using embeddings
- **Dynamic Pagination**: Fetches additional Wikipedia articles when encountering previously processed pages

## Project Structure
```
.
├── cache/
│   └── config.json
├── lib/
│   └── db.js
├── pages/
│   ├── api/
│   │   ├── scripts/
│   │   │   ├── clearDatabase.js
│   │   │   ├── fetchAndGenerate.js
│   │   │   ├── fixpages.js
│   │   │   ├── generateEmbeddings.js
│   │   │   ├── prebuild.js
│   │   │   └── testsupa.js
│   │   ├── faqs.js
│   │   ├── fetch-and-generate.js
│   │   ├── hello.ts
│   │   ├── list-files.js
│   │   ├── search.js
│   │   └── searchLocal.js
│   ├── faqs/
│   │   └── [slug].js
│   ├── _app.tsx
│   ├── fetch-and-generate.js
│   └── index.js
├── public/
│   ├── favicon.ico
│   ├── replit.svg
│   └── style.css
├── .eslintrc.json
├── .gitignore
├── .replit
├── README.md
├── generated-icon.png
├── next-env.d.ts
├── next.config.cjs
├── package-lock.json
├── package.json
├── replit.nix
└── tsconfig.json
```

## How It Works

1. **Fetch Top Wikipedia Pages**
   - The program fetches the top-viewed Wikipedia articles using the Wikimedia API

2. **Check Existing Data**
   - Each Wikipedia article is checked against the database to avoid duplicate processing

3. **Fetch and Process Content**
   - Extracts HTML content and images from Wikipedia articles using the Cheerio library
   - Truncates content to fit within OpenAI's token limit if necessary

4. **Generate FAQs**
   - Sends the content and images to OpenAI's GPT-4 API to create FAQs
   - Generates structured data including:
     - Questions and comprehensive answers
     - Relevant subheaders
     - Cross-references to related topics
     - Associated media links

5. **Store in Database**
   - Saves all FAQ data to PostgreSQL database
   - Generates embeddings for semantic search functionality
   - Maintains relationships between questions and their metadata

6. **Dynamic Page Serving**
   - Next.js frontend dynamically renders FAQ pages from the database
   - Enables real-time search and filtering of content
   - Provides responsive, accessible user interface

## Installation

### Prerequisites
- Node.js (v16 or higher)
- PostgreSQL database
- OpenAI API key
- Supabase account and project

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/JustTheFAQs.git
   cd JustTheFAQs
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   Create a `.env` file with the following keys:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   ```

## Usage

### Generate FAQ Content
Run the main script to fetch Wikipedia pages and generate FAQ content:
```bash
node pages/api/scripts/fetchAndGenerate.js
```

### Development Server
Start the development server:
```bash
npm run dev
```

### Production Deployment
Build and start the production server:
```bash
npm run build
npm start
```

## Database Schema

### `faq_embeddings`
| Column    | Data Type     | Nullable | Description                                         |
|-----------|---------------|----------|-----------------------------------------------------|
| id        | INTEGER       | NO       | Primary key                                        |
| faq_id    | INTEGER       | YES      | Foreign key referencing `raw_faqs(id)`            |
| question  | TEXT          | YES      | The FAQ question                                   |
| embedding | VECTOR(384)   | YES      | Embedding vector for similarity search            |
| **Indexes**   | -             |          | Primary key: `faq_embeddings_pkey`                |
|           |               |          | Embedding index: `faq_embeddings_embedding_idx`    |

### `faq_files`
| Column             | Data Type                | Nullable | Description                           |
|--------------------|--------------------------|----------|---------------------------------------|
| id                 | INTEGER                 | NO       | Primary key                           |
| slug               | TEXT                    | NO       | Unique identifier for the FAQ         |
| human_readable_name| TEXT                    | YES      | User-friendly name of the FAQ         |
| created_at         | TIMESTAMP               | NO       | Timestamp when the FAQ was created    |
| **Indexes**        | -                       |          | Primary key: `faq_files_pkey`         |
|                    |                         |          | Unique constraint: `faq_files_slug_key`|

### `raw_faqs`
| Column             | Data Type                | Nullable | Description                           |
|--------------------|--------------------------|----------|---------------------------------------|
| id                 | INTEGER                 | NO       | Primary key                           |
| url                | TEXT                    | NO       | Original URL of the FAQ source        |
| title              | TEXT                    | NO       | Title of the FAQ                      |
| timestamp          | TIMESTAMP               | NO       | Timestamp when the FAQ was created    |
| question           | TEXT                    | NO       | The FAQ question                      |
| answer             | TEXT                    | NO       | The FAQ answer                        |
| media_link         | TEXT                    | YES      | Link to associated media              |
| human_readable_name| TEXT                    | YES      | User-friendly FAQ title               |
| last_updated       | TIMESTAMP               | YES      | Timestamp of last update              |
| subheader          | TEXT                    | YES      | Section subheader                     |
| cross_link         | TEXT                    | YES      | Related FAQ links                     |
| thumbnail_url      | TEXT                    | YES      | URL of the thumbnail image            |
| image_urls         | TEXT                    | YES      | Additional image URLs                 |
| **Indexes**        | -                       |          | Primary key: `raw_faqs_pkey`          |
| **Referenced by**  | -                       |          | Foreign key: `faq_embeddings.faq_id` |

## Contributing
Contributions are welcome! Please submit a pull request or open an issue on the GitHub repository.

## License
This project is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgments
- [Wikimedia API](https://www.mediawiki.org/wiki/API:Main_page)
- [OpenAI](https://openai.com)
- [Cheerio](https://cheerio.js.org/) for HTML parsing
- [Supabase](https://supabase.com) for database management
- [Next.js](https://nextjs.org) for the frontend framework

---

**JustTheFAQs** makes Wikipedia content more accessible and engaging by turning dense articles into concise, user-friendly FAQs. Start exploring knowledge with clarity!