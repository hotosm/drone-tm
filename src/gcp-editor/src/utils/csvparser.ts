/**
 * Parses a CSV file into a 2D array of strings with automatic delimiter detection.
 * @param {File} file The CSV file to be parsed.
 * @returns {Promise<Array<Array<string>>>} A promise that resolves to a 2D array of strings (rows and columns).
 */
export function parseCSVFile(file: File): Promise<Array<Array<string>>> {
  return new Promise((resolve, reject) => {
    // Check if the file is a text file or Excel CSV type
    if (!file.type.includes('text') && !file.type.includes('ms-excel')) {
      reject(new Error('The file is not a valid text file.'));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const csvData = reader.result as string;
      try {
        const delimiter = detectDelimiter(csvData);
        const rows = parseCSV(csvData, delimiter);
        resolve(rows);
      } catch (error) {
        reject(new Error('Error parsing CSV data.'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Error reading the file.'));
    };

    reader.readAsText(file); // Read the file as a text string
  });
}

/**
 * Automatically detects the delimiter in CSV data.
 * Supports comma, tab, and space as potential delimiters.
 * @param {string} csvData The CSV data as a raw string.
 * @returns {string} The detected delimiter.
 */
function detectDelimiter(csvData: string): string {
  const sample = csvData.split('\n').slice(0, 10).join('\n'); // Analyze the first 10 rows
  const delimiters = [',', '\t', ' ']; // Common delimiters
  const counts: Record<string, number> = {};

  // Count occurrences of each delimiter in the sample
  for (const delimiter of delimiters) {
    const regex = new RegExp(`\\s*${escapeRegExp(delimiter)}\\s*`, 'g');
    counts[delimiter] = (sample.match(regex) || []).length;
  }

  // Choose the delimiter with the highest count
  const detectedDelimiter = Object.keys(counts).reduce((a, b) =>
    counts[a] > counts[b] ? a : b
  );

  return detectedDelimiter;
}

/**
 * Helper function to parse CSV string into a 2D array of strings.
 * Handles inconsistent spaces and supports custom delimiters.
 * @param {string} csvData The CSV data as a raw string.
 * @param {string} delimiter The delimiter used in the CSV (e.g., ',', '\t').
 * @returns {Array<Array<string>>} Parsed 2D array (rows and columns).
 */
function parseCSV(csvData: string, delimiter: string): Array<Array<string>> {
  const rows = csvData.trim().split('\n'); // Split the CSV into rows
  const delimiterRegex = new RegExp(`\\s*${escapeRegExp(delimiter)}\\s*`); // Handle spaces around delimiters

  return rows.map((row) => row.split(delimiterRegex).map((cell) => cell.trim()));
}

/**
 * Escapes special characters in a string to be used in a RegExp.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special characters
}
