import { describe, it, expect } from 'vitest';
import { parseCSVFile } from './csvparser';

/** Helper to create a File object from a string. */
function createCSVFile(content: string, name = 'test.csv', type = 'text/csv'): File {
  return new File([content], name, { type });
}

describe('parseCSVFile', () => {
  it('should parse a simple comma-delimited CSV', async () => {
    const csv = 'label,x,y,z\nGCP1,1.0,2.0,3.0\nGCP2,4.0,5.0,6.0';
    const result = await parseCSVFile(createCSVFile(csv));
    expect(result).toEqual([
      ['label', 'x', 'y', 'z'],
      ['GCP1', '1.0', '2.0', '3.0'],
      ['GCP2', '4.0', '5.0', '6.0'],
    ]);
  });

  it('should parse a tab-delimited CSV', async () => {
    const csv = 'label\tx\ty\tz\nGCP1\t1.0\t2.0\t3.0';
    const result = await parseCSVFile(createCSVFile(csv));
    expect(result).toEqual([
      ['label', 'x', 'y', 'z'],
      ['GCP1', '1.0', '2.0', '3.0'],
    ]);
  });

  it('should parse a space-delimited CSV', async () => {
    const csv = 'GCP1 1.0 2.0 3.0\nGCP2 4.0 5.0 6.0';
    const result = await parseCSVFile(createCSVFile(csv));
    expect(result).toEqual([
      ['GCP1', '1.0', '2.0', '3.0'],
      ['GCP2', '4.0', '5.0', '6.0'],
    ]);
  });

  it('should reject non-text files', async () => {
    const file = new File(['data'], 'test.bin', { type: 'application/octet-stream' });
    await expect(parseCSVFile(file)).rejects.toThrow('not a valid text file');
  });

  it('should accept ms-excel type files', async () => {
    const csv = 'label,x,y,z\nGCP1,1,2,3';
    const file = new File([csv], 'test.csv', { type: 'application/vnd.ms-excel' });
    const result = await parseCSVFile(file);
    expect(result.length).toBe(2);
  });

  it('should handle single row (header only)', async () => {
    const csv = 'label,x,y,z';
    const result = await parseCSVFile(createCSVFile(csv));
    expect(result).toEqual([['label', 'x', 'y', 'z']]);
  });

  it('should trim trailing whitespace', async () => {
    const csv = 'label,x,y,z  \nGCP1,1,2,3  ';
    const result = await parseCSVFile(createCSVFile(csv));
    expect(result[0][3]).toBe('z');
    expect(result[1][3]).toBe('3');
  });
});
