# JustTheFAQs

JustTheFAQs is a Node.js-based application designed to generate structured FAQ pages from Wikipedia content. By leveraging the Wikipedia API and OpenAI's GPT-4 API, the program extracts key information, organizes it into concise and engaging question-and-answer pairs, and stores them in a database for dynamic access through a Next.js frontend. Additionally, it stores vector embeddings for semantic search in **Pinecone**, enabling powerful question-answer lookups.

## Features

- **Wikipedia Integration**: Fetches top-viewed Wikipedia pages and their metadata  
- **Content Processing**: Extracts HTML content and images from Wikipedia articles  
- **FAQ Generation**: Uses OpenAI's GPT-4 to create structured FAQs with questions, answers, and related links  
- **Dynamic Page Rendering**: Serves FAQ content directly from a PostgreSQL database (accessed via Supabase) through Next.js  
- **Semantic Search (via Pinecone)**: Uses Pinecone as the vector database to store embeddings for advanced similarity-based searching  
- **Dynamic Pagination**: Fetches additional Wikipedia articles when encountering previously processed pages  
- **Database Management**: Tracks processed pages to avoid duplication, maintain cross-links, and streamline workflows  

## Project Structure

```
├── lib/
│   ├── LogDisplay.js         # Used in the frontend display of logs.
│   └── db.js                 # Database helper functions; uses Supabase for Postgres access.
├── pages/
│   ├── api/
│   │   ├── scripts/
│   │   │   ├── fetchAndGenerate.js   # Core script for fetching Wikipedia pages & generating FAQs.
│   │   ├── faqs.js                   # API route for returning FAQ data.
│   │   ├── search.js                 # API route for performing semantic searches (queries Pinecone).
│   ├── [slug].js                     # Dynamic route for individual FAQ pages.
│   ├── index.js                      # Entry point for the frontend (search page).
├── stream.js                         # Likely handles streaming of data/logs to the frontend.
...
```

## How It Works

1. **Fetch Top Wikipedia Pages**  
   - Uses the Wikimedia API to retrieve top-viewed Wikipedia articles.

2. **Check Existing Data**  
   - Each Wikipedia article is checked against the PostgreSQL database (via Supabase) to avoid duplicate processing.

3. **Fetch and Process Content**  
   - Extracts HTML content and images from Wikipedia articles using the Cheerio library.  
   - Truncates content to fit within OpenAI's token limit if necessary.

4. **Generate FAQs**  
   - Sends article content and images to OpenAI's GPT-4 API to create FAQs.  
   - Produces structured data containing:
     - Questions/Answers  
     - Relevant subheaders  
     - Cross-references to other Wikipedia pages  
     - Media (image) links  

5. **Store in Database + Pinecone**  
   - Saves all FAQ data (questions, answers, metadata) in a PostgreSQL database.  
   - Generates embeddings for each FAQ and saves them to **Pinecone**, enabling semantic similarity search.

6. **Dynamic Page Serving**  
   - Next.js frontend dynamically renders FAQ pages out of the PostgreSQL database.  
   - Real-time search & filtering is achieved by querying Pinecone for embeddings.  
   - Cross-links between pages are maintained to allow deeper exploration.

## Installation

### Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database
- [Supabase](https://supabase.com) (to access the PostgreSQL database)
- Pinecone account and API key (for vector embeddings)
- OpenAI API key

### Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-repo/JustTheFAQs.git
   cd JustTheFAQs
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:  
   Create a `.env` file with the following keys:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   PINECONE_API_KEY=your_pinecone_api_key
   PINECONE_ENVIRONMENT=your_pinecone_env
   ```
   > The **OpenAI** key and **Pinecone** key are crucial for generating embeddings and storing/retrieving vectors. The **Supabase** URL & key are used to connect to your PostgreSQL database.

## Usage

### Generate FAQ Content

Run the main script to fetch Wikipedia pages and generate FAQ content:
```bash
node pages/api/scripts/fetchAndGenerate.js
```
This fetches new Wikipedia pages, processes them in batches, and stores the result in both PostgreSQL (via Supabase) and Pinecone for embeddings.

### Development Server

Start the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application in your browser.

### Production Deployment

Build and start the production server:
```bash
npm run build
npm start
```

## Database Schema

Although embeddings are now stored in **Pinecone**, the application still uses PostgreSQL (accessed via Supabase) to store FAQ text data, cross-links, timestamps, etc. Below is the main schema for storing FAQ content.

### `faq_files`

| Column               | Data Type                   | Nullable | Default | Constraint   |
|----------------------|-----------------------------|----------|---------|--------------|
| id                   | integer                     | NO       |         | PRIMARY KEY  |
| slug                 | text                        | NO       |         | UNIQUE       |
| created_at           | timestamp without time zone | YES      | now()   |              |
| human_readable_name  | text                        | YES      |         |              |

This table represents distinct FAQ groups. Each **slug** corresponds to the Wikipedia title, and `human_readable_name` is the more readable page name.

### `raw_faqs`

Below is the updated schema reflecting all current columns:

| Column                  | Data Type                   | Nullable | Default            | Description / Notes                                   |
|-------------------------|-----------------------------|----------|--------------------|--------------------------------------------------------|
| id                      | integer                     | NO       |                    | **Primary Key** for each FAQ                          |
| url                     | text                        | NO       |                    | Full URL of the Wikipedia page                        |
| title                   | text                        | NO       |                    | Wikipedia page title                                  |
| timestamp               | timestamp without time zone | NO       | CURRENT_TIMESTAMP  | Time of row creation                                  |
| question                | text                        | NO       |                    | FAQ question                                          |
| answer                  | text                        | NO       |                    | FAQ answer                                            |
| media_link              | text                        | YES      |                    | For storing a single image/media link                 |
| human_readable_name     | text                        | YES      |                    | Plain name for display                                |
| last_updated            | timestamp without time zone | YES      |                    | Tracks updates                                        |
| subheader               | text                        | YES      |                    | Indicates FAQ section header                          |
| cross_link              | text                        | YES      |                    | Comma-separated list of cross-links (related pages)   |
| image_urls              | text                        | YES      |                    | Typically for storing multiple image links (CSV)      |
| faq_file_id             | integer                     | YES      |                    | **Foreign Key** referencing `faq_files(id)`           |
| pinecone_upsert_success | boolean                     | NO       | false              | Indicates whether the row was successfully upserted to Pinecone |

> **Note**: Previously, the application stored embeddings in a `faq_embeddings` table. **That table is no longer used** because Pinecone now manages all vector data for semantic search.

---

## Example Database Rows

Below are minimal JSON examples—one row per table—to illustrate the data format stored in each of the primary tables.

### `raw_faqs` Example

```json
{
  "id": 38406,
  "url": "https://en.wikipedia.org/wiki/Cavalier",
  "title": "Cavalier",
  "timestamp": "2025-01-26 18:59:16.255024",
  "question": "How has the Cavalier aesthetic influenced the arts, particularly in portraiture?",
  "answer": "The Cavalier aesthetic significantly influenced art from the period, particularly through the works of artists like Sir Anthony van Dyck ... This artistic portrayal contributed to the legacy of the Cavalier image, cementing the connection between their military and social identity and the art of the time.",
  "media_link": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Sir_Anthony_Van_Dyck_-_Charles_I_%281600-49%29_-_Google_Art_Project.jpg/220px-Sir_Anthony_Van_Dyck_-_Charles_I_%281600-49%29_-_Google_Art_Project.jpg",
  "human_readable_name": "Cavalier",
  "last_updated": "2024-12-13 01:57:15",
  "subheader": "Cavalier Style in Arts",
  "cross_link": "Anthony_van_Dyck, Charles_I_in_Three_Positions",
  "image_urls": null,
  "faq_file_id": 3796,
  "pinecone_upsert_success": true
}
```

**Purpose**: Stores individual FAQ items, including the question, answer, relevant links, and references to a parent FAQ file.  
**Key Fields**:  
- **`question` / `answer`**: Main Q&A pair.  
- **`cross_link`**: Cross-referenced Wikipedia pages or related topics.  
- **`faq_file_id`**: Foreign key to the `faq_files` table.

---

### `faq_files` Example

```json
{
  "id": 3796,
  "slug": "cavalier",
  "created_at": "2025-01-26 18:59:12.655",
  "human_readable_name": "Cavalier"
}
```

**Purpose**: Stores high-level FAQ group data (e.g., each entry typically corresponds to a Wikipedia article).  
**Key Fields**:  
- **`slug`**: Typically matches the Wikipedia article title (in slug form).  
- **`human_readable_name`**: Displays a user-friendly name (e.g., “Cavalier”).

---

### Job / Processing Queue Table Example

*(If you have a separate table that tracks pages to be processed or cross-linked, you might call it something like `wiki_jobs` or `pending_articles`.)*

```json
{
  "id": 22331,
  "title": "George Hamilton (actor)",
  "human_readable_name": "George Hamilton (actor)",
  "last_updated": null,
  "status": "pending",
  "priority": 1,
  "created_at": "2025-01-23 01:11:42.341451+00",
  "processed_at": null,
  "error_message": null,
  "attempts": 0,
  "slug": "george-hamilton-actor-",
  "source": "cross_link",
  "url": "https://en.wikipedia.org/wiki/George_Hamilton_(actor)"
}
```

**Purpose**: Tracks tasks or articles queued for processing, with fields for status, priority, etc.  
**Key Fields**:  
- **`status`**: Could be `pending`, `completed`, or `error`.  
- **`source`**: Indicates why or how it was added (e.g., “cross_link”).  
- **`attempts`**: Number of retry attempts if there’s an error.

---

## Semantic Search with Pinecone

All embeddings are generated via OpenAI and stored in Pinecone. Queries to find the most relevant FAQs go through Pinecone, retrieving the best-matching entries by cosine similarity. The results are then cross-referenced with `raw_faqs` data in PostgreSQL to serve the correct answers.

### Pinecone Setup

1. Create a Pinecone index (e.g., `faq-embeddings`) with a dimension matching your chosen embedding model (e.g., 1536).
2. Update `.env` with:
   ```bash
   PINECONE_API_KEY=your_pinecone_api_key
   PINECONE_ENVIRONMENT=your_pinecone_environment
   ```
3. Ensure your Node.js code references the correct Pinecone index name and environment.

## Contributing

Contributions are welcome! Please submit a pull request or open an issue on the GitHub repository.

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgments

- [Wikimedia API](https://www.mediawiki.org/wiki/API:Main_page)  
- [OpenAI](https://openai.com)  
- [Cheerio](https://cheerio.js.org/) for HTML parsing  
- [Supabase](https://supabase.com) for managing PostgreSQL data  
- [Pinecone](https://www.pinecone.io/) for vector embedding search  
- [Next.js](https://nextjs.org) for the frontend framework  

---

**JustTheFAQs** transforms dense Wikipedia articles into user-friendly FAQs enriched with semantic search capabilities. Explore your favorite topics with clarity and speed!