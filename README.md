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
├── lib/
│   ├── LogDisplay.js   # Used in the frontend display of logs.
│   └── db.js           # Likely interacts with Supabase, required for data storage.
├── pages/
│   ├── api/
│   │   ├── scripts/
│   │   │   ├── clearDatabase.js          # Clears database, necessary for maintenance.
│   │   │   ├── fetchAndGenerate.js       # Core script for fetching and generating FAQs.
│   │   │   ├── generateEmbeddings.js     # Essential for embedding generation.
│   │   ├── faqs.js                       # API route for FAQs.
│   │   ├── fetch-and-generate.js         # API route that invokes fetchAndGenerate.js.
│   │   ├── search.js                     # API route for searching FAQs.
functionality.
│   ├── fetch-and-generate.js              # API or frontend script to trigger fetchAndGenerate.
│   ├── _app.tsx                           # Next.js app-level component.
│   ├── index.js                           # Entry point for the frontend.
├── stream.js                               # Likely handles streaming of data.

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

## Database Schema

### `raw_faqs`
| Column             | Data Type                | Description                           |
|--------------------|--------------------------|---------------------------------------|
| id                 | INTEGER                 | Primary key                           |
| url                | TEXT                    | Original URL of the FAQ source        |
| title              | TEXT                    | Title of the FAQ                      |
| timestamp          | TIMESTAMP               | Timestamp when the FAQ was created    |
| question           | TEXT                    | The FAQ question                      |
| answer             | TEXT                    | The FAQ answer                        |
| media_link         | TEXT                    | Link to associated media              |
| human_readable_name| TEXT                    | User-friendly FAQ title               |
| last_updated       | TIMESTAMP               | Last update timestamp                 |
| subheader          | TEXT                    | Section subheader                     |
| cross_link         | TEXT                    | Related FAQ links                     |
| thumbnail_url      | TEXT                    | Not currently in use.                 |
| image_urls         | TEXT                    | Additional image URLs                 |

### `faq_files`
| Column             | Data Type                | Description                           |
|--------------------|--------------------------|---------------------------------------|
| id                 | INTEGER                 | Primary key                           |
| slug               | TEXT                    | Unique identifier for the FAQ         |
| file_path          | TEXT                    | Path to the FAQ file                  |
| created_at         | TIMESTAMP               | Creation timestamp                    |
| human_readable_name| TEXT                    | User-friendly name of the FAQ         |

### `faq_embeddings`
| Column             | Data Type                | Description                           |
|--------------------|--------------------------|---------------------------------------|
| id                 | INTEGER                 | Primary key                           |
| faq_id             | INTEGER                 | Foreign key referencing raw_faqs(id)  |
| question           | TEXT                    | The FAQ question                      |
| embedding          | VECTOR                  | Embedding vector for similarity search |

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