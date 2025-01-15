import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://erlezwoehbddlptjcdne.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVybGV6d29laGJkZGxwdGpjZG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY4OTM3MjUsImV4cCI6MjA1MjQ2OTcyNX0.oWdRSZjXYfcy0IUxvyOfN7syuB6tcx9zutRZnCyKvEs';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Fetch data from a table
async function fetchData() {
  const { data, error } = await supabase
    .from('faq_files') // Replace with your table name
    .select('*');

  if (error) {
    console.error('Error fetching data:', error.message);
  } else {
    console.log('Data fetched:', data);
  }
}

fetchData();
