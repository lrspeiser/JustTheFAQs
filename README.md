# JustTheFAQs

JustTheFAQs is a Node.js-based application designed to generate structured FAQ pages from Wikipedia content. By leveraging the Wikipedia API and OpenAI's GPT-4 API, the program extracts key information, organizes it into concise and engaging question-and-answer pairs, and saves the data in a user-friendly HTML format for easy accessibility.

## Features

- **Wikipedia Integration**: Fetches top-viewed Wikipedia pages and their metadata.
- **Content Processing**: Extracts content and images from Wikipedia articles.
- **FAQ Generation**: Uses OpenAI's GPT-4 to create structured FAQs with questions, answers, and related links.
- **Dynamic Page Creation**: Generates visually appealing HTML FAQ pages with responsive layouts.
- **Database Management**: Tracks processed pages to avoid duplication and streamline workflow.
- **Dynamic Pagination**: Fetches additional Wikipedia articles when encountering previously processed pages.

## How It Works

1. **Fetch Top Wikipedia Pages**
   - The program fetches the top-viewed Wikipedia articles using the Wikimedia API.

2. **Check Existing Data**
   - For each Wikipedia article, the program checks a PostgreSQL database to see if the page has already been processed.

3. **Fetch and Process Content**
   - Extracts HTML content and images from Wikipedia articles using the Cheerio library.
   - Truncates content to fit within OpenAI's token limit if necessary.

4. **Generate FAQs**
   - Sends the content and images to OpenAI's GPT-4 API to create FAQs, complete with subheaders, questions, answers, and cross-links.

5. **Save to Database and File System**
   - Stores the FAQ data in a PostgreSQL database.
   - Generates an HTML file for each FAQ page, including:
     - Subheaders
     - Questions (bolded)
     - Answers (left-aligned)
     - Images (right-aligned, if available)
     - Related links to other FAQ pages

6. **Dynamic Pagination**
   - Fetches the next set of Wikipedia pages if a batch contains already-processed articles.

## Installation

### Prerequisites
- Node.js (v16 or higher)
- PostgreSQL database
- OpenAI API key

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
   DATABASE_URL=your_postgresql_connection_string
   OPENAI_API_KEY=your_openai_api_key
   ```

4. Run database migrations (if necessary):
   ```bash
   npx migrate up
   ```

## Usage

### Generate FAQ Pages
Run the main script to fetch Wikipedia pages, process content, and generate FAQ pages:
```bash
node scripts/fetchAndGenerate.js
```

### Customize Number of Pages
You can specify the number of new FAQ pages to create:
```bash
node scripts/fetchAndGenerate.js --target=50
```

## Output
- Generated HTML FAQ pages are saved in the `public/data/faqs` directory.
- Each FAQ page includes:
  - Subheaders for topic organization
  - Bolded questions and detailed answers
  - Related links to other FAQ topics
  - Thumbnail images, when available

## Contributing
Contributions are welcome! Please submit a pull request or open an issue on the GitHub repository.

## License
This project is licensed under the MIT License. See the `LICENSE` file for details.

## Acknowledgments
- [Wikimedia API](https://www.mediawiki.org/wiki/API:Main_page)
- [OpenAI](https://openai.com)
- [Cheerio](https://cheerio.js.org/) for HTML parsing

---

**JustTheFAQs** makes Wikipedia content more accessible and engaging by turning dense articles into concise, user-friendly FAQs. Start exploring knowledge with clarity!
